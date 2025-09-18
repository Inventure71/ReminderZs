# ReminderZs – Quick Info

This app provides a block‑based UI (Electron) with a Python backend to generate scripts.

## UI Basics
- Blocks: Executor (BeginPlay), Function, Variable, Conditional (If)
- Left sidebar: built‑ins, discovered functions, variables list (drag to canvas)
- Canvas: infinite pan/zoom; blocks are draggable
- Pins: exec inputs left, exec outputs right; variable inputs left, outputs right
- Connections: exec = single per output; var outputs can fan‑out; var inputs single

## Data Contract (per block)
- See `RULES.md` for the full schema
- Key fields: `uid`, `button_class`, `exec_input_nodes`, `exec_output_nodes`, `variables_input_nodes`, `variables_input_references`, `variables_output_references`, `exec_out_refs`, `function_name`
- Variables embed `{ name, type, value, uid, is_global, global_id, local_id }`

## Compile
- Clicking Compile exports the graph (standardized JSON) and runs `App/main.py` via Conda env `RemainderV0` (fallback to system python)
- Output shows the generated Python script and backend stdout/stderr
- “Debug Python” starts a debug server in main.py (debugpy on 127.0.0.1:5678)

## Script Generation Rules
- Start at BeginPlay; walk exec graph in order
- If: generate `if/else` and traverse both branches
- Variables: emitted at top with default values; numeric‑looking strings become numeric literals
- Function inputs: resolved from `variables_input_references` (ordered); variable inputs are cast to expected types (str/int/float/bool) when annotated; function outputs are chained by `fromUid:out:index`
- Imports: `from modules.<pkg> import <func>` for discovered functions; `builtins.<name>` called directly
- Custom functions get a stub under `App/modules/<name>.py`

## Save/Load
- Save writes JSON with all blocks (including `{ position: {x,y} }`) and the variables catalog
- Load restores variables in the sidebar, recreates blocks at saved positions, and rebinds all connections
