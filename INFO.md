# ReminderZs – Quick Info

This app provides a block‑based UI (Electron) with a Python backend to generate scripts.

## UI Basics
- Blocks: Executor (BeginPlay), Function, Variable, Conditional (If), Operator
- Left sidebar: built‑ins, discovered functions, variables list (drag to canvas)
- Canvas: infinite pan/zoom; blocks are draggable with multi-selection (Ctrl+click, Ctrl+drag)
- Pins: exec inputs left, exec outputs right; variable inputs left, outputs right
- Connections: exec = single per output; var outputs can fan‑out; var inputs single
- Inline Values: Input ports with default types (bool, int, float, string, any) show input fields for direct value entry

## Data Contract (per block)
- See `RULES.md` for the full schema
- Key fields: `uid`, `button_class`, `exec_input_nodes`, `exec_output_nodes`, `variables_input_nodes`, `variables_input_references`, `variables_output_references`, `exec_out_refs`, `function_name`, `inline_values`
- Variables embed `{ name, type, value, uid, is_global, global_id, local_id }`
- Inline values stored as `{ "0": value, "1": value }` indexed by input port position

## Compile & Debug
- **Compile Button**: Located in top-right topbar with gradient styling and play icon
- **Debug Window**: Floating window with two tabs:
  - **Output**: Shows JSON conversion result, execution status, and Python output/errors
  - **Generated Script**: Displays the actual Python code generated from blocks
- **Window Controls**: Minimize (−) and close (×) buttons; reopens automatically on next compile
- **Backend**: Runs `App/main.py` via Conda env `RemainderV0` (fallback to system python)
- **Debug Mode**: "Debug Python" checkbox starts debugpy server on 127.0.0.1:5678

## Script Generation Rules
- Start at BeginPlay; walk exec graph in order
- If: generate `if/else` and traverse both branches (empty branches get `pass` or are omitted)
- Variables: emitted at top with default values; numeric‑looking strings and booleans become literals
- Function inputs: resolved from `variables_input_references` (ordered) or `inline_values` when no connection
- Inline values: used when input port has no connection; type-validated (bool/int/float/str/any)
- Variable inputs: cast to expected types (str/int/float/bool) when annotated
- Function outputs: chained by `fromUid:out:index`
- Imports: `from modules.<pkg> import <func>` for discovered functions; `builtins.<name>` called directly
- Custom functions get a stub under `App/modules/<name>.py`

## Save/Load
- Save writes JSON with all blocks (including `{ position: {x,y} }`, `inline_values`) and the variables catalog
- Load restores variables in the sidebar, recreates blocks at saved positions, restores inline values, and rebinds all connections

## Multi-Selection
- **Ctrl+Click**: Select/deselect individual blocks (keep existing selection)
- **Ctrl+Drag**: Area selection with visual rectangle
- **Coordinated Movement**: Drag any selected block to move all selected blocks together
- **Clear Selection**: Click empty canvas without Ctrl to deselect all
