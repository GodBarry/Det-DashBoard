function createRuntimeWorkerSupport({ query, spawn, processRef }) {
  function stopProcess(pid) {
    const numericPid = Number(pid);
    if (!numericPid || numericPid === processRef.pid) return false;
    try {
      processRef.kill(numericPid);
      return true;
    } catch (error) {
      if (processRef.platform === "win32") {
        try {
          spawn("taskkill", ["/PID", String(numericPid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
          return true;
        } catch (_) {
          return false;
        }
      }
      return false;
    }
  }

  function runChildProcess(command, args, options = {}) {
    return new Promise((resolve, reject) => {
      const { onStdout, onStderr, onOutput, ...spawnOptions } = options;
      const child = spawn(command, args, { windowsHide: true, ...spawnOptions });
      let stdout = "";
      let stderr = "";
      let combined = "";
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk) => {
        stdout += chunk; combined += chunk;
        try { onStdout?.(chunk); onOutput?.("stdout", chunk); } catch (_) {}
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk; combined += chunk;
        try { onStderr?.(chunk); onOutput?.("stderr", chunk); } catch (_) {}
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) return resolve({ stdout, stderr, combined, code });
        const error = new Error((stderr || stdout || `${command} exited with code ${code}`).trim());
        error.code = code;
        error.stdout = stdout;
        error.stderr = stderr;
        error.combined = combined;
        reject(error);
      });
    });
  }

  async function appendTrainingLog(jobId, stream, line) {
    const text = String(line || "").slice(0, 4000);
    if (!text) return;
    await query("INSERT INTO runtime_training_logs (job_id, stream, line) VALUES ($1,$2,$3)", [jobId, stream, text]).catch(() => {});
  }

  async function appendInferenceLog(jobId, stream, line) {
    const text = String(line || "").slice(0, 4000);
    if (!text) return;
    await query("INSERT INTO runtime_inference_logs (job_id, stream, line) VALUES ($1,$2,$3)", [jobId, stream, text]).catch(() => {});
  }

  return { stopProcess, runChildProcess, appendTrainingLog, appendInferenceLog };
}

module.exports = { createRuntimeWorkerSupport };
