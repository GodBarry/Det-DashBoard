# Det Dashboard ARM64 / openEuler deployment

This deployment runs the platform without NPU access. The application listens
on port `5173`; PostgreSQL and MinIO are reachable only on the internal Docker
network. Runtime data is created below `/models_data/det-dashboard/runtime`.

The application image is expected to contain only the Vite production output,
the packaged backend bytecode, and runtime dependencies. Do not copy a build
context or repository checkout into the final deployment directory.

## Files required on the server

- `compose.yml`
- `.env`
- `schema.sql`
- `start.sh`, `stop.sh`, and `verify.sh`
- the locally loaded `det-dashboard-app:arm64` image
- ARM64 `postgres:16` and `minio/minio:latest` images

## Start and verify

```bash
chmod 700 start.sh stop.sh verify.sh
./start.sh
./verify.sh
```

Open `http://192.168.2.11:5173` after the readiness check succeeds.

`docker-compose down` does not delete database or object-store data. Never use
`down -v` for this bind-mounted deployment.
