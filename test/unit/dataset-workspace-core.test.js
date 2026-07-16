const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const coreModulePath = path.resolve(
  __dirname,
  "..",
  "..",
  "src",
  "features",
  "datasets",
  "dataset-workspace-core.js",
);

const coreModulePromise = import(
  `data:text/javascript;base64,${fs.readFileSync(coreModulePath).toString("base64")}`
);

test("workspace constants preserve pagination and polling behavior", async () => {
  const { DATASET_WORKSPACE_PAGE_SIZE, DATASET_WORKSPACE_POLL_INTERVAL } = await coreModulePromise;

  assert.equal(DATASET_WORKSPACE_PAGE_SIZE, 48);
  assert.equal(DATASET_WORKSPACE_POLL_INTERVAL, 1500);
});
test("createDatasetWorkspaceFilters returns independent current defaults", async () => {
  const { createDatasetWorkspaceFilters } = await coreModulePromise;
  const first = createDatasetWorkspaceFilters();
  const second = createDatasetWorkspaceFilters();

  first.scenes.push("indoor");

  assert.deepEqual(second, {
    q: "",
    scenes: [],
    views: [],
    modalities: [],
    labels: [],
    importBatchIds: [],
  });
});

test("buildWorkspaceSearchParams preserves filters and omits empty lists", async () => {
  const { buildWorkspaceSearchParams, createDatasetWorkspaceFilters } = await coreModulePromise;
  const params = buildWorkspaceSearchParams(3, {
    ...createDatasetWorkspaceFilters(),
    q: "dock crane",
    scenes: ["harbor", "yard"],
    labels: ["ship"],
    importBatchIds: ["batch-1", "batch-2"],
  });

  assert.equal(params.toString(), "page=3&pageSize=48&q=dock+crane&scenes=harbor%2Cyard&labels=ship&importBatchIds=batch-1%2Cbatch-2");
  assert.equal(params.has("views"), false);
  assert.equal(params.has("modalities"), false);
});

test("dataset pagination derives and clamps real total pages", async () => {
  const { datasetTotalPages, clampDatasetPage } = await coreModulePromise;
  assert.equal(datasetTotalPages(6501, 48), 136);
  assert.equal(datasetTotalPages(0, 48), 1);
  assert.equal(clampDatasetPage(200, 6501, 48), 136);
  assert.equal(clampDatasetPage("3", 6501, 48), 3);
});

test("findRunningImport keeps current status priority and null fallback", async () => {
  const { findRunningImport } = await coreModulePromise;
  const rows = [
    { id: "done", status: "done" },
    { id: "cancel", status: "cancel_requested" },
    { id: "running", status: "running" },
  ];

  assert.strictEqual(findRunningImport(rows), rows[1]);
  assert.equal(findRunningImport([{ id: "failed", status: "failed" }]), null);
});

test("buildTerminalImportRefreshKey uses the first terminal import and finish time", async () => {
  const { buildTerminalImportRefreshKey } = await coreModulePromise;
  const project = { id: "project-1" };

  assert.equal(buildTerminalImportRefreshKey(project, [
    { id: "running", status: "running" },
    { id: "failed", status: "failed", finished_at: "2026-07-16T01:02:03Z" },
    { id: "done", status: "done", finished_at: "later" },
  ]), "project-1:failed:failed:2026-07-16T01:02:03Z");
  assert.equal(buildTerminalImportRefreshKey(project, [{ id: "running", status: "running" }]), "");
  assert.equal(buildTerminalImportRefreshKey(project, [{ id: "cancelled", status: "cancelled" }]), "project-1:cancelled:cancelled:");
});
