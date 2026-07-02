const path = require("path");
const fs = require("fs");
const { PassThrough } = require("stream");
const Minio = require("minio");
const { minio, storageRoot, fallbackStorageRoot } = require("./config");

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

function secondaryFallbackPath(objectKey) {
  return path.join(fallbackStorageRoot, "object-store-fallback", ...String(objectKey || "").split(/[\\/]+/).filter(Boolean));
}

function legacyFallbackPath(objectKey) {
  return path.join(__dirname, "..", "object-store-fallback", ...String(objectKey || "").split(/[\\/]+/).filter(Boolean));
}

function minioDiskObjectPath(objectKey) {
  return path.join(minio.dataDir, minio.bucket, ...String(objectKey || "").split(/[\\/]+/).filter(Boolean));
}

function latestPartDir(objectDir) {
  if (!fs.existsSync(objectDir) || !fs.statSync(objectDir).isDirectory()) return "";
  const candidates = fs.readdirSync(objectDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(objectDir, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, "part.1")))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0] || "";
}

function minioPartFiles(objectKey) {
  const objectPath = minioDiskObjectPath(objectKey);
  if (fs.existsSync(objectPath) && fs.statSync(objectPath).isFile()) return [objectPath];
  const partDir = latestPartDir(objectPath);
  if (!partDir) return [];
  return fs.readdirSync(partDir)
    .filter((name) => /^part\.\d+$/.test(name))
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)))
    .map((name) => path.join(partDir, name));
}

function localObjectFiles(objectKey) {
  const candidates = [fallbackPath(objectKey), secondaryFallbackPath(objectKey), legacyFallbackPath(objectKey)];
  for (const filePath of candidates) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return [filePath];
  }
  return minioPartFiles(objectKey);
}

function createFileStream(files) {
  if (files.length === 1) return fs.createReadStream(files[0]);
  const out = new PassThrough();
  let index = 0;
  const pipeNext = () => {
    if (index >= files.length) return out.end();
    const stream = fs.createReadStream(files[index]);
    index += 1;
    stream.on("error", (error) => out.destroy(error));
    stream.on("end", pipeNext);
    stream.pipe(out, { end: false });
  };
  pipeNext();
  return out;
}

function localFallbackPath(objectKey) {
  return localObjectFiles(objectKey)[0] || fallbackPath(objectKey);
}

function writeFallbackFile(objectKey, filePath) {
  const target = writableFallbackPath(objectKey);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const sourceSize = fs.statSync(filePath).size;
  if (fs.existsSync(target)) {
    if (fs.statSync(target).size === sourceSize) return;
    fs.rmSync(target, { force: true });
  }
  try {
    fs.linkSync(filePath, target);
  } catch (error) {
    if (error.code !== "EXDEV" && error.code !== "EPERM" && error.code !== "EACCES") throw error;
    try {
      fs.symlinkSync(filePath, target);
    } catch {
      fs.copyFileSync(filePath, target);
    }
  }
}

function writeFallbackBuffer(objectKey, data) {
  const target = writableFallbackPath(objectKey);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
}

function writableFallbackPath(objectKey) {
  for (const target of [fallbackPath(objectKey), secondaryFallbackPath(objectKey)]) {
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      return target;
    } catch (error) {
      if (!["EACCES", "EPERM", "EROFS"].includes(error.code)) throw error;
      console.error(`Fallback storage is not writable: ${path.dirname(target)} (${error.code})`);
    }
  }
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
    writeFallbackFile(objectKey, filePath);
    return objectKey;
  }
  writeFallbackFile(objectKey, filePath);
  return objectKey;
}

async function getStream(objectKey) {
  const files = localObjectFiles(objectKey);
  if (files.length) return createFileStream(files);
  if (await ensureBucketSafe()) return client.getObject(minio.bucket, objectKey);
  return fs.createReadStream(fallbackPath(objectKey));
}

async function putJson(objectKey, value) {
  const data = Buffer.from(JSON.stringify(value, null, 2), "utf8");
  if (await ensureBucketSafe()) {
    await client.putObject(minio.bucket, objectKey, data, data.length, { "content-type": "application/json" });
    writeFallbackBuffer(objectKey, data);
    return objectKey;
  }
  writeFallbackBuffer(objectKey, data);
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
    if (localObjectFiles(objectKey).length) return true;
    if (!(await ensureBucketSafe())) return false;
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
  fs.rmSync(secondaryFallbackPath(objectKey), { force: true });
}

async function objectSize(objectKey) {
  const files = localObjectFiles(objectKey);
  if (files.length) return files.reduce((total, filePath) => total + fs.statSync(filePath).size, 0);
  if (await ensureBucketSafe()) {
    const stat = await client.statObject(minio.bucket, objectKey);
    return Number(stat.size) || 0;
  }
  return 0;
}

function extOf(filePath) {
  return path.extname(filePath).toLowerCase() || ".bin";
}

module.exports = { client, ensureBucket, ensureBucketSafe, putFile, putJson, putText, getStream, objectExists, objectSize, removeObject, extOf, localFallbackPath, bucket: minio.bucket };
