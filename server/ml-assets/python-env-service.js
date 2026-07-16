function createPythonEnvService({
  query,
  scopeSql,
  assignOwner,
  fs,
  path,
  process: runtimeProcess,
  spawnSync,
  crypto,
  store,
  cleanName,
  hashFile,
  pythonEnvObjectKey,
  pythonEnvManifestKey,
  serverPythonEnvObjectKey,
  dataRoot,
  storageRoot,
  minio,
  isInsideRoot,
  writeObjectToFile,
  sendError,
}) {
  if (typeof query !== "function") throw new TypeError("createPythonEnvService requires query");
  if (typeof scopeSql !== "function") throw new TypeError("createPythonEnvService requires scopeSql");
  if (typeof assignOwner !== "function") throw new TypeError("createPythonEnvService requires assignOwner");
  if (!fs || typeof fs.existsSync !== "function") throw new TypeError("createPythonEnvService requires fs");
  if (!path || typeof path.join !== "function") throw new TypeError("createPythonEnvService requires path");
  if (!runtimeProcess || !runtimeProcess.platform) throw new TypeError("createPythonEnvService requires process");
  if (typeof spawnSync !== "function") throw new TypeError("createPythonEnvService requires spawnSync");
  if (!crypto || typeof crypto.createHash !== "function") throw new TypeError("createPythonEnvService requires crypto");
  if (!store || typeof store.putFile !== "function" || typeof store.getStream !== "function") throw new TypeError("createPythonEnvService requires store");
  if (typeof cleanName !== "function") throw new TypeError("createPythonEnvService requires cleanName");
  if (typeof hashFile !== "function") throw new TypeError("createPythonEnvService requires hashFile");
  if (typeof pythonEnvObjectKey !== "function" || typeof pythonEnvManifestKey !== "function" || typeof serverPythonEnvObjectKey !== "function") {
    throw new TypeError("createPythonEnvService requires Python environment key builders");
  }
  if (typeof isInsideRoot !== "function") throw new TypeError("createPythonEnvService requires isInsideRoot");
  if (typeof writeObjectToFile !== "function") throw new TypeError("createPythonEnvService requires writeObjectToFile");
  if (typeof sendError !== "function") throw new TypeError("createPythonEnvService requires sendError");

  function uniqueExistingPaths(paths) {
    return Array.from(new Set(paths.filter(Boolean).map((item) => path.resolve(item)))).filter((item) => fs.existsSync(item));
  }

  function detectPythonVersion(pythonPath) {
    const result = spawnSync(pythonPath, ["--version"], { encoding: "utf8", timeout: 5000 });
    return String(result.stdout || result.stderr || "").trim();
  }

  function detectUltralytics(pythonPath) {
    const result = spawnSync(pythonPath, ["-c", "import importlib.util; print('yes' if importlib.util.find_spec('ultralytics') else 'no')"], { encoding: "utf8", timeout: 8000 });
    return String(result.stdout || "").trim() === "yes";
  }

  function inferPlatform(pythonPath) {
    const normalized = String(pythonPath || "").toLowerCase();
    const osType = normalized.includes("\\") || /^[a-z]:/.test(normalized) ? "windows" : "linux";
    const arch = runtimeProcess.arch === "arm64" ? "arm64" : "x86_64";
    return { osType, arch };
  }

  function inferEnvType(pythonPath) {
    const text = String(pythonPath || "").toLowerCase();
    if (text.includes("miniforge")) return "miniforge";
    return "conda";
  }

  function inspectPythonEnv(pythonPath) {
    const version = detectPythonVersion(pythonPath);
    const script = [
      "import json, importlib.util",
      "info={'ultralytics': bool(importlib.util.find_spec('ultralytics')), 'mmdet': bool(importlib.util.find_spec('mmdet')), 'mmcv': bool(importlib.util.find_spec('mmcv')), 'detectron2': bool(importlib.util.find_spec('detectron2')), 'cv2': bool(importlib.util.find_spec('cv2')), 'numpy': bool(importlib.util.find_spec('numpy')), 'torch': False, 'torch_version': '', 'cuda_available': False, 'cuda_version': '', 'device_count': 0}",
      "spec=importlib.util.find_spec('torch')",
      "if spec:",
      "    import torch",
      "    info['torch']=True",
      "    info['torch_version']=getattr(torch, '__version__', '')",
      "    info['cuda_available']=bool(torch.cuda.is_available())",
      "    info['cuda_version']=getattr(torch.version, 'cuda', '') or ''",
      "    info['device_count']=torch.cuda.device_count() if torch.cuda.is_available() else 0",
      "print(json.dumps(info, ensure_ascii=False))",
    ].join("\n");
    const result = spawnSync(pythonPath, ["-c", script], { encoding: "utf8", timeout: 30000 });
    let packages = {};
    try {
      packages = JSON.parse(String(result.stdout || "{}").trim() || "{}");
    } catch {
      packages = { ultralytics: detectUltralytics(pythonPath) };
    }
    const platform = inferPlatform(pythonPath);
    const accelerator = packages.cuda_available ? "cuda" : "cpu";
    const status = packages.torch && (packages.ultralytics || packages.mmdet || packages.detectron2) ? "ready" : "missing_detection_runtime";
    return { version, packages, platform, accelerator, status };
  }

  function condaPythonCandidates(unpackPath, pythonPath) {
    return uniqueExistingPaths([
      pythonPath,
      path.join(unpackPath || "", "bin", "python"),
      path.join(unpackPath || "", "python.exe"),
      path.join(unpackPath || "", "Scripts", "python.exe"),
    ]);
  }

  function ensureCondaPackUnpacked(sourcePath, unpackPath, pythonPath) {
    const existing = condaPythonCandidates(unpackPath, pythonPath)[0];
    if (existing) return existing;
    fs.mkdirSync(unpackPath, { recursive: true });
    const result = spawnSync("tar", ["-xf", sourcePath, "-C", unpackPath], { encoding: "utf8", timeout: 600000, maxBuffer: 4 * 1024 * 1024 });
    if (result.status !== 0) {
      throw new Error(`conda-pack 环境包解包失败：${String(result.stderr || result.stdout || "tar 执行失败").trim()}`);
    }
    const extracted = condaPythonCandidates(unpackPath, pythonPath)[0];
    if (!extracted) throw new Error(`conda-pack 环境包已解包，但未找到 Python：${unpackPath}`);
    return extracted;
  }

  function inspectCondaPackArchive(sourcePath, unpackPath, pythonPath) {
    const candidates = condaPythonCandidates(unpackPath, pythonPath);
    if (candidates[0]) {
      const info = inspectPythonEnv(candidates[0]);
      return { ...info, pythonPath: candidates[0], detectedFrom: "python" };
    }
    const lowerName = path.basename(sourcePath || "").toLowerCase();
    let listing = "";
    try {
      const result = spawnSync("tar", ["-tf", sourcePath], { encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024 });
      listing = String(result.stdout || "").toLowerCase();
    } catch {
      listing = "";
    }
    const text = `${lowerName}\n${listing}`;
    const osType = text.includes("scripts/python.exe") || text.includes("python.exe") || text.includes("win") ? "windows" : "linux";
    const arch = text.includes("aarch64") || text.includes("arm64") ? "arm64" : "x86_64";
    const accelerator = /\b(cuda|cu11|cu12|gpu|nvidia)\b/.test(text) ? "cuda" : "cpu";
    return {
      version: "",
      packages: { archive_inspected: Boolean(listing), cuda_available: accelerator === "cuda" },
      platform: { osType, arch },
      accelerator,
      status: "uploaded",
      pythonPath,
      detectedFrom: listing ? "archive" : "filename",
    };
  }

  function validateWindowsCondaPackRoot(sourcePath) {
    const result = spawnSync("tar", ["-tf", sourcePath], { encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`无法读取 Python 环境归档：${String(result.stderr || result.stdout || "tar 执行失败").trim()}`);
    const entries = String(result.stdout || "").split(/\r?\n/)
      .map((entry) => entry.trim().replace(/^\.\//, "").replace(/\\/g, "/"))
      .filter(Boolean);
    const hasRootFile = (name) => entries.some((entry) => entry.toLowerCase() === name.toLowerCase());
    const hasRootDir = (name) => entries.some((entry) => entry.toLowerCase() === name.toLowerCase() || entry.toLowerCase().startsWith(`${name.toLowerCase()}/`));
    const missing = [];
    if (!hasRootFile("python.exe")) missing.push("python.exe");
    for (const directory of ["Lib", "Scripts", "conda-meta"]) if (!hasRootDir(directory)) missing.push(directory);
    if (missing.length) {
      const wrapper = entries.find((entry) => entry.includes("/"))?.split("/")[0] || "";
      throw new Error(`环境包根目录结构不正确，缺少：${missing.join("、")}。归档必须直接包含 python.exe、Lib、Scripts、conda-meta，不能包含额外顶层目录${wrapper ? `（检测到 ${wrapper}/）` : ""}`);
    }
    return entries;
  }

  function defaultPythonEnvName(info = {}, accelerator = "cpu", fallback = "python-env") {
    const versionText = String(info.version || "").match(/(\d+\.\d+)/)?.[1] || String(info.python_version || "").match(/(\d+\.\d+)/)?.[1] || "";
    const torchText = String(info.packages?.torch_version || info.torch_version || "").match(/(\d+\.\d+(?:\.\d+)?)/)?.[1] || "";
    const accel = String(accelerator || (info.cuda_available ? "cuda" : "cpu") || "cpu").toLowerCase();
    return [versionText ? `py${versionText}` : fallback, torchText ? `torch${torchText}` : "torch-unknown", accel].join("-");
  }

  async function listPythonEnvs(actor, scope = "mine") {
    const scoped = scopeSql({ table: "runtime_envs", alias: "e", actor, scope, params: [] });
    return (await query(`SELECT e.* FROM runtime_envs e WHERE ${scoped.sql} ORDER BY os_type, arch, accelerator DESC, status='ready' DESC, created_at DESC`, scoped.params)).rows;
  }

  async function streamPythonEnvArtifact(res, envId) {
    const env = (await query("SELECT * FROM runtime_envs WHERE id=$1", [envId])).rows[0];
    if (!env) return sendError(res, 404, "Python environment not found");
    if (env.source_type !== "conda_pack" || !env.artifact_key) return sendError(res, 409, "This environment has no downloadable conda-pack archive");
    const fileName = `${cleanName(env.name, "python-env")}.tar.gz`;
    const headers = {
      "content-type": "application/gzip",
      "content-disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
      "cache-control": "no-store",
    };
    if (env.artifact_size) headers["content-length"] = String(env.artifact_size);
    const localFallback = store.localFallbackPath(env.artifact_key);
    res.writeHead(200, headers);
    if (fs.existsSync(localFallback)) return fs.createReadStream(localFallback).pipe(res);
    const stream = await store.getStream(env.artifact_key);
    stream.pipe(res);
  }

  async function createPythonEnv(body = {}, actor) {
    const rawSourceType = body.sourceType || body.source_type || "server_managed";
    const sourceType = rawSourceType === "server_python" ? "server_managed" : rawSourceType;
    if (sourceType === "conda_pack") {
      const sourcePath = path.resolve(String(body.condaPackPath || body.conda_pack_path || body.sourcePath || body.source_path || "").trim());
      if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error("conda-pack 环境包路径不存在");
      const minioBucketRoot = path.join(minio.dataDir, minio.bucket);
      const allowedRoots = [dataRoot, storageRoot, minio.dataDir, minioBucketRoot];
      if (!allowedRoots.some((root) => isInsideRoot(root, sourcePath))) throw new Error(`conda-pack 环境包必须位于服务器资产目录内：${allowedRoots.join("、")}`);
      const stat = fs.statSync(sourcePath);
      const sha = await hashFile(sourcePath);
      validateWindowsCondaPackRoot(sourcePath);
      const artifactKey = pythonEnvObjectKey(sha, path.basename(sourcePath));
      const manifestKey = pythonEnvManifestKey(sha);
      await store.putFile(artifactKey, sourcePath, { "x-amz-meta-source": "conda-pack" });
      const unpackPath = String(body.unpackPath || body.unpack_path || path.join(storageRoot, "runtime", "python-envs", sha.slice(0, 12))).trim();
      const defaultPython = runtimeProcess.platform === "win32" ? path.join(unpackPath, "python.exe") : path.join(unpackPath, "bin", "python");
      const requestedPythonPath = String(body.pythonPath || body.python_path || defaultPython).trim();
      const extractedPythonPath = ensureCondaPackUnpacked(sourcePath, unpackPath, requestedPythonPath);
      const info = inspectCondaPackArchive(sourcePath, unpackPath, extractedPythonPath);
      const pythonPath = info.pythonPath || extractedPythonPath;
      const platform = info.platform;
      const accelerator = info.accelerator;
      const capabilities = {
        source_type: "conda_pack",
        asset_policy: "platform_minio_asset",
        artifact_key: artifactKey,
        manifest_key: manifestKey,
        tasks: body.tasks || ["detect", "segment", "classify"],
        detected_from: info.detectedFrom,
        auto_detected: true,
        ultralytics_detect: Boolean(info.packages.ultralytics),
        mmdetection_detect: Boolean(info.packages.mmdet && info.packages.mmcv),
        detectron2_detect: Boolean(info.packages.detectron2),
        torch: Boolean(info.packages.torch),
      };
      const manifest = {
        format: "det-dashboard.python-env.v1",
        assetType: "python_env",
        sourceType: "conda_pack",
        artifactKey,
        manifestKey,
        artifactName: path.basename(sourcePath),
        artifactSize: stat.size,
        artifactSha256: sha,
        unpackPath,
        pythonPath,
        osType: platform.osType,
        arch: platform.arch,
        accelerator,
        pythonVersion: info.version,
        torchVersion: info.packages.torch_version || "",
        cudaAvailable: Boolean(info.packages.cuda_available),
        cudaVersion: info.packages.cuda_version || "",
        packages: info.packages,
        tasks: body.tasks || ["detect", "segment", "classify"],
        importSourcePath: sourcePath,
        createdAt: new Date().toISOString(),
      };
      await store.putJson(manifestKey, manifest);
      const envName = body.name || defaultPythonEnvName(info, accelerator, path.basename(sourcePath).replace(/\.(tar\.gz|tgz)$/i, ""));
      const rows = await query(
        `INSERT INTO runtime_envs
         (name, python_path, env_type, os_type, arch, accelerator, status, python_version, torch_version, cuda_available, cuda_version,
          packages_json, capabilities_json, source_type, artifact_key, artifact_name, artifact_size, artifact_sha256, unpack_path)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
        [
          envName, pythonPath, "conda-pack", platform.osType, platform.arch, accelerator, info.status, info.version,
          info.packages.torch_version || "", Boolean(info.packages.cuda_available), info.packages.cuda_version || "",
          JSON.stringify({ assetPolicy: "platform_minio_asset", artifactKey, manifestKey, importSourcePath: sourcePath, packages: info.packages }),
          JSON.stringify(capabilities), "conda_pack", artifactKey, path.basename(sourcePath), stat.size, sha, unpackPath,
        ],
      );
      return assignOwner("runtime_envs", rows.rows[0].id, actor, { visibility: body.visibility || "private" });
    }

    const pythonPath = path.resolve(String(body.pythonPath || body.python_path || "").trim());
    if (!pythonPath || !fs.existsSync(pythonPath)) throw new Error("Python 解释器路径不存在");
    const info = inspectPythonEnv(pythonPath);
    const envType = inferEnvType(pythonPath);
    const osType = info.platform.osType;
    const arch = info.platform.arch;
    const accelerator = info.accelerator;
    const metadata = {
      sourceType: "server_managed",
      legacySourceType: "server_python",
      recommendedSourceType: body.preferCondaPack ? "conda_pack" : "server_managed",
      assetPolicy: body.preferCondaPack ? "建议使用 conda-pack 环境包统一存入 MinIO；服务器 Python 路径用于快速检测和临时登记。" : "服务器 Python 路径登记",
      pythonPath, envType, osType, arch, accelerator,
      inspectedAt: new Date().toISOString(),
      version: info.version,
      packages: info.packages,
      capabilities: {
        ultralytics_detect: Boolean(info.packages.ultralytics),
        mmdetection_detect: Boolean(info.packages.mmdet && info.packages.mmcv),
        detectron2_detect: Boolean(info.packages.detectron2),
        torch: Boolean(info.packages.torch),
      },
    };
    const sha = crypto.createHash("sha256").update(JSON.stringify(metadata)).digest("hex");
    const artifactKey = serverPythonEnvObjectKey(sha);
    await store.putJson(artifactKey, metadata);
    const artifactSize = Buffer.byteLength(JSON.stringify(metadata), "utf8");
    const rows = await query(
      `INSERT INTO runtime_envs
       (name, python_path, env_type, os_type, arch, accelerator, status, python_version, torch_version, cuda_available, cuda_version,
        packages_json, capabilities_json, source_type, artifact_key, artifact_name, artifact_size, artifact_sha256, unpack_path)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
      [
        body.name || defaultPythonEnvName(info, accelerator, path.basename(pythonPath)), pythonPath, envType, osType, arch, accelerator,
        info.status, info.version, info.packages.torch_version || "", Boolean(info.packages.cuda_available), info.packages.cuda_version || "",
        JSON.stringify(info.packages),
        JSON.stringify({
          ultralytics_detect: Boolean(info.packages.ultralytics),
          mmdetection_detect: Boolean(info.packages.mmdet && info.packages.mmcv),
          detectron2_detect: Boolean(info.packages.detectron2),
          torch: Boolean(info.packages.torch),
        }),
        "server_managed", artifactKey, "metadata.json", artifactSize, sha, "",
      ],
    );
    return assignOwner("runtime_envs", rows.rows[0].id, actor, { visibility: body.visibility || "private" });
  }

  async function resolveRuntimePythonEnv(env = {}) {
    if (!env?.id) throw new Error("Python 环境不存在");
    if (env.python_path && fs.existsSync(env.python_path) && fs.statSync(env.python_path).isFile()) return env;
    if (env.source_type !== "conda_pack" || !env.artifact_key || !env.unpack_path) return env;
    const archiveName = env.artifact_name || path.basename(env.artifact_key) || `${env.id}.tar.gz`;
    const archivePath = path.join(storageRoot, "runtime", "python-env-cache", env.id, archiveName);
    if (!fs.existsSync(archivePath)) await writeObjectToFile(env.artifact_key, archivePath);
    const defaultPython = runtimeProcess.platform === "win32" ? path.join(env.unpack_path, "python.exe") : path.join(env.unpack_path, "bin", "python");
    const pythonPath = ensureCondaPackUnpacked(archivePath, env.unpack_path, env.python_path || defaultPython);
    if (pythonPath !== env.python_path) {
      await query("UPDATE runtime_envs SET python_path=$1 WHERE id=$2", [pythonPath, env.id]);
      env.python_path = pythonPath;
    }
    return env;
  }

  return {
    inferEnvType,
    inspectPythonEnv,
    listPythonEnvs,
    streamPythonEnvArtifact,
    createPythonEnv,
    resolveRuntimePythonEnv,
  };
}

module.exports = { createPythonEnvService };
