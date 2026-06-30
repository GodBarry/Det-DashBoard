const path = require("path");
const projectRoot = path.resolve(__dirname, "..");

function bool(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

module.exports = {
  port: Number(process.env.PORT || 4177),
  dataRoot: path.resolve(process.env.DATA_ROOT || path.join(projectRoot, "runtime", "data-root")),
  storageRoot: path.resolve(process.env.STORAGE_ROOT || path.join(projectRoot, "runtime")),
  databaseUrl: process.env.DATABASE_URL || "postgres://det:det_password@127.0.0.1:55434/det_dashboard",
  minio: {
    endPoint: process.env.MINIO_ENDPOINT || "localhost",
    port: Number(process.env.MINIO_PORT || 9000),
    useSSL: bool(process.env.MINIO_USE_SSL, false),
    accessKey: process.env.MINIO_ACCESS_KEY || "minioadmin",
    secretKey: process.env.MINIO_SECRET_KEY || "minioadmin",
    bucket: process.env.MINIO_BUCKET || "zbh-datasets",
    dataDir: path.resolve(process.env.MINIO_DATA_DIR || path.join(projectRoot, "runtime", "minio")),
  },
};
