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
  "project-catalog-core.js",
);

const coreModulePromise = import(
  `data:text/javascript;base64,${fs.readFileSync(coreModulePath).toString("base64")}`
);

const projects = [
  { id: "project-root", name: "任务A", parent_id: null, child_count: 1, image_count: 10, video_count: 2, annotation_count: 4, last_import_at: "2026-07-01T00:00:00Z" },
  { id: "batch", name: "批次1", parent_id: "project-root", child_count: 1, image_count: 8, video_count: 1, annotation_count: 3, last_import_at: "2026-07-02T00:00:00Z" },
  { id: "samples", name: "样本集", parent_id: "batch", child_count: 0, image_count: 5, video_count: 0, annotation_count: 2, last_import_at: "2026-07-03T00:00:00Z" },
  { id: "other", name: "任务B", parent_id: null, child_count: 0, image_count: 7, video_count: 3, annotation_count: 6, last_import_at: "" },
];

test("catalog helpers preserve hierarchy, breadcrumb limits, and descendant import times", async () => {
  const {
    buildProjectBreadcrumbs,
    buildProjectById,
    buildProjectLastImportAt,
  } = await coreModulePromise;
  const projectById = buildProjectById(projects);
  const lastImportAt = buildProjectLastImportAt(projects);

  assert.equal(projectById.get("batch").name, "批次1");
  assert.deepEqual(
    buildProjectBreadcrumbs(projectById.get("samples"), projectById, 3).map((project) => project.id),
    ["project-root", "batch", "samples"],
  );
  assert.equal(lastImportAt.get("project-root"), "2026-07-03T00:00:00Z");
  assert.equal(lastImportAt.get("batch"), "2026-07-03T00:00:00Z");
  assert.equal(lastImportAt.get("other"), "");
});

test("buildProjectBreadcrumbs stops at repeated parents", async () => {
  const { buildProjectBreadcrumbs, buildProjectById } = await coreModulePromise;
  const cyclicProjects = [
    { id: "a", parent_id: "b" },
    { id: "b", parent_id: "a" },
  ];
  const projectById = buildProjectById(cyclicProjects);

  assert.deepEqual(
    buildProjectBreadcrumbs(projectById.get("a"), projectById, 4).map((project) => project.id),
    ["b", "a"],
  );
});

test("buildHomeStats keeps root-only totals and current-folder semantics", async () => {
  const { buildHomeStats } = await coreModulePromise;

  assert.deepEqual(buildHomeStats(null, projects, [{ id: "trash-a" }]), {
    title: "全部项目",
    projects: 2,
    folders: 4,
    images: 17,
    videos: 5,
    annotations: 10,
    trash: 1,
  });
  assert.deepEqual(buildHomeStats(projects[1], projects, []), {
    title: "批次1",
    projects: 1,
    folders: 1,
    images: 8,
    videos: 1,
    annotations: 3,
    trash: 0,
  });
});

test("getCreateProjectContext preserves workspace parent and third-level limit input", async () => {
  const { getCreateProjectContext } = await coreModulePromise;
  const activeProject = projects[2];

  const workspaceContext = getCreateProjectContext({
    view: "workspace",
    activeProject,
    activeBreadcrumbs: projects.slice(0, 3),
    breadcrumbs: [],
    currentFolderId: "batch",
  });

  assert.deepEqual(workspaceContext, {
    depth: 3,
    isWorkspace: activeProject,
    parentId: "samples",
  });
  assert.equal(workspaceContext.depth >= 3, true);

  assert.deepEqual(getCreateProjectContext({
    view: "home",
    activeProject: null,
    activeBreadcrumbs: [],
    breadcrumbs: projects.slice(0, 2),
    currentFolderId: "batch",
  }), {
    depth: 2,
    isWorkspace: false,
    parentId: "batch",
  });
});
