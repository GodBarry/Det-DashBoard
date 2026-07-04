const path = require("path");
const fs = require("fs");
const projectRoot = path.resolve(__dirname, "..");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (process.env[key] != null) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile(path.join(projectRoot, ".env"));

function bool(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

module.exports = {
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 4177),
  dataRoot: path.resolve(process.env.DATA_ROOT || path.join(projectRoot, "runtime", "data-root")),
  dataRootDisplay: path.resolve(process.env.DATA_ROOT_DISPLAY || process.env.DATA_ROOT || path.join(projectRoot, "runtime", "data-root")),
  browseRoot: path.resolve(process.env.BROWSE_ROOT || process.env.DATA_ROOT || path.join(projectRoot, "runtime", "data-root")),
  browseRootDisplay: path.resolve(process.env.BROWSE_ROOT_DISPLAY || process.env.DATA_ROOT_DISPLAY || process.env.DATA_ROOT || path.join(projectRoot, "runtime", "data-root")),
  hostDialogUrl: process.env.HOST_DIALOG_URL || "",
  hostDialogToken: process.env.HOST_DIALOG_TOKEN || "",
  nativeDialogMode: process.env.NATIVE_DIALOG_MODE || "server",
  maxRequestBodyBytes: Number(process.env.MAX_REQUEST_BODY_BYTES || 1024 * 1024),
  storageRoot: path.resolve(process.env.STORAGE_ROOT || path.join(projectRoot, "tmp", "local-storage")),
  fallbackStorageRoot: path.resolve(process.env.FALLBACK_STORAGE_ROOT || path.join(projectRoot, "tmp", "local-storage")),
  exportRoot: path.resolve(process.env.EXPORT_ROOT || path.join(projectRoot, "exports")),
  exportRootDisplay: path.resolve(process.env.EXPORT_ROOT_DISPLAY || process.env.EXPORT_ROOT || path.join(projectRoot, "exports")),
  databaseUrl: process.env.DATABASE_URL || "postgres://det:det_password@localhost:5432/det_dashboard",
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
