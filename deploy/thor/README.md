# Jetson Thor deployment

This deployment keeps code and data separate:

- code: `/home/cngc209/det-dashboard`
- persistent data: `/home/cngc209/det-dashboard-data`
- external datasets/models: `/home/cngc209/Datasets`, `/home/cngc209/Models`

Never place PostgreSQL, MinIO, runtime storage, exports, or sidecar checkpoints
inside the Git checkout. This makes code upgrades and old-checkout removal safe.

Before a production upgrade, create and verify a PostgreSQL custom-format dump,
save the current application image, and record table/file counts. Apply
`db/migrations/20260812_remove_redundancy_and_add_performance_indexes.sql` only
after that backup succeeds.

Copy `.env.example` to `.env` and `sidecars.env.example` to
`/home/cngc209/det-dashboard-data/config/sidecars.env`, then set secrets locally.
Install the two unit files under `~/.config/systemd/user/`, run
`systemctl --user daemon-reload`, and enable both sidecars. The application
container reaches them through `host.containers.internal`.

Start the stack from the repository root:

```sh
podman-compose --env-file deploy/thor/.env -f deploy/thor/compose.yml up -d
```

The public application port is 5173. Network image inference listens on 4180
only while a user explicitly starts a network-inference session in the UI.
