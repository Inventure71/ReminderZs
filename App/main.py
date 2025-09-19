import sys, json, os, re
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

# Optional debug server (VS Code attach) when PY_DEBUG=1
if os.getenv("PY_DEBUG") == "1":
    try:
        import debugpy  # type: ignore
        debugpy.listen(("127.0.0.1", 5678))
        print("[py] Debug server on 127.0.0.1:5678; waiting for client...", flush=True)
        debugpy.wait_for_client()
        print("[py] Debugger attached.", flush=True)
    except Exception as e:
        print(f"[py] Failed to start debug server: {e}", file=sys.stderr, flush=True)








if __name__ == "__main__":
    blocks = json.loads(sys.argv[1]) if len(sys.argv) > 1 else []
    # Script maker: generate a Python script from blocks

    def sanitize_ident(name: str) -> str:
        s = ''.join(ch if ch.isalnum() or ch == '_' else '_' for ch in (name or 'var')).strip('_')
        if not s:
            s = 'var'
        if s[0].isdigit():
            s = '_' + s
        return s

    def py_literal(v: Any) -> str:
        # Prefer numeric literals when the value is a numeric-looking string
        if isinstance(v, str):
            s = v.strip()
            if s:
                # boolean
                if s.lower() in ('true', 'false'):
                    return s.capitalize()  # True or False
                # integer
                if re.fullmatch(r"[+-]?\d+", s):
                    try:
                        return str(int(s))
                    except Exception:
                        return repr(v)
                # float / scientific
                if re.fullmatch(r"[+-]?(?:\d+\.\d*|\d*\.\d+)(?:[eE][+-]?\d+)?", s) or re.fullmatch(r"[+-]?\d+[eE][+-]?\d+", s):
                    try:
                        f = float(s)
                        return repr(f)
                    except Exception:
                        return repr(v)
            return repr(v)
        return repr(v)

    # Index blocks by uid
    uid_to_block: Dict[str, Dict[str, Any]] = {b.get('uid'): b for b in blocks if b.get('uid')}

    # Map variable uid -> symbol name and declaration
    var_uid_to_symbol: Dict[str, str] = {}
    var_decls: List[str] = []
    used_symbols: Set[str] = set()
    processed_var_uids: Set[str] = set()  # Track which variable UIDs we've already processed

    for b in blocks:
        if (b.get('button_class') or '').lower() == 'variable':
            # Prefer variable info from JSON; fallback to catalog if needed
            vinfo = b.get('variable') or {}
            var_value_uid = vinfo.get('uid') or b.get('variable_uid')
            
            # Skip if we've already processed this variable UID
            if var_value_uid and var_value_uid in processed_var_uids:
                # Just map this block UID to the existing symbol
                var_block_uid = b.get('uid')
                if var_block_uid and var_value_uid in var_uid_to_symbol:
                    var_uid_to_symbol[var_block_uid] = var_uid_to_symbol[var_value_uid]
                continue
            
            # Create new symbol for this variable
            base = sanitize_ident(vinfo.get('name') or 'var')
            sym = base
            i = 2
            while sym in used_symbols:
                sym = f"{base}_{i}"
                i += 1
            used_symbols.add(sym)
            
            var_block_uid = b.get('uid')
            # Map both the block uid and the variable uid to the same symbol
            if var_block_uid:
                var_uid_to_symbol[var_block_uid] = sym
            if var_value_uid:
                var_uid_to_symbol[var_value_uid] = sym
                processed_var_uids.add(var_value_uid)
            # include type hint if available (normalize 'any' → 'Any')
            vtype_raw = vinfo.get('type') or 'Any'
            vtype = 'Any' if isinstance(vtype_raw, str) and vtype_raw.lower() == 'any' else vtype_raw
            try:
                lit = py_literal(vinfo.get('value'))
            except Exception:
                lit = 'None'
            var_decls.append(f"{sym}: {vtype} = {lit}")

    # Track produced values for function outputs: (uid,out_index) -> symbol
    produced_values: Dict[Tuple[str, int], str] = {}

    # Collect imports
    imports: Set[str] = set()
    stub_tasks: List[Tuple[str, Dict[str, Any]]] = []  # (func_name, block)

    def canonical_type(tname: Optional[str]) -> Optional[str]:
        if not tname:
            return None
        name = str(tname).strip().lower()
        if name in ('string', 'str', 'text'):
            return 'str'
        if name in ('int', 'integer'):
            return 'int'
        if name in ('float', 'double', 'number'):
            return 'float'
        if name in ('bool', 'boolean'):
            return 'bool'
        return None

    def cast_expr(expr: str, expected: Optional[str]) -> str:
        if expr == 'None' or not expected:
            return expr
        if expected == 'str':
            return f"str({expr})"
        if expected == 'int':
            return f"int({expr})"
        if expected == 'float':
            return f"float({expr})"
        if expected == 'bool':
            return f"bool({expr})"
        return expr

    def resolve_input_expr(block: Dict[str, Any], idx: int) -> str:
        # Enforced ordering from UI: one entry per input, either variable UID, "fromUid:out:index", or null
        refs = block.get('variables_input_references') or []
        if idx >= len(refs):
            return 'None'
        ref = refs[idx]
        if ref is None:
            return 'None'
        # If reference is a variable uid
        if isinstance(ref, str) and ':' not in ref:
            sym = var_uid_to_symbol.get(ref)
            return sym or 'None'
        # Else it's a key like "fromUid:out:index"
        if isinstance(ref, str) and ':out:' in ref:
            from_uid, _, out_idx = ref.partition(':out:')
            try:
                out_i = int(out_idx)
            except Exception:
                out_i = 0
            sym = produced_values.get((from_uid, out_i))
            return sym or 'None'
        return 'None'

    def function_call_line(block: Dict[str, Any]) -> Optional[str]:
        """
        Produce a single line assigning function outputs.
        Returns the code line or None if not applicable.
        """
        cls = (block.get('button_class') or '').lower()
        if cls not in ['function', 'operator']:
            return None
        fn = block.get('function_name')
        # Build argument list from input variables (attempt basic casting for variables to expected input types)
        inputs = block.get('variables_input_nodes') or []
        input_types = block.get('variables_input_nodes_types') or []
        refs = block.get('variables_input_references') or []
        args_list: List[str] = []
        for i, _ in enumerate(inputs):
            raw = resolve_input_expr(block, i)
            expected = canonical_type(input_types[i] if i < len(input_types) else None)
            ref_val = refs[i] if i < len(refs) else None
            # Cast only when the source is a variable UID (no ':out:' in ref)
            if isinstance(ref_val, str) and (':out:' not in ref_val):
                args_list.append(cast_expr(raw, expected))
            else:
                args_list.append(raw)
        args = ', '.join(args_list)
        # Determine outputs
        outs = block.get('variables_output_nodes') or []
        out_syms: List[str] = []
        for i, name in enumerate(outs):
            base = sanitize_ident(name or f"out{i+1}")
            sym = base
            j = 2
            while sym in used_symbols:
                sym = f"{base}_{j}"
                j += 1
            used_symbols.add(sym)
            out_syms.append(sym)
            produced_values[(block.get('uid') or '', i)] = sym

        # Map function import
        call = None
        if isinstance(fn, str) and fn.startswith('operator.'):
            # Handle operator functions with Python operators
            op_name = fn.split('.', 1)[1]
            if op_name == 'eq' and len(args_list) >= 2:
                call = f"({args_list[0]} == {args_list[1]})"
            elif op_name == 'gt' and len(args_list) >= 2:
                call = f"({args_list[0]} > {args_list[1]})"
            elif op_name == 'lt' and len(args_list) >= 2:
                call = f"({args_list[0]} < {args_list[1]})"
            elif op_name == 'not_' and len(args_list) >= 1:
                call = f"(not {args_list[0]})"
            elif op_name == 'or_' and len(args_list) >= 2:
                call = f"({args_list[0]} or {args_list[1]})"
            elif op_name == 'and_' and len(args_list) >= 2:
                call = f"({args_list[0]} and {args_list[1]})"
            else:
                # Fallback to operator module
                imports.add("import operator")
                call = f"operator.{op_name}({args})"
        elif isinstance(fn, str) and '.' in fn and not fn.startswith('builtins.'):
            mod, _, name = fn.rpartition('.')
            imports.add(f"from modules.{mod} import {name}")
            call = f"{name}({args})"
        elif isinstance(fn, str) and fn.startswith('builtins.'):
            call = f"{fn.split('.',1)[1]}({args})"
        elif isinstance(fn, str) and fn:
            # custom or bare name in modules
            # prefer modules.<fn> import <fn>; create stub later if missing
            imports.add(f"from modules.{fn} import {fn}")
            stub_tasks.append((fn, block))
            call = f"{fn}({args})"
        else:
            # No function reference; treat as no-op
            return None

        if not out_syms:
            return call
        if len(out_syms) == 1:
            return f"{out_syms[0]} = {call}"
        return f"{', '.join(out_syms)} = {call}"

    # Build exec adjacency from exec_out_refs
    exec_out: Dict[str, Dict[str, str]] = {}
    for b in blocks:
        refs = b.get('exec_out_refs') or {}
        exec_out[b.get('uid')] = refs

    # Find Begin Play starters
    begins: List[str] = []
    for b in blocks:
        if (b.get('button_class') or '').lower() == 'executor' and (((b.get('id') or '').lower().find('begin')) != -1 or ((b.get('content') or '').lower().find('begin')) != -1):
            begins.append(b.get('uid'))

    visited_exec: Set[str] = set()
    lines: List[str] = []

    def gen_branch(start_uid: Optional[str], indent: int = 0) -> None:
        cur = start_uid
        while cur and cur in uid_to_block and cur not in visited_exec:
            visited_exec.add(cur)
            blk = uid_to_block[cur]
            cls = (blk.get('button_class') or '').lower()
            if cls == 'conditional':
                # compute condition expr (first var input)
                cond = resolve_input_expr(blk, 0)
                lines.append(' ' * indent + f"if {cond}:")
                
                # Generate then branch
                then_uid = (exec_out.get(cur) or {}).get('then')
                then_start_line_count = len(lines)
                gen_branch(then_uid, indent + 4)
                then_has_content = len(lines) > then_start_line_count
                
                # Add pass if then branch is empty
                if not then_has_content:
                    lines.append(' ' * (indent + 4) + "pass")
                
                # Generate else branch only if there's something connected
                else_uid = (exec_out.get(cur) or {}).get('else')
                if else_uid and else_uid in uid_to_block:
                    lines.append(' ' * indent + "else:")
                    else_start_line_count = len(lines)
                    gen_branch(else_uid, indent + 4)
                    else_has_content = len(lines) > else_start_line_count
                    
                    # Add pass if else branch is empty
                    if not else_has_content:
                        lines.append(' ' * (indent + 4) + "pass")
                
                # stop linear flow after handling branches
                return
            elif cls == 'function' or cls == 'operator':
                call_line = function_call_line(blk)
                if call_line:
                    lines.append(' ' * indent + call_line)
            elif cls == 'variable' and (blk.get('id') or '').lower() == 'setvariable':
                # Handle SetVariable blocks
                var_info = blk.get('variable') or {}
                var_uid = var_info.get('uid') or blk.get('variable_uid')
                if var_uid and var_uid in var_uid_to_symbol:
                    var_symbol = var_uid_to_symbol[var_uid]
                    value_expr = resolve_input_expr(blk, 0)  # Get value from first input
                    lines.append(' ' * indent + f"{var_symbol} = {value_expr}")
            # Variables produce declarations earlier; skip here
            # Move to default 'out' or first available exec out
            next_uid = None
            refs = exec_out.get(cur) or {}
            if 'out' in refs:
                next_uid = refs.get('out')
            else:
                # pick any remaining single exec out
                next_uid = next((refs[k] for k in refs if k), None)
            cur = next_uid

    # First, do a pass to identify all reachable blocks (including operators)
    reachable_blocks = set()
    def find_reachable_blocks(start_uid: Optional[str]):
        """Find all blocks reachable from start_uid (including operators via variable connections)"""
        if not start_uid or start_uid in reachable_blocks or start_uid not in uid_to_block:
            return
        reachable_blocks.add(start_uid)
        
        block = uid_to_block[start_uid]
        
        # Follow execution connections
        refs = exec_out.get(start_uid) or {}
        for next_uid in refs.values():
            if next_uid:
                find_reachable_blocks(next_uid)
        
        # Follow variable input connections to find operators
        var_refs = block.get('variables_input_references') or []
        for ref in var_refs:
            if isinstance(ref, str) and ':out:' in ref:
                from_uid, _ = ref.split(':out:', 1)
                find_reachable_blocks(from_uid)
    
    # Find all reachable blocks starting from BeginPlay
    for start in begins or []:
        find_reachable_blocks(start)
    
    # Process operators first (in dependency order)
    processed_operators = set()
    def process_operators_for_block(block_uid: str):
        """Process all operators that feed into this block"""
        if block_uid not in uid_to_block or block_uid in processed_operators:
            return
        block = uid_to_block[block_uid]
        
        # First, recursively process operators that this block depends on
        refs = block.get('variables_input_references') or []
        for ref in refs:
            if isinstance(ref, str) and ':out:' in ref:
                from_uid, _ = ref.split(':out:', 1)
                if from_uid in uid_to_block:
                    source_block = uid_to_block[from_uid]
                    if (source_block.get('button_class') or '').lower() == 'operator':
                        process_operators_for_block(from_uid)
        
        # Then process this block if it's an operator
        if (block.get('button_class') or '').lower() == 'operator':
            processed_operators.add(block_uid)
            call_line = function_call_line(block)
            if call_line:
                lines.append(call_line)
    
    # Process all reachable operators
    for uid in reachable_blocks:
        if uid in uid_to_block:
            process_operators_for_block(uid)
    
    # Then, generate code lines by walking from Begin Play (populates imports)
    for start in begins or []:
        gen_branch(start, 0)

    # Now build header so we can include collected imports
    header: List[str] = []
    header.append("# Auto-generated script\n")
    if imports:
        header.extend(sorted(imports))
    # Always allow Any hints if variables present
    if var_decls and 'from typing import Any' not in header:
        header.append('from typing import Any')
    if header and header[-1] != '':
        header.append('')
    if var_decls:
        header.append('# Variables')
        header.extend(var_decls)
        header.append('')

    script_text = '\n'.join(header + lines) + '\n'
    # Write stubs for custom functions if requested
    modules_dir = Path(__file__).resolve().parent / 'modules'
    try:
        modules_dir.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    for fn_name, blk in stub_tasks:
        stub_path = modules_dir / f"{fn_name}.py"
        if not stub_path.exists():
            try:
                meta = json.dumps(blk, indent=2)
                stub_path.write_text(
                    f"\"\"\"\nAuto-generated stub for custom function '{fn_name}'.\nBlock metadata:\n{meta}\n\"\"\"\n\n"
                    f"def {fn_name}(*args, **kwargs):\n"
                    f"    raise NotImplementedError('Implement {fn_name}()')\n",
                    encoding='utf-8'
                )
            except Exception as e:
                print(f"[py] Failed writing stub {stub_path}: {e}", file=sys.stderr)

    # Output script
    print(script_text, flush=True)