import os
import pathlib
import sys
import paramiko


HOST = "192.168.2.11"
LOCAL_ARCHIVE = pathlib.Path(__file__).with_name("build-context.tar.gz")
REMOTE_ARCHIVE = "/models_data/.det-dashboard-build-context.tar.gz"


def main():
    password = os.environ.get("DET_SSH_PASSWORD")
    if not password:
        raise SystemExit("DET_SSH_PASSWORD is required")
    if not LOCAL_ARCHIVE.is_file():
        raise SystemExit(f"missing archive: {LOCAL_ARCHIVE}")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        HOST,
        username="root",
        password=password,
        timeout=20,
        banner_timeout=30,
        auth_timeout=20,
        allow_agent=False,
        look_for_keys=False,
    )
    try:
        stdin, stdout, stderr = client.exec_command(
            "if [ -e /models_data/det-dashboard ]; then "
            "echo TARGET_EXISTS; find /models_data/det-dashboard -maxdepth 2 -print | head -80; "
            "else echo TARGET_FREE; fi; docker-compose version",
            timeout=30,
        )
        check_out = stdout.read().decode(errors="replace")
        check_err = stderr.read().decode(errors="replace")
        print(check_out, end="")
        print(check_err, end="", file=sys.stderr)
        if stdout.channel.recv_exit_status() != 0 or "TARGET_FREE" not in check_out:
            raise SystemExit("deployment target is not empty or Docker Compose is unavailable")

        with client.open_sftp() as sftp:
            sftp.put(str(LOCAL_ARCHIVE), REMOTE_ARCHIVE)

        command = r'''set -euo pipefail
BUILD_ROOT=/models_data/.det-dashboard-build
FINAL_ROOT=/models_data/det-dashboard
cleanup() {
  rm -rf "$BUILD_ROOT"
  rm -f /models_data/.det-dashboard-build-context.tar.gz
}
trap cleanup EXIT
mkdir -p "$BUILD_ROOT"
tar -xzf /models_data/.det-dashboard-build-context.tar.gz -C "$BUILD_ROOT"
cd "$BUILD_ROOT"
docker build --pull -f migration/ascend910b-openeuler/Dockerfile.app -t det-dashboard-app:arm64 .
docker pull postgres:16
docker pull minio/minio:latest
mkdir -p "$FINAL_ROOT/deploy" "$FINAL_ROOT/runtime/postgres" "$FINAL_ROOT/runtime/minio" "$FINAL_ROOT/runtime/app/data-root" "$FINAL_ROOT/runtime/app/cache" "$FINAL_ROOT/runtime/app/exports"
cp migration/ascend910b-openeuler/compose.yml "$FINAL_ROOT/deploy/compose.yml"
cp migration/ascend910b-openeuler/start.sh "$FINAL_ROOT/deploy/start.sh"
cp migration/ascend910b-openeuler/stop.sh "$FINAL_ROOT/deploy/stop.sh"
cp migration/ascend910b-openeuler/verify.sh "$FINAL_ROOT/deploy/verify.sh"
cp migration/ascend910b-openeuler/README.md "$FINAL_ROOT/deploy/README.md"
cp db/schema.sql "$FINAL_ROOT/deploy/schema.sql"
chmod 700 "$FINAL_ROOT/deploy/"*.sh
umask 077
DB_PASSWORD=$(openssl rand -hex 24)
MINIO_PASSWORD=$(openssl rand -hex 24)
cat > "$FINAL_ROOT/deploy/.env" <<EOF
DEPLOY_ROOT=/models_data/det-dashboard
APP_BIND_ADDRESS=0.0.0.0
APP_PORT=5173
POSTGRES_DB=det_dashboard
POSTGRES_USER=det
POSTGRES_PASSWORD=$DB_PASSWORD
MINIO_ROOT_USER=detminio
MINIO_ROOT_PASSWORD=$MINIO_PASSWORD
MINIO_BUCKET=zbh-datasets
EOF
cd "$FINAL_ROOT/deploy"
docker-compose --env-file .env -f compose.yml config --quiet
docker-compose --env-file .env -f compose.yml up -d
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:5173/api/health/ready; then
    echo
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    docker-compose --env-file .env -f compose.yml ps
    docker logs det-dashboard-app --tail 200
    exit 1
  fi
  sleep 5
done
docker-compose --env-file .env -f compose.yml ps
docker exec det-dashboard-postgres psql -U det -d det_dashboard -Atc 'select count(*) from projects;'
docker exec det-dashboard-minio sh -c 'find /data -mindepth 1 -maxdepth 2 -type f | head'
docker image inspect det-dashboard-app:arm64 --format '{{.Architecture}} {{.Os}} {{.Size}}'
cleanup
trap - EXIT
test ! -e "$BUILD_ROOT"
'''
        transport = client.get_transport()
        channel = transport.open_session()
        channel.set_combine_stderr(True)
        channel.exec_command(command)
        while True:
            if channel.recv_ready():
                sys.stdout.write(channel.recv(65536).decode(errors="replace"))
                sys.stdout.flush()
            if channel.exit_status_ready() and not channel.recv_ready():
                break
        status = channel.recv_exit_status()
        if status:
            raise SystemExit(status)
    finally:
        client.close()


if __name__ == "__main__":
    main()
