import os
import pathlib
import sys
import paramiko

ROOT = pathlib.Path(__file__).parent

def main():
    password = os.environ.get("DET_SSH_PASSWORD")
    if not password:
        raise SystemExit("DET_SSH_PASSWORD is required")
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect("192.168.2.11", username="root", password=password, timeout=20, banner_timeout=30, auth_timeout=20, allow_agent=False, look_for_keys=False)
    try:
        _, o, e = c.exec_command("test -d /models_data/.det-dashboard-offline && echo STAGE_READY || echo STAGE_MISSING", timeout=30)
        check = o.read().decode(errors="replace")
        print(check, end="")
        print(e.read().decode(errors="replace"), end="", file=sys.stderr)
        if "STAGE_READY" not in check:
            raise SystemExit("offline image stage is missing")
        stage = "/models_data/.det-dashboard-offline"
        c.exec_command(f"mkdir -p {stage}")[1].read()
        with c.open_sftp() as sftp:
            for name in ["det-dashboard-app-arm64-v4.tar", "compose.yml", "start.sh", "stop.sh", "verify.sh", "README.md", "schema.sql"]:
                p = ROOT / name
                print(f"uploading {name} ({p.stat().st_size} bytes)", flush=True)
                sftp.put(str(p), f"{stage}/{name}")
        command = """set -euo pipefail
STAGE=/models_data/.det-dashboard-offline
FINAL=/models_data/det-dashboard
docker load -i $STAGE/det-dashboard-app-arm64-v4.tar
docker load -i $STAGE/postgres-16-arm64.tar
docker load -i $STAGE/minio-arm64.tar
mkdir -p $FINAL/deploy $FINAL/runtime/postgres $FINAL/runtime/minio $FINAL/runtime/app/data-root $FINAL/runtime/app/cache $FINAL/runtime/app/exports
cp $STAGE/compose.yml $FINAL/deploy/compose.yml
cp $STAGE/start.sh $STAGE/stop.sh $STAGE/verify.sh $STAGE/README.md $FINAL/deploy/
cp $STAGE/schema.sql $FINAL/deploy/schema.sql
umask 077
DB_PASSWORD=$(openssl rand -hex 24)
MINIO_PASSWORD=$(openssl rand -hex 24)
cat > $FINAL/deploy/.env <<EOF
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
chmod 700 $FINAL/deploy/*.sh
cd $FINAL/deploy
docker-compose --env-file .env -f compose.yml config --quiet
docker-compose --env-file .env -f compose.yml up -d
for attempt in $(seq 1 36); do
  if curl -fsS http://127.0.0.1:5173/api/health/ready; then echo; break; fi
  if [ $attempt -eq 36 ]; then docker-compose --env-file .env -f compose.yml ps; docker logs det-dashboard-app --tail 200; exit 1; fi
  sleep 5
done
docker-compose --env-file .env -f compose.yml ps
docker exec det-dashboard-postgres psql -U det -d det_dashboard -Atc 'select count(*) from projects'
docker image inspect det-dashboard-app:arm64 --format '{{.Architecture}} {{.Os}} {{.Size}}'
rm -rf $STAGE
"""
        ch = c.get_transport().open_session()
        ch.set_combine_stderr(True)
        ch.exec_command(command)
        while True:
            if ch.recv_ready():
                sys.stdout.write(ch.recv(65536).decode(errors="replace"))
                sys.stdout.flush()
            if ch.exit_status_ready() and not ch.recv_ready():
                break
        status = ch.recv_exit_status()
        if status:
            raise SystemExit(status)
    finally:
        c.close()

if __name__ == "__main__":
    main()
