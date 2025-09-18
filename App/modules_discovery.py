#!/usr/bin/env python3
import json
from pathlib import Path
from typing import Dict, Any, List

import sys

# Ensure we can import sibling module indexer.py
THIS_DIR = Path(__file__).resolve().parent
APP_DIR = THIS_DIR
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

import indexer as ix  # type: ignore


def discover_modules(modules_dir: Path) -> Dict[str, Any]:
    results: List[Dict[str, Any]] = []
    for py in sorted(modules_dir.glob("*.py")):
        if py.name.startswith("_") or py.name == "__init__.py":
            continue
        try:
            rep = ix.index_file(py)
        except Exception as e:
            results.append({
                "file": str(py),
                "error": str(e),
                "functions": []
            })
            continue
        # compute import-like module name relative to modules dir
        mod_name = py.stem
        for fn in rep.get("functions", []):
            fn_copy = dict(fn)
            fn_copy["module_file"] = str(py)
            fn_copy["module_name"] = mod_name
            results.append(fn_copy)
    return {"functions": results}


def main() -> None:
    mods = discover_modules(THIS_DIR / "modules")
    print(json.dumps(mods, ensure_ascii=False))


if __name__ == "__main__":
    main()



