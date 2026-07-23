#!/usr/bin/env python3
"""Upload and execute the RoIAlign CPU fallback patch on the Ascend server."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import paramiko


HOST = "192.168.2.11"
USER = "root"
LOCAL_PATCH = Path(__file__).with_name("roi_align_cpu_fallback.py")
REMOTE_PATCH = "/tmp/roi_align_cpu_fallback.py"
REMOTE_COMMAND = (
    "bash -lc '"
    "source /usr/local/Ascend/ascend-toolkit/set_env.sh && "
    "export TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1 && "
    "/models_data/det-dashboard/runtime/npu-env/bin/python /tmp/roi_align_cpu_fallback.py"
    "'"
)


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


def main() -> int:
    password = os.environ.get("DET_SSH_PASSWORD")
    if not password:
        raise RuntimeError("DET_SSH_PASSWORD is not set")
    if not LOCAL_PATCH.exists():
        raise RuntimeError(f"Patch script not found: {LOCAL_PATCH}")

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
            sftp.put(str(LOCAL_PATCH), REMOTE_PATCH)
            sftp.chmod(REMOTE_PATCH, 0o755)
        finally:
            sftp.close()
        return run(client, REMOTE_COMMAND)
    finally:
        client.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
