"use strict";

function normalizeClasses(value) {
  const values = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.entries(value).sort(([left], [right]) => Number(left) - Number(right)).map(([, name]) => name)
      : [];
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
}

function createModelWeightInspector({
  query,
  fs,
  childProcess,
  pythonEnvService,
  processRef = process,
}) {
  async function pythonCandidates() {
    const explicit = String(processRef.env.MODEL_INSPECT_PYTHON || "").trim();
    const candidates = explicit ? [explicit] : [];
    const rows = await query(
      `SELECT * FROM runtime_envs
       WHERE status <> 'failed'
       ORDER BY CASE WHEN COALESCE(capabilities_json->>'torch','') <> '' THEN 0 ELSE 1 END,
                updated_at DESC NULLS LAST, created_at DESC`,
    ).catch(() => ({ rows: [] }));
    for (let env of rows.rows) {
      try {
        if ((!env.python_path || !fs.existsSync(env.python_path)) && pythonEnvService) {
          env = await pythonEnvService.resolveRuntimePythonEnv(env);
        }
        if (env.python_path && fs.existsSync(env.python_path)) candidates.push(env.python_path);
      } catch {}
    }
    return [...new Set(candidates)];
  }

  function inspectWithPython(pythonPath, sourcePath) {
    const script = [
      "import json, sys",
      "result = {'classes': [], 'source': None}",
      "try:",
      "    import torch",
      "    checkpoint = torch.load(sys.argv[1], map_location='cpu', weights_only=False)",
      "    def normalize(value):",
      "        if isinstance(value, dict):",
      "            def key(item):",
      "                try: return (0, int(item[0]))",
      "                except Exception: return (1, str(item[0]))",
      "            return [str(v).strip() for _, v in sorted(value.items(), key=key) if str(v).strip()]",
      "        if isinstance(value, (list, tuple)): return [str(v).strip() for v in value if str(v).strip()]",
      "        return []",
      "    candidates = []",
      "    if isinstance(checkpoint, dict):",
      "        for key in ('names', 'classes', 'class_names', 'CLASSES'): candidates.append((key, checkpoint.get(key)))",
      "        for meta_key in ('meta', 'metainfo', 'dataset_meta'):",
      "            meta = checkpoint.get(meta_key)",
      "            if isinstance(meta, dict):",
      "                for key in ('names', 'classes', 'class_names', 'CLASSES'): candidates.append((meta_key + '.' + key, meta.get(key)))",
      "        for object_key in ('model', 'ema'):",
      "            obj = checkpoint.get(object_key)",
      "            if obj is not None:",
      "                for key in ('names', 'classes', 'class_names', 'CLASSES'): candidates.append((object_key + '.' + key, getattr(obj, key, None)))",
      "    else:",
      "        for key in ('names', 'classes', 'class_names', 'CLASSES'): candidates.append((key, getattr(checkpoint, key, None)))",
      "    for source, value in candidates:",
      "        classes = normalize(value)",
      "        if classes:",
      "            result = {'classes': classes, 'source': source}",
      "            break",
      "except Exception as error:",
      "    result['error'] = str(error)",
      "print(json.dumps(result, ensure_ascii=False))",
    ].join("\n");
    return new Promise((resolve) => {
      const child = childProcess.spawn(pythonPath, ["-c", script, sourcePath], {
        windowsHide: true,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...processRef.env, PYTHONIOENCODING: "utf-8" },
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const timer = setTimeout(() => {
        child.kill();
        finish({ classes: [], warning: "模型标签解析超过 60 秒，已跳过" });
      }, 60000);
      child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
      child.on("error", (error) => {
        clearTimeout(timer);
        finish({ classes: [], warning: error.message });
      });
      child.on("close", () => {
        clearTimeout(timer);
        try {
          const data = JSON.parse(stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || "{}");
          finish({
            classes: normalizeClasses(data.classes),
            source: data.source || null,
            warning: data.error || (data.classes?.length ? null : stderr.trim().split(/\r?\n/).at(-1) || null),
          });
        } catch {
          finish({ classes: [], warning: stderr.trim() || "模型标签解析没有返回有效结果" });
        }
      });
    });
  }

  async function inspect(sourcePath) {
    if (!/\.(?:pt|pth)$/i.test(sourcePath)) return { classes: [], source: null, warning: null };
    const candidates = await pythonCandidates();
    if (!candidates.length) return { classes: [], source: null, warning: "没有可用于读取权重元数据的 Python/Torch 环境" };
    let last = { classes: [], source: null, warning: null };
    for (const pythonPath of candidates) {
      last = await inspectWithPython(pythonPath, sourcePath);
      if (last.classes.length) return { ...last, pythonPath };
    }
    return last;
  }

  return { inspect };
}

module.exports = { createModelWeightInspector, normalizeClasses };
