"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createDatasetRoutes } = require("../../server/routes/dataset-routes");

function createHarness(overrides = {}) {
  const calls = [];
  const deps = {
    query: async () => ({ rows: [] }),
    readBody: async () => ({ name: "updated" }),
    sendJson: (_res, body) => calls.push(["sendJson", body]),
    httpError: (statusCode, message) => Object.assign(new Error(message), { statusCode }),
    requestedScope: () => "mine",
    accessControl: {
      requireAdmin: (actor) => calls.push(["requireAdmin", actor.id]),
    },
    resourceAccess: {
      assertProjectRead: async (...args) => calls.push(["projectRead", ...args]),
      assertProjectWrite: async (...args) => calls.push(["projectWrite", ...args]),
      assertProjectDelete: async (...args) => calls.push(["projectDelete", ...args]),
    },
    projectService: {
      listProjects: async (...args) => ({ args }),
      createProject: async () => ({ id: "created" }),
      renameProject: async () => ({ id: "renamed" }),
      projectSummary: async () => ({ imageCount: 4 }),
    },
    trashService: {
      emptyProjectTrash: async () => ({ deleted: 2 }),
      softDeleteProjectTree: async (...args) => calls.push(["softDeleteProject", ...args]),
      deleteProjectPermanently: async () => ({ deleted: 1 }),
      restoreProjectTree: async (...args) => calls.push(["restoreProject", ...args]),
      emptyImportTrash: async () => ({ deleted: 3 }),
      softDeleteImport: async (...args) => calls.push(["softDeleteImport", ...args]),
      restoreImport: async (...args) => calls.push(["restoreImport", ...args]),
    },
    importService: {
      importPath: async () => ({ batch: { id: "batch-1" } }),
      listImports: async (...args) => ({ args }),
      cancelImport: async (...args) => calls.push(["cancelImport", ...args]),
      softDeleteProjectImages: async () => ({ deleted: 2 }),
    },
    datasetContentService: {
      listProjectImages: async () => ({ images: [] }),
      exportProject: async () => ({ job: { id: "export-1" } }),
      streamProjectImage: async (...args) => calls.push(["streamImage", ...args.slice(1)]),
      saveImageAnnotations: async () => ({ saved: true }),
    },
    baselineService: {
      createBaselinePreview: async () => ({ runId: "run-1" }),
      listBaselineConflicts: async () => [{ id: "conflict-1" }],
      resolveBaselineConflicts: async () => ({ updated: 1 }),
      applyBaselineRun: async () => ({ applied: 1 }),
    },
    ...overrides,
  };
  return { routes: createDatasetRoutes(deps), calls };
}

function request(method) {
  return { method };
}

function parsed(pathname, query = {}) {
  return { pathname, query };
}

test("dataset routes ignore paths outside their domain", async () => {
  const { routes, calls } = createHarness();
  const handled = await routes.handle(request("GET"), {}, parsed("/api/ml/models"), { id: "user-1" });
  assert.equal(handled, false);
  assert.deepEqual(calls, []);
});

test("project listing preserves trash, actor, and scope response contracts", async () => {
  const { routes, calls } = createHarness();
  const actor = { id: "user-1" };
  const handled = await routes.handle(request("GET"), {}, parsed("/api/projects/trash"), actor);
  assert.equal(handled, true);
  assert.deepEqual(calls, [["sendJson", { projects: { args: [true, actor, "mine"] } }]]);
});

test("project deletion checks permission before moving the tree to trash", async () => {
  const { routes, calls } = createHarness();
  const actor = { id: "user-1" };
  await routes.handle(request("DELETE"), {}, parsed("/api/projects/project-1"), actor);
  assert.deepEqual(calls, [
    ["projectDelete", actor, "project-1"],
    ["softDeleteProject", "project-1"],
    ["sendJson", { ok: true }],
  ]);
});

test("thumbnail streaming resolves the owning project before access and output", async () => {
  const queryCalls = [];
  const { routes, calls } = createHarness({
    query: async (sql, params) => {
      queryCalls.push([sql, params]);
      return { rows: [{ project_id: "project-2" }] };
    },
  });
  const actor = { id: "user-1" };
  await routes.handle(request("GET"), { id: "response" }, parsed("/api/project-images/image-7/thumb"), actor);
  assert.match(queryCalls[0][0], /project_images/);
  assert.deepEqual(queryCalls[0][1], ["image-7"]);
  assert.deepEqual(calls, [
    ["projectRead", actor, "project-2"],
    ["streamImage", "image-7", "thumb"],
  ]);
});

test("screen preview preserves image access and requested variant size", async () => {
  const { routes, calls } = createHarness({
    query: async () => ({ rows: [{ project_id: "project-2" }] }),
  });
  const actor = { id: "user-1" };
  await routes.handle(
    request("GET"),
    { id: "response" },
    parsed("/api/project-images/image-7/preview", { size: "1920" }),
    actor,
  );
  assert.deepEqual(calls, [
    ["projectRead", actor, "project-2"],
    ["streamImage", "image-7", "preview", { size: "1920" }],
  ]);
});

test("baseline preview keeps the admin gate ahead of service execution", async () => {
  const order = [];
  const { routes, calls } = createHarness({
    accessControl: { requireAdmin: () => order.push("admin") },
    readBody: async () => {
      order.push("body");
      return { projectId: "project-1" };
    },
    baselineService: {
      createBaselinePreview: async () => {
        order.push("preview");
        return { runId: "run-1" };
      },
      listBaselineConflicts: async () => [],
      resolveBaselineConflicts: async () => ({}),
      applyBaselineRun: async () => ({}),
    },
  });
  await routes.handle(request("POST"), {}, parsed("/api/baselines/preview"), { id: "admin" });
  assert.deepEqual(order, ["admin", "body", "preview"]);
  assert.deepEqual(calls, [["sendJson", { runId: "run-1" }]]);
});

test("latest import requires a project and preserves progress query output", async () => {
  const { routes } = createHarness();
  await assert.rejects(
    routes.handle(request("GET"), {}, parsed("/api/imports/latest"), { id: "user-1" }),
    (error) => error.statusCode === 400 && error.message === "projectId is required",
  );

  const { routes: populatedRoutes, calls } = createHarness({
    query: async () => ({ rows: [{ id: "batch-4", progress: 75 }] }),
  });
  await populatedRoutes.handle(
    request("GET"),
    {},
    parsed("/api/imports/latest", { project_id: "project-4" }),
    { id: "user-1" },
  );
  assert.deepEqual(calls.at(-1), ["sendJson", { importBatch: { id: "batch-4", progress: 75 } }]);
});
