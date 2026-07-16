function createAlgorithmRuntimeSource({
  query,
  store,
  storageRoot,
  fs,
  path,
  spawnSync,
  walk,
  cleanName,
  writeObjectToFile,
  runChildProcess,
  processRef = process,
  logger = console,
}) {
  async function resolveTrainingAlgorithmSource(params = {}) {
    const algorithmId = params.algorithmAssetId || null;
    let algorithm = null;
    if (algorithmId) algorithm = (await query("SELECT * FROM algorithm_assets WHERE id=$1 AND deleted_at IS NULL", [algorithmId])).rows[0];
    if (!algorithm && params.algorithmKey) algorithm = (await query(
      "SELECT * FROM algorithm_assets WHERE algorithm_key=$1 AND deleted_at IS NULL ORDER BY source_type='builtin' DESC, updated_at DESC LIMIT 1",
      [params.algorithmKey],
    )).rows[0];
    if (!algorithm) return null;
    const cacheRoot = path.join(storageRoot, "runtime", "algorithm-cache", algorithm.id, assetPathSegmentForCache(algorithm.version || "current"));
    const sourcePrefixes = [...new Set([
      algorithm.source_prefix,
      `${algorithm.minio_prefix || ""}/source/`,
      `code-assets/algorithms/${algorithm.algorithm_key}/source/`,
    ].map((value) => String(value || "").replace(/\\/g, "/").replace(/\/*$/, "/")).filter(Boolean))];
    for (const sourcePrefix of sourcePrefixes) {
      const keys = await store.listObjectKeys(sourcePrefix);
      for (const objectKey of keys) {
        const relative = objectKey.slice(sourcePrefix.length).replace(/^\/+/, "");
        if (!relative || relative.includes("..")) continue;
        const target = path.join(cacheRoot, relative.split("/").join(path.sep));
        if (!fs.existsSync(target) || Number(fs.statSync(target).size) !== Number(await store.objectSize(objectKey).catch(() => -1))) await writeObjectToFile(objectKey, target);
      }
    }
    return { algorithm, cacheRoot };
  }

  function assetPathSegmentForCache(value) {
    return cleanName(String(value || "asset"), "asset").replace(/[. ]+$/g, "") || "asset";
  }

  function findFileUnder(root, predicate) {
    if (!root || !fs.existsSync(root)) return "";
    return walk(root).find((file) => fs.statSync(file).isFile() && predicate(file)) || "";
  }

  function ensureAlgorithmSourceArchiveExtracted(cacheRoot) {
    const archive = findFileUnder(cacheRoot, (file) => /[\\/]ZBH2FWQ[\\/]archives[\\/]dinov3-faster-rcnn-code\.tar\.zst$/i.test(file));
    if (!archive) return cacheRoot;
    const extractRoot = path.join(path.dirname(archive), "dinov3-faster-rcnn-code");
    const marker = path.join(extractRoot, ".det-dashboard-extracted");
    if (!fs.existsSync(marker)) {
      fs.mkdirSync(extractRoot, { recursive: true });
      const listing = spawnSync("tar", ["-tf", archive], { encoding: "utf8", timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
      if (listing.status !== 0) throw new Error(`Cannot inspect DINO source archive ${archive}: ${listing.stderr || listing.error?.message || "tar failed"}`);
      const unsafe = String(listing.stdout || "").split(/\r?\n/).filter(Boolean).find((entry) => path.isAbsolute(entry) || entry.split(/[\\/]/).includes(".."));
      if (unsafe) throw new Error(`DINO source archive contains an unsafe path: ${unsafe}`);
      const extracted = spawnSync("tar", [
        "-xf", archive, "-C", extractRoot,
        "dinov3-faster-rcnn/configs",
        "dinov3-faster-rcnn/dino_detector",
        "dinov3-faster-rcnn/tools",
      ], { encoding: "utf8", timeout: 600000, maxBuffer: 32 * 1024 * 1024 });
      if (extracted.status !== 0) throw new Error(`Cannot extract DINO source archive ${archive}: ${extracted.stderr || extracted.error?.message || "tar failed"}`);
      fs.writeFileSync(marker, new Date().toISOString(), "utf8");
    }
    const packagedRoot = path.join(extractRoot, "dinov3-faster-rcnn");
    return fs.existsSync(packagedRoot) ? packagedRoot : extractRoot;
  }

  async function resolveDinoConfigPath({ env, cacheRoot, algorithm, params, weightPath, outputRoot }) {
    const sourceRoot = ensureAlgorithmSourceArchiveExtracted(cacheRoot);
    const generatedPath = path.join(outputRoot, "checkpoint_config.py");
    const extractorPath = path.join(outputRoot, "extract_checkpoint_config.py");
    const extractor = [
      "import os, sys, torch",
      "from mmengine.config import Config",
      "checkpoint, output = sys.argv[1:3]",
      "payload = torch.load(checkpoint, map_location='cpu')",
      "meta = payload.get('meta') or {} if isinstance(payload, dict) else {}",
      "cfg = meta.get('cfg') or meta.get('config')",
      "if cfg is None: raise RuntimeError('checkpoint meta.cfg is missing')",
      "if isinstance(cfg, Config): cfg.dump(output)",
      "elif isinstance(cfg, dict): Config(cfg).dump(output)",
      "elif isinstance(cfg, str) and os.path.isfile(cfg): open(output, 'w', encoding='utf-8').write(open(cfg, 'r', encoding='utf-8').read())",
      "elif isinstance(cfg, str): open(output, 'w', encoding='utf-8').write(cfg)",
      "else: raise TypeError('unsupported checkpoint meta.cfg type: %s' % type(cfg).__name__)",
    ].join("\n");
    fs.writeFileSync(extractorPath, extractor, "utf8");
    try {
      await runChildProcess(env.python_path, [extractorPath, weightPath, generatedPath], { cwd: sourceRoot, env: { ...processRef.env, PYTHONIOENCODING: "utf-8", PYTHONPATH: [sourceRoot, processRef.env.PYTHONPATH].filter(Boolean).join(path.delimiter) } });
      if (fs.existsSync(generatedPath)) {
        const checkpointConfig = fs.readFileSync(generatedPath, "utf8")
          .replace(/pretrained\s*=\s*checkpoint_file/g, "pretrained=None")
          .replace(/pretrained\s*=\s*['\"][^'\"]+['\"]/g, "pretrained=None");
        fs.writeFileSync(generatedPath, checkpointConfig, "utf8");
        return { configPath: generatedPath, sourceRoot };
      }
    } catch (error) {
      logger.warn(`Checkpoint config extraction failed for ${weightPath}: ${error.message}`);
    }

    const requested = String(params.config_path || params.configPath || algorithm.default_params_json?.config_path || "configs/alashan_full_multiclass_200e.py").trim();
    const candidates = [
      requested && path.isAbsolute(requested) ? requested : "",
      requested ? path.join(sourceRoot, requested) : "",
      requested ? findFileUnder(sourceRoot, (file) => file.replace(/\\/g, "/").endsWith(`/${requested.replace(/\\/g, "/")}`)) : "",
      findFileUnder(sourceRoot, (file) => path.basename(file).toLowerCase() === "alashan_full_multiclass_200e.py"),
    ].filter(Boolean);
    const existing = candidates.find((file) => fs.existsSync(file));
    if (existing) return { configPath: existing, sourceRoot };
    throw new Error(`DINO config is unavailable in source and checkpoint meta.cfg: ${weightPath}`);
  }

  return {
    resolveTrainingAlgorithmSource,
    assetPathSegmentForCache,
    findFileUnder,
    ensureAlgorithmSourceArchiveExtracted,
    resolveDinoConfigPath,
  };
}

module.exports = { createAlgorithmRuntimeSource };
