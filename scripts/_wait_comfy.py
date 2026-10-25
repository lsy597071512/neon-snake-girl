# -*- coding: utf-8 -*-
"""Poll ComfyUI until /system_stats answers (for startup waits)."""
import sys
import time
import urllib.request

url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8188/system_stats"
budget = float(sys.argv[2]) if len(sys.argv) > 2 else 600.0
t0 = time.time()
while time.time() - t0 < budget:
    try:
        urllib.request.urlopen(url, timeout=8).read()
        print("READY", flush=True)
        sys.exit(0)
    except Exception as e:
        print(f"waiting {time.time()-t0:.0f}s: {e}", flush=True)
        time.sleep(10)
print("TIMEOUT", flush=True)
sys.exit(1)
