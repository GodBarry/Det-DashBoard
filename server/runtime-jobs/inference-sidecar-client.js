"use strict";

const defaultHttp = require("http");
const defaultHttps = require("https");

function normalizedBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function createInferenceSidecarClient({ processRef = process, http = defaultHttp, https = defaultHttps } = {}) {
  const yoloUrl = normalizedBaseUrl(processRef.env.INFERENCE_SIDECAR_URL);
  const dinoUrl = normalizedBaseUrl(processRef.env.DINO_SIDECAR_URL);
  const timeoutMs = Math.max(1000, Number(processRef.env.INFERENCE_SIDECAR_TIMEOUT_MS || 2 * 60 * 60 * 1000));

  function request(baseUrl, endpoint, payload, requestedTimeout = timeoutMs) {
    if (!baseUrl) throw new Error("推理侧车未配置");
    return new Promise((resolve, reject) => {
      const target = new URL(endpoint, `${baseUrl}/`);
      const body = payload == null ? null : Buffer.from(JSON.stringify(payload));
      const transport = target.protocol === "https:" ? https : http;
      const req = transport.request(target, {
        method: body ? "POST" : "GET",
        headers: body ? { "content-type": "application/json", "content-length": body.length } : {},
        timeout: requestedTimeout,
      }, (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > 16 * 1024 * 1024) {
            req.destroy(new Error("推理侧车响应超过 16 MiB"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let value;
          try { value = JSON.parse(text || "{}"); }
          catch { return reject(new Error(`推理侧车返回无效 JSON：${text.slice(0, 200)}`)); }
          if ((res.statusCode || 500) >= 400 || value.ok === false) {
            return reject(new Error(value.error || `推理侧车请求失败（HTTP ${res.statusCode}）`));
          }
          resolve(value);
        });
      });
      req.on("timeout", () => req.destroy(new Error("推理侧车请求超时")));
      req.on("error", reject);
      if (body) req.write(body);
      req.end();
    });
  }

  return {
    hasYolo: Boolean(yoloUrl),
    hasDino: Boolean(dinoUrl),
    yoloBatch(payload) { return request(yoloUrl, "/infer", payload); },
    dinoBatch(payload) { return request(dinoUrl, "/infer", payload); },
    yoloServerStatus() { return request(yoloUrl, "/inference-server/status", null, 30000); },
    startYoloServer(payload) { return request(yoloUrl, "/inference-server/start", payload, 300000); },
    stopYoloServer() { return request(yoloUrl, "/inference-server/stop", { action: "stop" }, 30000); },
    yoloImage(imageBase64) { return request(yoloUrl, "/inference-server/infer", { image_base64: imageBase64 }, 120000); },
    dinoImage(payload) { return request(dinoUrl, "/infer-image", payload, 600000); },
  };
}

module.exports = { createInferenceSidecarClient, normalizedBaseUrl };
