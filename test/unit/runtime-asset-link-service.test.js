const test = require("node:test");
const assert = require("node:assert/strict");

const { createRuntimeAssetLinkService } = require("../../server/ml-assets/runtime-asset-link-service");

function createFixture(queryImpl) {
  const calls = { queries: [], scopes: [] };
  const query = async (sql, params) => {
    calls.queries.push({ sql, params });
    return queryImpl ? queryImpl(sql, params, calls) : { rows: [] };
  };
  const scopeSql = ({ table, alias, actor, scope, params }) => {
    calls.scopes.push({ table, alias, actor, scope, params: [...params] });
    return { sql: `${alias}.owner_user_id=$${params.length + 1}`, params: [...params, `${alias}:${actor.id}:${scope}`] };
  };
  return { calls, service: createRuntimeAssetLinkService({ query, scopeSql }) };
}

test("recordSuccess preserves JSON parsing and select-update query order", async () => {
  const { calls, service } = createFixture(async (sql) => {
    if (/SELECT model_id FROM model_revisions/.test(sql)) return { rows: [{ model_id: "model-1" }] };
    if (/SELECT id FROM runtime_asset_links/.test(sql)) return { rows: [{ id: "link-1" }] };
    return { rows: [] };
  });
  const job = {
    id: "job-1",
    model_version_id: "version-1",
    dataset_project_id: "project-1",
    params_json: JSON.stringify({ templateId: "algorithm-1", python_env_id: "env-1" }),
  };

  await service.recordSuccess(job, { map50: 0.75 });

  assert.deepEqual(calls.queries.map((entry) => entry.sql.trim().split(/\s+/).slice(0, 2).join(" ")), [
    "SELECT model_id",
    "SELECT id",
    "UPDATE runtime_asset_links",
  ]);
  assert.deepEqual(calls.queries[1].params, ["algorithm-1", "version-1", "env-1", "project-1"]);
  assert.deepEqual(calls.queries[2].params, ["model-1", "job-1", '{"map50":0.75}', "link-1"]);
  assert.match(calls.queries[2].sql, /success_count=success_count\+1/);
});

test("recordSuccess preserves select-insert semantics and null metrics JSON", async () => {
  const { calls, service } = createFixture();
  const job = {
    id: "job-2",
    model_version_id: "version-2",
    dataset_project_id: null,
    params_json: { algorithmAssetId: "algorithm-2", pythonEnvId: "env-2", modelId: "model-2" },
  };

  await service.recordSuccess(job, null);

  assert.equal(calls.queries.length, 2);
  assert.match(calls.queries[0].sql, /^SELECT id FROM runtime_asset_links/);
  assert.match(calls.queries[1].sql, /^INSERT INTO runtime_asset_links/);
  assert.deepEqual(calls.queries[1].params, ["algorithm-2", "model-2", "version-2", "env-2", null, "job-2", "{}"]);
});

test("backfillInferenceSuccesses keeps filtering, existing checks, metrics, and per-record failure handling", async () => {
  const jobs = [
    { id: "skip", model_version_id: "version-0", params_json: { pythonEnvId: "env-0" } },
    { id: "existing", model_version_id: "version-1", dataset_project_id: "project-1", params_json: { algorithmAssetId: "algorithm-1", pythonEnvId: "env-1" } },
    { id: "new", model_version_id: "version-2", dataset_project_id: "project-2", params_json: JSON.stringify({ templateId: "algorithm-2", pythonEnvId: "env-2", modelId: "model-2", output: { metrics: { loss: 0.2 } } }) },
  ];
  let linkSelectCount = 0;
  const { calls, service } = createFixture(async (sql) => {
    if (/SELECT \* FROM runtime_inference_jobs/.test(sql)) return { rows: jobs };
    if (/SELECT id FROM runtime_asset_links/.test(sql)) {
      linkSelectCount += 1;
      if (linkSelectCount === 1) return { rows: [{ id: "link-existing" }] };
      return { rows: [] };
    }
    if (/INSERT INTO runtime_asset_links/.test(sql)) throw new Error("concurrent insert");
    return { rows: [] };
  });

  await service.backfillInferenceSuccesses();

  assert.match(calls.queries[0].sql, /ORDER BY finished_at DESC NULLS LAST\s+LIMIT 100/);
  assert.equal(calls.queries.filter((entry) => /SELECT id FROM runtime_asset_links/.test(entry.sql)).length, 3);
  const insert = calls.queries.find((entry) => /INSERT INTO runtime_asset_links/.test(entry.sql));
  assert.deepEqual(insert.params, ["algorithm-2", "model-2", "version-2", "env-2", "project-2", "new", '{"loss":0.2}']);
});

test("listLinks preserves cumulative OR visibility scope and response rows", async () => {
  const actor = { id: "user-1" };
  const links = [{ id: "link-1" }];
  const { calls, service } = createFixture(async (sql) => {
    if (/SELECT \* FROM runtime_inference_jobs/.test(sql)) return { rows: [] };
    if (/SELECT ral\.\*/.test(sql)) return { rows: links };
    return { rows: [] };
  });

  assert.deepEqual(await service.listLinks(actor, "public"), links);

  assert.deepEqual(calls.scopes.map((entry) => [entry.table, entry.alias, entry.params]), [
    ["algorithm_assets", "aa", []],
    ["model_clusters", "mc", ["aa:user-1:public"]],
    ["runtime_envs", "re", ["aa:user-1:public", "mc:user-1:public"]],
    ["projects", "p", ["aa:user-1:public", "mc:user-1:public", "re:user-1:public"]],
  ]);
  const select = calls.queries.at(-1);
  assert.match(select.sql, /WHERE \(aa\.id IS NOT NULL AND aa\.owner_user_id=\$1\) OR \(mc\.id IS NOT NULL AND mc\.owner_user_id=\$2\) OR \(re\.id IS NOT NULL AND re\.owner_user_id=\$3\) OR \(p\.id IS NOT NULL AND p\.owner_user_id=\$4\)/);
  assert.deepEqual(select.params, ["aa:user-1:public", "mc:user-1:public", "re:user-1:public", "p:user-1:public"]);
});

test("listLinks preserves fallback error codes and rethrows other failures", async () => {
  for (const code of ["42P01", "XX002"]) {
    const error = Object.assign(new Error("schema unavailable"), { code });
    const { service } = createFixture(async () => { throw error; });
    assert.deepEqual(await service.listLinks({ id: "user-1" }), []);
  }

  const fatal = Object.assign(new Error("database disconnected"), { code: "08006" });
  const { service } = createFixture(async () => { throw fatal; });
  await assert.rejects(() => service.listLinks({ id: "user-1" }), fatal);
});
