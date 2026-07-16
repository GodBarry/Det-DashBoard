const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { createRuntimeWorkerSupport } = require("../../server/runtime-jobs/worker-support");

function createChild(events, code) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr.setEncoding = () => {};
  queueMicrotask(() => {
    for (const [stream, chunk] of events) child[stream].emit("data", chunk);
    child.emit("close", code);
  });
  return child;
}

test("stopProcess preserves Windows taskkill fallback", () => {
  const calls = [];
  const processRef = {
    pid: 42,
    platform: "win32",
    kill(pid) {
      calls.push(["kill", pid]);
      throw new Error("denied");
    },
  };
  const spawn = (...args) => calls.push(["spawn", ...args]);
  const { stopProcess } = createRuntimeWorkerSupport({ query: async () => {}, spawn, processRef });

  assert.equal(stopProcess("123"), true);
  assert.equal(stopProcess(42), false);
  assert.equal(stopProcess("invalid"), false);
  assert.deepEqual(calls, [
    ["kill", 123],
    ["spawn", "taskkill", ["/PID", "123", "/T", "/F"], { windowsHide: true, stdio: "ignore" }],
  ]);
});

test("runChildProcess preserves combined output arrival order", async () => {
  const spawnCalls = [];
  const spawn = (...args) => {
    spawnCalls.push(args);
    return createChild([["stdout", "out-1\n"], ["stderr", "err-1\n"], ["stdout", "out-2\n"]], 0);
  };
  const { runChildProcess } = createRuntimeWorkerSupport({ query: async () => {}, spawn, processRef: {} });

  const result = await runChildProcess("python", ["worker.py"], { cwd: "job", windowsHide: false });

  assert.deepEqual(spawnCalls, [["python", ["worker.py"], { windowsHide: false, cwd: "job" }]]);
  assert.deepEqual(result, {
    stdout: "out-1\nout-2\n",
    stderr: "err-1\n",
    combined: "out-1\nerr-1\nout-2\n",
    code: 0,
  });
});

test("runChildProcess preserves nonzero exit details", async () => {
  const spawn = () => createChild([["stdout", "details\n"], ["stderr", " failure \n"]], 7);
  const { runChildProcess } = createRuntimeWorkerSupport({ query: async () => {}, spawn, processRef: {} });

  await assert.rejects(runChildProcess("runner", []), (error) => {
    assert.equal(error.message, "failure");
    assert.equal(error.code, 7);
    assert.equal(error.stdout, "details\n");
    assert.equal(error.stderr, " failure \n");
    assert.equal(error.combined, "details\n failure \n");
    return true;
  });
});

test("appendTrainingLog truncates lines and swallows query failures", async () => {
  const calls = [];
  const query = async (...args) => {
    calls.push(args);
    throw new Error("write failed");
  };
  const { appendTrainingLog } = createRuntimeWorkerSupport({ query, spawn: () => {}, processRef: {} });

  await appendTrainingLog("job-1", "stdout", "x".repeat(4001));
  await appendTrainingLog("job-1", "stdout", "");

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "INSERT INTO runtime_training_logs (job_id, stream, line) VALUES ($1,$2,$3)");
  assert.deepEqual(calls[0][1].slice(0, 2), ["job-1", "stdout"]);
  assert.equal(calls[0][1][2], "x".repeat(4000));
});
