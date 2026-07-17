const test = require("node:test");
const assert = require("node:assert/strict");

const { createRuntimeQueueService } = require("../../server/runtime-jobs/queue-service");

function createService(clientQuery, isAdmin = () => false) {
  let transactionCalls = 0;
  const service = createRuntimeQueueService({
    query: async () => ({ rows: [] }),
    transaction: async (callback) => {
      transactionCalls += 1;
      return callback({ query: clientQuery });
    },
    accessControl: { isAdmin },
  });
  return { service, getTransactionCalls: () => transactionCalls };
}

test("moveRuntimeJobPriority rejects tables outside the queue whitelist", async () => {
  const { service, getTransactionCalls } = createService(async () => ({ rows: [] }));

  await assert.rejects(
    service.moveRuntimeJobPriority("runtime_jobs; DROP TABLE app_users", "job-1", "up", { id: "user-1" }),
    /unsupported queue type/,
  );
  assert.equal(getTransactionCalls(), 0);
});

test("moveRuntimeJobPriority scopes non-admin queues to the actor owner", async () => {
  const calls = [];
  const actor = { id: "user-1" };
  const { service } = createService(async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ id: "job-1", priority: 4, created_at: "2026-01-01" }] };
  });

  const job = await service.moveRuntimeJobPriority("runtime_training_jobs", "job-1", "up", actor);

  assert.equal(job.id, "job-1");
  assert.match(calls[0].sql, /FROM runtime_training_jobs\s+WHERE created_by_user_id=\$1/);
  assert.deepEqual(calls[0].params, [actor.id]);
});

test("moveRuntimeJobPriority normalizes and swaps adjacent priorities", async () => {
  const calls = [];
  const queued = [
    { id: "job-a", priority: 20, created_at: "2026-01-03" },
    { id: "job-b", priority: 5, created_at: "2026-01-02" },
    { id: "job-c", priority: 5, created_at: "2026-01-01" },
  ];
  const returned = { id: "job-b", priority: 3 };
  const { service } = createService(async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith("SELECT id,")) return { rows: queued };
    if (sql.startsWith("SELECT *")) return { rows: [returned] };
    return { rows: [] };
  }, () => true);

  const result = await service.moveRuntimeJobPriority("runtime_inference_jobs", "job-b", "up", { id: "admin" });

  assert.equal(result, returned);
  assert.deepEqual(calls.slice(1, 6).map(({ params }) => params), [
    [3, "job-a"],
    [2, "job-b"],
    [1, "job-c"],
    [3, "job-b"],
    [2, "job-a"],
  ]);
  assert.doesNotMatch(calls[0].sql, /created_by_user_id/);
  assert.deepEqual(calls[0].params, []);
});

test("claimTrainingJob preserves priority order, locking, and update contract", async () => {
  const calls = [];
  const pending = { id: "training-1", status: "pending" };
  const updated = { id: "training-1", status: "preparing", worker_id: "worker-a" };
  const { service } = createService(async (sql, params) => {
    calls.push({ sql, params });
    return calls.length === 1 ? { rows: [pending] } : { rows: [updated] };
  });

  const result = await service.claimTrainingJob("worker-a");

  assert.equal(result, updated);
  assert.match(calls[0].sql, /ORDER BY priority DESC, created_at\s+FOR UPDATE SKIP LOCKED/);
  assert.match(calls[1].sql, /status='preparing', worker_id=\$1, heartbeat_at=now\(\), started_at=COALESCE\(started_at, now\(\)\), message=\$2/);
  assert.deepEqual(calls[1].params, ["worker-a", "正在生成数据集快照", "training-1"]);
});

test("claimInferenceJob uses priority order, FIFO ties, and skip-locked claiming", async () => {
  const calls = [];
  const pending = { id: "inference-1", status: "pending", priority: 8 };
  const { service } = createService(async (sql, params) => {
    calls.push({ sql, params });
    return calls.length === 1 ? { rows: [pending] } : { rows: [] };
  });

  const result = await service.claimInferenceJob("worker-b");

  assert.deepEqual(result, { ...pending, status: "running" });
  assert.match(calls[0].sql, /ORDER BY priority DESC, created_at ASC\s+FOR UPDATE SKIP LOCKED/);
  assert.equal(calls[0].sql.includes("ORDER BY created_at\n"), false);
  assert.match(calls[1].sql, /status='running', progress=10, message=\$1, started_at=COALESCE\(started_at, now\(\)\)/);
  assert.deepEqual(calls[1].params, ["推理 worker worker-b 已接管任务", "inference-1"]);
});
