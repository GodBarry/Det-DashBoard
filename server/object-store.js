const path = require("path");
const fs = require("fs");
const Minio = require("minio");
const { minio, storageRoot } = require("./config");

const client = new Minio.Client({
  endPoint: minio.endPoint,
  port: minio.port,
  useSSL: minio.useSSL,
  accessKey: minio.accessKey,
  secretKey: minio.secretKey,
});

async function ensureBucket() {
  const exists = await client.bucketExists(minio.bucket).catch(() => false);
  if (!exists) await client.makeBucket(minio.bucket);
}

function fallbackPath(objectKey) {
  return path.join(storageRoot, "object-store-fallback", ...String(objectKey || "").split(/[\\/]+/).filter(Boolean));
}

function localFallbackPath(objectKey) {
  return fallbackPath(objectKey);
}

async function ensureBucketSafe() {
  try {
    await ensureBucket();
    return true;
  } catch (error) {
    console.error("MinIO unavailable, using local fallback for new objects:", error.message);
    fs.mkdirSync(path.join(storageRoot, "object-store-fallback"), { recursive: true });
    return false;
  }
}

async function putFile(objectKey, filePath, meta = {}) {
  if (await ensureBucketSafe()) {
    await client.fPutObject(minio.bucket, objectKey, filePath, meta);
    return objectKey;
  }
  const target = fallbackPath(objectKey);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(filePath, target);
  return objectKey;
}

async function getStream(objectKey) {
  if (await ensureBucketSafe()) return client.getObject(minio.bucket, objectKey);
  return fs.createReadStream(fallbackPath(objectKey));
}

async function putJson(objectKey, value) {
  const data = Buffer.from(JSON.stringify(value, null, 2), "utf8");
  if (await ensureBucketSafe()) {
    await client.putObject(minio.bucket, objectKey, data, data.length, { "content-type": "application/json" });
    return objectKey;
  }
  const target = fallbackPath(objectKey);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
  return objectKey;
}

async function putText(objectKey, value, contentType = "text/plain") {
  const data = Buffer.from(String(value || ""), "utf8");
  if (await ensureBucketSafe()) {
    await client.putObject(minio.bucket, objectKey, data, data.length, { "content-type": contentType });
    return objectKey;
  }
  const target = fallbackPath(objectKey);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
  return objectKey;
}

async function objectExists(objectKey) {
  try {
    if (!(await ensureBucketSafe())) return fs.existsSync(fallbackPath(objectKey));
    await client.statObject(minio.bucket, objectKey);
    return true;
  } catch {
    return false;
  }
}

async function removeObject(objectKey) {
  if (!objectKey) return;
  if (await ensureBucketSafe()) {
    await client.removeObject(minio.bucket, objectKey).catch(() => {});
    return;
  }
  fs.rmSync(fallbackPath(objectKey), { force: true });
}

function extOf(filePath) {
  return path.extname(filePath).toLowerCase() || ".bin";
}

module.exports = { client, ensureBucket, ensureBucketSafe, putFile, putJson, putText, getStream, objectExists, removeObject, extOf, localFallbackPath, bucket: minio.bucket };
