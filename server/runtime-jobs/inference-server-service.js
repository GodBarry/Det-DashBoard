"use strict";

function createInferenceServerService({ baseUrl = process.env.INFERENCE_SIDECAR_URL, fetchImpl = globalThis.fetch }) {
  const normalizedBaseUrl = String(baseUrl || "").replace(/\/$/, "");

  async function request(pathname, body) {
    if (!normalizedBaseUrl) throw new Error("未配置 INFERENCE_SIDECAR_URL，无法控制推理服务");
    const response = await fetchImpl(`${normalizedBaseUrl}${pathname}`, {
      method: body == null ? "GET" : "POST",
      headers: body == null ? undefined : { "content-type": "application/json" },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.detail || `推理侧车请求失败（${response.status}）`);
    return data;
  }

  return {
    status: () => request("/inference-server/status"),
    start: (input) => request("/inference-server/start", input),
    stop: () => request("/inference-server/stop", { action: "stop" }),
  };
}

module.exports = { createInferenceServerService };
