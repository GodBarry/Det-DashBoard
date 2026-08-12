"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");

const { createInferenceSidecarClient, normalizedBaseUrl } = require("../../server/runtime-jobs/inference-sidecar-client");

function transportFixture(response = { statusCode: 200, body: { ok: true, predictions: [] } }) {
  const calls = [];
  return {
    calls,
    transport: {
      request(target, options, onResponse) {
        calls.push({ target: String(target), options, body: "" });
        const req = new EventEmitter();
        req.write = (chunk) => { calls.at(-1).body += chunk.toString(); };
        req.end = () => {
          const res = new EventEmitter();
          res.statusCode = response.statusCode;
          onResponse(res);
          if (response.body !== undefined) res.emit("data", Buffer.from(JSON.stringify(response.body)));
          res.emit("end");
        };
        req.destroy = (error) => req.emit("error", error);
        return req;
      },
    },
  };
}

test("sidecar client normalizes configured URLs and posts bounded JSON requests", async () => {
  const fixture = transportFixture();
  const client = createInferenceSidecarClient({
    processRef: { env: { INFERENCE_SIDECAR_URL: "http://thor-host:4178///" } },
    http: fixture.transport,
  });

  assert.equal(normalizedBaseUrl(" http://thor-host:4178/// "), "http://thor-host:4178");
  assert.equal(client.hasYolo, true);
  assert.equal(client.hasDino, false);
  await client.yoloBatch({ jobId: "job-1" });
  assert.equal(fixture.calls[0].target, "http://thor-host:4178/infer");
  assert.equal(fixture.calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(fixture.calls[0].body), { jobId: "job-1" });
});

test("sidecar client propagates HTTP and application failures", async () => {
  const fixture = transportFixture({ statusCode: 500, body: { ok: false, error: "GPU unavailable" } });
  const client = createInferenceSidecarClient({
    processRef: { env: { DINO_SIDECAR_URL: "http://thor-host:4181" } },
    http: fixture.transport,
  });

  await assert.rejects(() => client.dinoBatch({ jobId: "job-2" }), /GPU unavailable/);
});
