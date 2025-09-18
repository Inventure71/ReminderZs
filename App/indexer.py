#!/usr/bin/env python3
import ast
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Union
import os

# ---------- Helpers ----------

def get_src_segment(source: str, node: Optional[ast.AST]) -> Optional[str]:
    if node is None:
        return None
    try:
        return ast.get_source_segment(source, node)
    except Exception:
        return None

def ann_to_str(source: str, ann: Optional[ast.AST]) -> Optional[str]:
    txt = get_src_segment(source, ann)
    return txt.strip() if txt else None

def default_to_str(source: str, d: Optional[ast.AST]) -> Optional[str]:
    if d is None:
        return None
    txt = get_src_segment(source, d)
    if txt:
        return txt.strip()
    # Fallback for literals when segment not available
    if isinstance(d, ast.Constant):
        return repr(d.value)
    return None

def decorator_name(source: str, dec: ast.AST) -> str:
    txt = get_src_segment(source, dec)
    return txt.strip() if txt else dec.__class__.__name__

def param_entry(source: str, arg: ast.arg, default_node: Optional[ast.AST], kind: str) -> Dict[str, Any]:
    return {
        "name": arg.arg,
        "kind": kind,  # posonly | posonly+default | pos | pos+default | vararg | kwonly | kwonly+default | varkw
        "annotation": ann_to_str(source, arg.annotation),
        "default": default_to_str(source, default_node),
    }

def extract_params(source: str, args: ast.arguments) -> List[Dict[str, Any]]:
    params: List[Dict[str, Any]] = []

    # Positional-only
    posonly = getattr(args, "posonlyargs", [])
    for i, a in enumerate(posonly):
        # Defaults correspond to last N positional params (posonly + args)
        all_pos = posonly + args.args
        num_defaults = len(args.defaults)
        default_start = len(all_pos) - num_defaults
        idx = i
        default_node = args.defaults[idx - default_start] if idx >= default_start else None
        params.append(param_entry(source, a, default_node, "posonly" + ("" if default_node is None else "+default")))

    # Positional-or-keyword
    for i, a in enumerate(args.args):
        all_pos = posonly + args.args
        num_defaults = len(args.defaults)
        default_start = len(all_pos) - num_defaults
        idx = len(posonly) + i
        default_node = args.defaults[idx - default_start] if idx >= default_start else None
        params.append(param_entry(source, a, default_node, "pos" + ("" if default_node is None else "+default")))

    # *args
    if args.vararg:
        params.append({
            "name": args.vararg.arg,
            "kind": "vararg",
            "annotation": ann_to_str(source, args.vararg.annotation),
            "default": None
        })

    # Keyword-only
    for a, d in zip(args.kwonlyargs, args.kw_defaults):
        params.append(param_entry(source, a, d, "kwonly" + ("" if d is None else "+default")))

    # **kwargs
    if args.kwarg:
        params.append({
            "name": args.kwarg.arg,
            "kind": "varkw",
            "annotation": ann_to_str(source, args.kwarg.annotation),
            "default": None
        })

    return params

def function_record(source: str, node: Union[ast.FunctionDef, ast.AsyncFunctionDef], parent_class: Optional[str]) -> Dict[str, Any]:
    decorators = [decorator_name(source, d) for d in node.decorator_list]
    # classify method type for class members
    method_type = None
    if parent_class:
        if any("staticmethod" in d for d in decorators):
            method_type = "staticmethod"
        elif any("classmethod" in d for d in decorators):
            method_type = "classmethod"
        else:
            method_type = "instance"

    returns = ann_to_str(source, node.returns)
    return {
        "name": node.name,
        "qualified_name": f"{parent_class}.{node.name}" if parent_class else node.name,
        "async": isinstance(node, ast.AsyncFunctionDef),
        "class": parent_class,
        "method_type": method_type,
        "lineno": node.lineno,
        "col_offset": node.col_offset,
        "decorators": decorators,
        "docstring": ast.get_docstring(node),
        "inputs": extract_params(source, node.args),
        "output": returns,  # return annotation as string (if any)
    }

def is_overload(decorators: List[str]) -> bool:
    # crude but robust (covers from typing import overload, typing.overload, etc.)
    return any("overload" in d for d in decorators)

# ---------- Core analyzer ----------

def analyze_file(path: Path) -> Dict[str, Any]:
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(path))

    results: List[Dict[str, Any]] = []
    module_doc = ast.get_docstring(tree)

    for node in tree.body:
        # Top-level functions
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            rec = function_record(source, node, parent_class=None)
            if is_overload(rec["decorators"]):
                rec["note"] = "typing.overload signature"
            results.append(rec)

        # Classes & methods
        elif isinstance(node, ast.ClassDef):
            for sub in node.body:
                if isinstance(sub, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    rec = function_record(source, sub, parent_class=node.name)
                    if is_overload(rec["decorators"]):
                        rec["note"] = "typing.overload signature"
                    results.append(rec)

    return {
        "file": str(path),
        "module_docstring": module_doc,
        "functions_count": len(results),
        "functions": results,
    }

# ---------- Markdown report ----------

def to_markdown(report: Dict[str, Any]) -> str:
    lines = []
    lines.append(f"# Function Report: `{Path(report['file']).name}`\n")
    if report.get("module_docstring"):
        lines.append("**Module docstring:**\n")
        lines.append(f"> {report['module_docstring']}\n")
    lines.append(f"**Total functions/methods:** {report['functions_count']}\n")

    for fn in report["functions"]:
        lines.append(f"## {fn['qualified_name']}")
        meta = []
        if fn["class"]:
            meta.append(f"class: `{fn['class']}` ({fn.get('method_type')})")
        if fn["async"]:
            meta.append("async")
        meta.append(f"line: {fn['lineno']}")
        if fn.get("decorators"):
            meta.append("decorators: " + ", ".join(f"`{d}`" for d in fn["decorators"]))
        if fn.get("note"):
            meta.append(f"note: {fn['note']}")
        lines.append("* " + " | ".join(meta))

        # Signature-like display
        sig_parts = []
        for p in fn["inputs"]:
            piece = p["name"]
            if p["annotation"]:
                piece += f": {p['annotation']}"
            if p["default"] is not None:
                piece += f" = {p['default']}"
            if p["kind"] in ("vararg", "varkw"):
                piece = ("*" if p["kind"] == "vararg" else "**") + piece
            elif p["kind"].startswith("posonly"):
                piece += " (/)"  # marker for pos-only
            sig_parts.append(piece)
        ret = f" -> {fn['output']}" if fn["output"] else ""
        lines.append(f"```python\n# signature\n{fn['name']}({', '.join(sig_parts)}){ret}\n```")

        if fn["docstring"]:
            lines.append("**Docstring:**")
            lines.append(f"> {fn['docstring']}\n")
        else:
            lines.append("_No docstring_\n")
    return "\n".join(lines)

# ---------- Public API (callable) ----------

def index_file(file: Union[str, Path], out_json: Optional[Union[str, Path]] = None, out_md: Optional[Union[str, Path]] = None) -> Dict[str, Any]:
    """Analyze a Python file, optionally write reports, and return the structured report.

    Parameters
    ----------
    file: Union[str, Path]
        Path to the Python source file to analyze.
    out_json: Optional[Union[str, Path]]
        If provided, write the JSON report to this path.
    out_md: Optional[Union[str, Path]]
        If provided, write a Markdown report to this path.

    Returns
    -------
    Dict[str, Any]
        The analysis report as a dictionary.
    """
    target = Path(file)
    if not target.exists():
        print("Current working directory: ", os.getcwd())
        raise FileNotFoundError(f"File not found: {target}")

    report = analyze_file(target)

    if out_json:
        Path(out_json).write_text(
            json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
        )

    if out_md:
        md = to_markdown(report)
        Path(out_md).write_text(md, encoding="utf-8")

    return report

__all__ = ["analyze_file", "to_markdown", "index_file"]
