## ReminderZs – Project Rules and Data Contracts

This document captures the standards we agreed on for the Electron UI, block model, Python bridge, and code generation pipeline.

### 1) Block Model (JSON contract)
Each block emitted by the UI must include these fields:

- id: string – block class/type identifier (e.g., "Function", fully qualified function name, or a custom name)
- uid: string – globally unique ID for this block instance
- button_class: "Executor" | "Function" | "Variable" | "Conditional"
- has_input_executor: boolean
- has_output_executor: boolean
- exec_input_nodes: string[] – ordered list of exec input port keys (N inputs)
- exec_output_nodes: string[] – ordered list of exec output port keys (N outputs)
- variables_input_nodes: string[] – ordered list of variable input names
- variables_input_nodes_types: string[] – same length as above
- variables_output_nodes: string[] – ordered list of variable output names
- variables_output_nodes_types: string[] – same length as above
- variables_input_references: (string | null)[] – ordered list; one entry per variable input
  - A value is one of:
    - variable UID (from a `Variable` block)
    - upstream output spec: "<fromUid>:out:<index>" (index is the numeric output slot)
    - null when unconnected
- variables_output_references: (string[] | null)[] – ordered list; one entry per variable output (fan‑out allowed)
  - For each output index:
    - null when unconnected
    - otherwise an array of references for all targets connected to this output, where a value is a target port spec "<toUid>:in:<index>" (or a variable UID in edge cases)
- exec_out_refs: { [outKey: string]: toUid } – execution edges for each exec output key
- exec_in_refs: { [inKey: string]: fromUid } – reverse mapping (optional; informational)
- function_name: string | null – fully qualified function name for `Function` blocks (e.g., "package.module.func" or "builtins.print")
- extra_context_string: string | null – free-form note
- variable: object | undefined – for `Variable` blocks only
  - name: string
  - type: string
  - value: any (default value)
  - is_global: boolean
  - global_id: string | null
  - local_id: string | null
  - uid: string (variable UID)

Example – standardized references for a 2-arg function print(a, b):

```json
{
  "button_class": "Function",
  "function_name": "builtins.print",
  "variables_input_nodes": ["a", "b"],
  "variables_input_references": [
    "eaedc8eb-bf49-4181-8350-0e50a70e7f04",
    null
  ],
  "variables_output_nodes": [],
  "variables_output_references": []
}
```

If only b is connected: `[null, "<var-uid>"]`. Always one entry per input; null means unconnected.

For outputs: one entry per output. Each entry is null or an array of target refs.

### 2) Block Type Rules
- Variable
  - exec_input_nodes = [], exec_output_nodes = []
  - Exactly one variable output (named "value"), no inputs
  - `variable_uid` attached to the block; `variable` object contains default, name, type
  - Variable outputs MAY connect to multiple targets (fan‑out). Variable inputs accept a single incoming connection.

- Function
  - exec_input_nodes typically ["in"], exec_output_nodes typically ["out"]
  - `function_name` required for premade/discovered ones; may be `builtins.<name>` or `modules.<pkg>.<func>`
  - Inputs and outputs are ordered and must be reflected 1:1 in `variables_input_nodes`/`variables_output_nodes` and their reference arrays

- Conditional (IF)
  - exec_input_nodes = ["in"], exec_output_nodes = ["then", "else"]
  - Single boolean variable input: ["condition"] (type bool)

- Executor
  - Used for flow control
  - A special `BeginPlay` Executor is always present; compile considers only blocks reachable from it

Connection cardinality:
- Exec outputs: max 1 active connection per output key
- Exec inputs: max 1 incoming connection
- Variable outputs: unlimited fan‑out
- Variable inputs: max 1 incoming connection

### 3) Connections
- Exec connections are keyed by node label (from `exec_output_nodes`), stored in `exec_out_refs` as `key → toUid`.
- Variable connections are standardized as described above.
- Deleting a block must remove its exec and var connections.

### 4) Canvas & Interaction
- Infinite canvas with pan (drag background or RMB/MMB) and wheel-zoom around cursor
- Blocks are appended under `#canvas-content` and transformed via CSS `translate(x,y) scale(s)`
- Connection lines are rendered in an overlay SVG and recomputed on pan/zoom/drag
- Pins
  - Exec inputs on the left, vertically stacked
  - Exec outputs on the right, vertically stacked
  - Variable inputs on the left, variable outputs on the right; all vertically aligned

### 5) Premade Blocks & Discovery
- Built-in examples: Print, Add, Max, Var, If
- Discovered functions: the app scans `App/modules/*.py` using `App/indexer.py` → `modules_discovery.py`
- For each discovered function, a premade `Function` block is generated with ordered inputs (excluding *args/**kwargs markers) and one output named `result` (or type-derived).

### 6) IPC Bridge & Python Execution
- Compile button collects the current canvas into the standardized JSON and calls `backend:generate`
- Main process spawns the Python script:
  - Preferred: `conda run -n RemainderV0 python App/main.py '<json>'`
  - Fallback: `python3 App/main.py '<json>'` if conda/env is unavailable
  - Kills any previously running backend process before starting a new one
  - Passes `PYTHONUNBUFFERED=1` and optionally `PY_DEBUG=1` (see Debugging)
- Python stdout/stderr are shown in the UI compile panel

### 7) Debugging Python
- When `PY_DEBUG=1`, `App/main.py` starts a `debugpy` server on `127.0.0.1:5678` and waits for a client
- In VS Code, attach to host `127.0.0.1`, port `5678`

### 8) Code Generation (Script Maker)
- Lives in `App/main.py` and receives the blocks JSON via argv
- Steps:
  1) Build a map of variables (UID → symbol), emit top-level variable declarations with defaults (and type hints)
  2) Walk the execution graph from `BeginPlay` following `exec_out_refs` in order. When encountering a `Conditional`, generate `if/else` and recursively traverse both branches
  3) For each `Function` block, resolve inputs from `variables_input_references` in order:
     - variable UID → variable symbol (cast to expected input type if annotated as str | int | float | bool)
     - upstream output ref `fromUid:out:index` → symbol produced by that function output (no casting applied)
     - null → `None`
  4) Emit imports for `modules.<pkg>.<func>`; call `builtins.<name>` directly
  5) Emit assignment for outputs, one symbol per output in order
  6) For custom functions without a known module, create a stub file under `App/modules/<name>.py` containing the block metadata
- Only blocks reachable (directly or indirectly) from `BeginPlay` are included. Variable-only sources feeding included blocks are also included.

Variable defaults:
- If a variable’s default value is a numeric‑looking string (integer/float/scientific), it is emitted as a numeric literal instead of a quoted string.

### 9) UIDs & References
- Every block has a unique `uid`
- Variable blocks also carry `variable_uid` and an embedded `variable` object
- All exec/var references must ultimately resolve to UIDs or port specs; order must be preserved as described

### 10) Deletion & Guards
- `BeginPlay` cannot be deleted
- Deleting any other block removes its exec and var connections and redraws lines

### 11) Naming & Style
- Inputs/outputs listed in `variables_*_nodes` must be reflected 1:1 in their corresponding reference arrays (maintain order, use nulls for gaps)
- Exec ports are configured by `exec_input_nodes`/`exec_output_nodes`; only `Conditional` is allowed to have two exec outputs by default, but the model supports N exec ports generically

### 12) Save/Load Projects
- Save writes JSON containing:
  - blocks: full graph with positions `{ position: { x, y } }`, all refs, function_name, and for Variable blocks the `variable` object and `variable_uid`
  - variables: sidebar variable catalog (name, type, value, uid, global/local flags)
- Load clears the canvas, restores variables in the sidebar, recreates all blocks at saved positions, rebinds exec and variable edges, then redraws connections.


