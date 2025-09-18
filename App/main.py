import sys, json, os

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
    # your generation logic here
    print("Received", len(blocks), "blocks", flush=True)
    print("Received", len(blocks), "blocks")

    for block in blocks:
        print(block)