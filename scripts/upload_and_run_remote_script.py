#!/usr/bin/env python3
"""Upload a local script to the Ascend server and run it inside the NPU venv."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import paramiko


HOST = "192.168.2.11"
USER = "root"
REMOTE_PYTHON = "/models_data/det-dashboard/runtime/npu-env/bin/python"
REMOTE_PREFIX = "/tmp/det_dashboard_"


def run(client: paramiko.SSHClient, command: str) -> int:
    stdin, stdout, stderr = client.exec_command(command, get_pty=True)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    if out:
        print(out, end="")
    if err:
        print(err, end="", file=sys.stderr)
    print(f"EXIT_CODE={code}")
    return code


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        raise RuntimeError("Usage: upload_and_run_remote_script.py <local-script>")
    password = os.environ.get("DET_SSH_PASSWORD")
    if not password:
        raise RuntimeError("DET_SSH_PASSWORD is not set")

    local_script = Path(argv[1]).resolve()
    if not local_script.exists():
        raise RuntimeError(f"Local script not found: {local_script}")
    remote_script = f"{REMOTE_PREFIX}{local_script.name}"

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        hostname=HOST,
        username=USER,
        password=password,
        timeout=20,
        look_for_keys=False,
        allow_agent=False,
    )
    try:
        sftp = client.open_sftp()
        try:
            sftp.put(str(local_script), remote_script)
            sftp.chmod(remote_script, 0o755)
        finally:
            sftp.close()
        command = (
            "bash -lc '"
            "source /usr/local/Ascend/ascend-toolkit/set_env.sh && "
            "export TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1 && "
            f"{REMOTE_PYTHON} {remote_script}"
            "'"
        )
        return run(client, command)
    finally:
        client.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv))
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
