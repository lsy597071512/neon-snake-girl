import subprocess, time, sys
from pathlib import Path
apply = Path(r"d:\neon-snake-girl\neon-snake-girl\.tmp-apply-chudian-cursor.py")
# wait until no Cursor process
for i in range(60):
    r = subprocess.run(["powershell","-NoProfile","-Command","(Get-Process -Name Cursor -ErrorAction SilentlyContinue | Measure-Object).Count"], capture_output=True, text=True)
    n = (r.stdout or "0").strip()
    print("cursor processes", n)
    if n == "0":
        break
    time.sleep(1)
else:
    print("timeout waiting for exit")
subprocess.check_call([sys.executable, str(apply)])
# relaunch
exe = r"C:\\Program Files\\Cursor\\Cursor.exe"
proj = r"d:\neon-snake-girl\neon-snake-girl"
if exe and Path(exe).exists():
    subprocess.Popen([exe, proj], close_fds=True)
    print("relaunched", exe)
