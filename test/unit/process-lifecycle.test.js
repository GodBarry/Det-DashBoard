const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { createProcessLifecycle } = require("../../server/bootstrap/process-lifecycle");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function createHarness(overrides = {}) {
  const events = [];
  const processRef = new EventEmitter();
  processRef.exit = (code) => events.push(["exit", code]);
  const globalRef = {};
  const logger = {
    log: (...args) => events.push(["log", ...args]),
    error: (...args) => events.push(["error", ...args]),
  };
  const server = new EventEmitter();
  server.listen = (port, host, callback) => {
    events.push(["listen", port, host]);
    server.listenCallback = callback;
  };
  server.close = (callback) => {
    events.push(["close"]);
    callback();
  };
  const lifecycle = {
    beginShutdown: () => true,
    stopWorkers: async () => { events.push(["stopWorkers"]); },
    waitForBackgroundTasks: async () => { events.push(["waitForBackgroundTasks"]); },
    registerWorker: (worker) => events.push(["registerWorker", worker]),
  };
  const pool = {
    end: async () => { events.push(["pool.end"]); },
  };
  let requestListener;
  const dependencies = {
    createServer: (listener) => {
      events.push(["createServer"]);
      requestListener = listener;
      return server;
    },
    route: async () => {},
    sendError: (...args) => events.push(["sendError", ...args]),
    lifecycle,
    startTrainingWorker: () => {
      events.push(["startTrainingWorker"]);
      return "training-worker";
    },
    startInferenceWorker: () => {
      events.push(["startInferenceWorker"]);
      return "inference-worker";
    },
    pool,
    port: 8787,
    host: "0.0.0.0",
    dataRoot: "/data",
    dataRootDisplay: "D:\\data",
    browseRoot: "/browse",
    browseRootDisplay: "D:\\browse",
    hostPathMode: "windows",
    storageRoot: "/storage",
    processRef,
    globalRef,
    logger,
    scheduleTimeout: () => {},
    ...overrides,
  };
  const controller = createProcessLifecycle(dependencies);
  return {
    controller,
    dependencies,
    events,
    globalRef,
    lifecycle,
    logger,
    pool,
    processRef,
    requestListener: () => requestListener,
    server,
  };
}

test("startHttpServer preserves server, listener, worker, and global registration order", () => {
  const harness = createHarness();

  const result = harness.controller.startHttpServer();

  assert.equal(result, harness.server);
  assert.equal(harness.globalRef.detDashboardServer, harness.server);
  assert.deepEqual(harness.events, [
    ["createServer"],
    ["listen", 8787, "0.0.0.0"],
    ["startTrainingWorker"],
    ["startInferenceWorker"],
    ["registerWorker", "training-worker"],
    ["registerWorker", "inference-worker"],
  ]);

  harness.server.listenCallback();
  assert.deepEqual(harness.events.slice(6), [
    ["log", "PostgreSQL + MinIO API: http://localhost:8787"],
    ["log", "DATA_ROOT=/data"],
    ["log", "DATA_ROOT_DISPLAY=D:\\data"],
    ["log", "BROWSE_ROOT=/browse"],
    ["log", "BROWSE_ROOT_DISPLAY=D:\\browse"],
    ["log", "HOST_PATH_MODE=windows"],
    ["log", "STORAGE_ROOT=/storage"],
  ]);
});

test("HTTP listener preserves route error handling and server event logs", async () => {
  const internalError = Object.assign(new Error("broken"), { statusCode: 503 });
  const harness = createHarness({ route: async () => { throw internalError; } });
  harness.controller.startHttpServer();
  const response = { headersSent: false, end: () => harness.events.push(["end"]) };

  harness.requestListener()({}, response);
  await Promise.resolve();
  harness.server.emit("error", internalError);
  harness.server.emit("close");

  assert.deepEqual(harness.events.slice(6), [
    ["error", internalError],
    ["sendError", response, 503, "broken"],
    ["error", "HTTP server error:", internalError],
    ["error", "HTTP server closed"],
  ]);
});

test("shutdown waits for server, workers, and background tasks before closing PostgreSQL", async () => {
  const serverClosed = deferred();
  const workersStopped = deferred();
  const backgroundTasksStopped = deferred();
  const timeoutCalls = [];
  const harness = createHarness({
    scheduleTimeout: (callback, milliseconds) => timeoutCalls.push([callback, milliseconds]),
  });
  harness.server.close = (callback) => {
    harness.events.push(["close"]);
    serverClosed.promise.then(callback);
  };
  harness.lifecycle.stopWorkers = () => {
    harness.events.push(["stopWorkers"]);
    return workersStopped.promise;
  };
  harness.lifecycle.waitForBackgroundTasks = () => {
    harness.events.push(["waitForBackgroundTasks"]);
    return backgroundTasksStopped.promise;
  };
  await harness.controller.run(async () => harness.server);

  const stopping = harness.controller.shutdown("SIGTERM");
  await Promise.resolve();
  assert.equal(timeoutCalls[0][1], 25000);
  assert.deepEqual(harness.events.slice(0, 4), [
    ["log", "Received SIGTERM; stopping gracefully"],
    ["close"],
    ["stopWorkers"],
    ["waitForBackgroundTasks"],
  ]);
  assert.equal(harness.events.some(([name]) => name === "pool.end"), false);

  serverClosed.resolve();
  workersStopped.resolve();
  backgroundTasksStopped.resolve();
  await stopping;
  assert.deepEqual(harness.events.at(-1), ["pool.end"]);
});

test("shutdown uses the 25 second timeout, remains idempotent, and preserves pool errors", async () => {
  let shuttingDown = false;
  let timeoutCallback;
  const databaseError = new Error("database stuck");
  const never = new Promise(() => {});
  const harness = createHarness({
    scheduleTimeout: (callback, milliseconds) => {
      assert.equal(milliseconds, 25000);
      timeoutCallback = callback;
    },
    pool: { end: async () => { throw databaseError; } },
  });
  harness.lifecycle.beginShutdown = () => {
    if (shuttingDown) return false;
    shuttingDown = true;
    return true;
  };
  harness.lifecycle.stopWorkers = () => never;
  harness.lifecycle.waitForBackgroundTasks = () => never;
  harness.server.close = () => {};
  await harness.controller.run(async () => harness.server);

  const first = harness.controller.shutdown("SIGINT");
  await harness.controller.shutdown("SIGTERM");
  assert.equal(harness.events.filter((event) => event[0] === "log").length, 1);
  timeoutCallback();
  await first;

  assert.deepEqual(harness.events.at(-1), ["error", "PostgreSQL shutdown error:", "database stuck"]);
});

test("run installs both signal handlers and preserves success and failure exit behavior", async () => {
  const success = createHarness();
  await success.controller.run(async () => success.server);

  success.processRef.emit("SIGINT");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(success.events.at(-1), ["exit", 0]);

  const startupError = new Error("startup failed");
  const failure = createHarness();
  await failure.controller.run(async () => { throw startupError; });
  assert.deepEqual(failure.events, [
    ["error", startupError],
    ["exit", 1],
  ]);
  assert.equal(failure.processRef.listenerCount("SIGINT"), 1);
  assert.equal(failure.processRef.listenerCount("SIGTERM"), 1);
});
