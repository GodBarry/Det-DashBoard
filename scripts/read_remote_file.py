#!/usr/bin/env python3
"""Read a text file from the Ascend server through SFTP."""

from __future__ import annotations

import os
import sys

import paramiko


HOST = "192.168.2.11"
USER = "root"


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        raise RuntimeError("Usage: read_remote_file.py <remote-path> [max-chars]")
    password = os.environ.get("DET_SSH_PASSWORD")
    if not password:
        raise RuntimeError("DET_SSH_PASSWORD is not set")
    remote_path = argv[1]
    max_chars = int(argv[2]) if len(argv) > 2 else 12000

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
            with sftp.open(remote_path, "r") as handle:
                data = handle.read(max_chars)
        finally:
            sftp.close()
    finally:
        client.close()
    if isinstance(data, bytes):
        data = data.decode("utf-8", errors="replace")
    print(data, end="")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv))
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
