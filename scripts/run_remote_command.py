#!/usr/bin/env python3
"""Run a command on the Ascend server through SSH."""

from __future__ import annotations

import os
import sys

import paramiko


HOST = "192.168.2.11"
USER = "root"


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        raise RuntimeError("Usage: run_remote_command.py <command>")
    password = os.environ.get("DET_SSH_PASSWORD")
    if not password:
        raise RuntimeError("DET_SSH_PASSWORD is not set")
    command = argv[1]

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
    finally:
        client.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv))
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
