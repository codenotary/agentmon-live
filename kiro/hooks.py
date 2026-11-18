"""Kiro Crew app hooks: start AgentMon Live's web server with the gateway.

Runs inside the Kiro Crew gateway, with its rights, so it does the least it can:
write two small files and start one `node` process. Standard library only.
"""

import glob
import json
import os
import re
import secrets
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
        key=lambda path: [int(n) for n in re.findall(r"\d+", path[len(home):])],
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


def start_of(pid):
    # When the system started the process, on Linux: the server tells this gateway from a later process with its pid.
    try:
        stat = Path(f"/proc/{pid}/stat").read_text()
        return int(stat[stat.rindex(")") + 2 :].split(" ")[19])
    except Exception:
        return None


def write_state(pid, port):
    STATE.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = STATE.with_suffix(".tmp")
    state = {"pid": pid, "origins": [f"http://127.0.0.1:{port}", f"http://localhost:{port}"]}
    if (start := start_of(pid)) is not None:
        state["start"] = start
    tmp.write_text(json.dumps(state))
    os.replace(tmp, STATE)


def place_token(data_dir):
    # The web view's secret goes where the manifest's credentialMasks hides it from the sandbox, before a sandboxed process starts; same value, so a running server keeps working.
    token = Path(data_dir) / "web.token"
    if token.exists():
        return
    legacy = STATE.parent / "web.token"
    try:
        value = legacy.read_text().strip()
    except OSError:
        value = ""
    if not re.fullmatch(r"[0-9a-f]{64}", value):
        value = secrets.token_hex(32)
    token.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = token.with_name(f".web.token.{os.getpid()}")
    with os.fdopen(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as out:
        out.write(value)
    os.replace(tmp, token)
    legacy.unlink(missing_ok=True)


def ensure_args(node):
    # AGENTMON_WEB_OPEN=1 is `webToken: off` for a gateway with no Claude Code settings: any local process may read the sessions.
    return [node, str(ROOT / "server" / "web.mjs"), "ensure", str(PORT)] + (["--open"] if os.environ.get("AGENTMON_WEB_OPEN") == "1" else [])


def on_startup(ctx=None):
    log = getattr(ctx, "logger", None)
    try:
        write_state(os.getpid(), gateway_port())
        if getattr(ctx, "data_dir", None):
            try:
                place_token(ctx.data_dir)
            except Exception as error:  # Without it the secret stays in ~/.claude, unmasked as before; the server still starts.
                if log:
                    log.warning("AgentMon Live: could not move the web view's secret: %s", error)
        node = find_node()
        if not node:
            if log:
                log.warning("AgentMon Live: no node found; install Node.js and enable the app again")
            return
        # Not waited for: the gateway's event loop runs this hook, and `ensure` can take seconds when it replaces an older server.
        subprocess.Popen(ensure_args(node), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
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
