"""Kiro Crew app hooks: start AgentMon Live's web server with the gateway.

Runs inside the Kiro Crew gateway, with its rights, so it does the least it can:
write one small file and start one `node` process. Standard library only.
"""

import glob
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

PORT = 47311
ROOT = Path(__file__).resolve().parent.parent
STATE = Path(os.environ.get("AGENTMON_KIRO_FILE") or Path.home() / ".claude" / "agentmon-live" / "kiro.json")


def find_node():
    # The gateway's PATH has no version manager's folder, where node most often lives.
    found = shutil.which("node")
    if found:
        return found
    home = str(Path.home())
    managed = sorted(
        glob.glob(home + "/.nvm/versions/node/*/bin/node") + glob.glob(home + "/.local/share/fnm/node-versions/*/installation/bin/node"),
        key=os.path.getmtime,
        reverse=True,
    )
    for path in managed + [home + "/.volta/bin/node", "/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]:
        if os.access(path, os.X_OK):
            return path
    return None


def gateway_port(argv=None):
    argv = sys.argv if argv is None else argv
    for i, arg in enumerate(argv):
        value = arg.split("=", 1)[1] if arg.startswith("--port=") else argv[i + 1] if arg == "--port" and i + 1 < len(argv) else ""
        if value.isdigit():
            return int(value)
    return 5476


def write_state(pid, port):
    STATE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps({"pid": pid, "origins": [f"http://127.0.0.1:{port}", f"http://localhost:{port}"]}))
    os.replace(tmp, STATE)


def on_startup(ctx=None):
    log = getattr(ctx, "logger", None)
    try:
        write_state(os.getpid(), gateway_port())
        node = find_node()
        if not node:
            if log:
                log.warning("AgentMon Live: no node found; install Node.js and enable the app again")
            return
        # Not waited for: the gateway's event loop runs this hook, and `ensure` can take seconds when it replaces an older server.
        subprocess.Popen([node, str(ROOT / "server" / "web.mjs"), "ensure", str(PORT)], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        if log:
            log.info("AgentMon Live: web view asked for on http://127.0.0.1:%s", PORT)
    except Exception as error:  # Kiro Crew must start whatever happens here.
        if log:
            log.warning("AgentMon Live: start hook failed: %s", error)


def on_shutdown(ctx=None):
    # Without the file the server stops by itself a minute after its last session; another gateway's file stays.
    try:
        if json.loads(STATE.read_text()).get("pid") == os.getpid():
            STATE.unlink()
    except Exception:
        pass


if __name__ == "__main__":
    assert gateway_port(["gw", "--port", "6000"]) == 6000 and gateway_port(["gw", "--port=6001"]) == 6001 and gateway_port(["gw"]) == 5476
    kept = os.environ.get("PATH", "")
    os.environ["PATH"] = ""
    node = find_node()
    os.environ["PATH"] = kept
    print("node without PATH:", node)
