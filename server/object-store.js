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

// Bucket readiness is process-wide. Checking it for every object makes large
// imports turn one local file into one network round trip and races bucket
// creation when several imports start together.
let bucketState = "unknown";
let bucketReadyPromise = null;

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
    if (error.code === "EEXIST") {
      try {
        if (fs.statSync(target).size === sourceSize) return;
      } catch {}
      fs.rmSync(target, { force: true });
      try {
        fs.linkSync(filePath, target);
        return;
      } catch (retryError) {
        error = retryError;
      }
    }
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
  if (bucketState === "ready") return true;
  if (bucketState === "fallback") return false;
  if (!bucketReadyPromise) {
    bucketReadyPromise = ensureBucket()
      .then(() => {
        bucketState = "ready";
        return true;
      })
      .catch((error) => {
        bucketState = "fallback";
        console.error("MinIO unavailable, using local fallback for new objects:", error.message);
        fs.mkdirSync(path.join(storageRoot, "object-store-fallback"), { recursive: true });
        return false;
      });
  }
  return bucketReadyPromise;
}

async function putFile(objectKey, filePath, meta = {}) {
  if (await ensureBucketSafe()) {
    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await client.fPutObject(minio.bucket, objectKey, filePath, meta);
        writeFallbackFile(objectKey, filePath);
        return objectKey;
      } catch (error) {
        lastError = error;
        bucketState = "unknown";
        bucketReadyPromise = null;
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
      }
    }
    console.error(`MinIO upload failed after retries; using local fallback for ${objectKey}:`, lastError?.message || "unknown error");
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
  }
  for (const filePath of [fallbackPath(objectKey), secondaryFallbackPath(objectKey), legacyFallbackPath(objectKey)]) {
    fs.rmSync(filePath, { force: true });
  }
}

async function removeObjects(objectKeys = []) {
  const keys = Array.from(new Set(objectKeys.map(String).filter(Boolean)));
  if (!keys.length) return;
  if (await ensureBucketSafe()) {
    for (let index = 0; index < keys.length; index += 1000) {
      const batch = keys.slice(index, index + 1000);
      await client.removeObjects(minio.bucket, batch).catch(async () => {
        await Promise.all(batch.map((key) => client.removeObject(minio.bucket, key).catch(() => {})));
      });
    }
  }
  for (const key of keys) {
    for (const filePath of [fallbackPath(key), secondaryFallbackPath(key), legacyFallbackPath(key)]) {
      fs.rmSync(filePath, { force: true });
    }
  }
}

async function objectSize(objectKey) {
  const files = localObjectFiles(objectKey);
  if (files.length) return files.reduce((total, filePath) => total + fs.statSync(filePath).size, 0);
  if (await ensureBucketSafe()) {
    try {
      const stat = await client.statObject(minio.bucket, objectKey);
      return Number(stat.size) || 0;
    } catch (error) {
      if (["NotFound", "NoSuchKey", "NoSuchObject"].includes(error?.code) || error?.statusCode === 404) return 0;
      throw error;
    }
  }
  return 0;
}

function walkLocalObjectKeys(rootDir, prefix = "") {
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) return [];
  const keys = [];
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        const key = path.relative(rootDir, fullPath).split(path.sep).join("/");
        if (!prefix || key.startsWith(prefix)) keys.push(key);
      }
    }
  }
  return keys;
}

async function listObjectKeys(prefix = "") {
  const keys = new Set();
  for (const rootDir of [
    path.join(storageRoot, "object-store-fallback"),
    path.join(fallbackStorageRoot, "object-store-fallback"),
    path.join(__dirname, "..", "object-store-fallback"),
  ]) {
    for (const key of walkLocalObjectKeys(rootDir, prefix)) keys.add(key);
  }
  try {
    if (await ensureBucketSafe()) {
      await new Promise((resolve, reject) => {
        const stream = client.listObjectsV2(minio.bucket, prefix, true);
        stream.on("data", (item) => {
          if (item?.name) keys.add(item.name);
        });
        stream.on("error", reject);
        stream.on("end", resolve);
      });
    }
  } catch (error) {
    console.error("MinIO listObjects failed, using local object index only:", error.message);
  }
  return Array.from(keys).sort();
}
function extOf(filePath) {
  return path.extname(filePath).toLowerCase() || ".bin";
}

module.exports = { client, ensureBucket, ensureBucketSafe, putFile, putJson, putText, getStream, objectExists, objectSize, listObjectKeys, removeObject, removeObjects, extOf, localFallbackPath, bucket: minio.bucket };

