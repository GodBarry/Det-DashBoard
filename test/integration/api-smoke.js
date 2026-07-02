const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:15173";
const dataRoot = process.env.TEST_DATA_DISPLAY || "/test-data";
const browseRoot = process.env.TEST_BROWSE_DISPLAY || dataRoot;
const exportsRoot = path.resolve(process.env.TEST_EXPORTS_DIR || "/tmp/det-dashboard-test/exports");

async function request(method, pathname, body, expected = 200) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { text }; }
  assert.equal(response.status, expected, `${method} ${pathname}: ${response.status} ${text}`);
  return data;
}

function rawStatus(pathname) {
  const target = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: target.hostname, port: target.port, method: "GET", path: pathname }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end();
  });
}

async function waitForImport(projectId) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const data = await request("GET", `/api/projects/${projectId}/imports`);
    const batch = data.imports[0];
    if (batch && ["done", "failed", "cancelled"].includes(batch.status)) {
      assert.equal(batch.status, "done", batch.message);
      return batch;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`import timeout for ${projectId}`);
}

async function waitForJob(jobId) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const data = await request("GET", "/api/jobs");
    const job = data.jobs.find((row) => row.id === jobId);
    if (job && ["done", "failed"].includes(job.status)) {
      assert.equal(job.status, "done", job.message);
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`job timeout for ${jobId}`);
}

async function createAndImport(name, relativePath) {
  const created = await request("POST", "/api/projects", { name });
  const project = created.project;
  await request("POST", "/api/imports", { projectId: project.id, sourcePath: `${dataRoot}/${relativePath}`, rename: true });
  const batch = await waitForImport(project.id);
  const summary = (await request("GET", `/api/projects/${project.id}/summary`)).summary;
  const images = await request("GET", `/api/projects/${project.id}/images?page=1&pageSize=48`);
  return { project, batch, summary, images };
}

async function exportAndVerify(projectId, format) {
  const before = new Set(fs.existsSync(exportsRoot) ? fs.readdirSync(exportsRoot) : []);
  const started = await request("POST", `/api/projects/${projectId}/export`, { format });
  assert.equal(started.format, format);
  await waitForJob(started.jobId);
  const created = fs.readdirSync(exportsRoot).filter((name) => !before.has(name));
  assert.equal(created.length, 1, `expected one ${format} export, got ${created.join(",")}`);
  const root = path.join(exportsRoot, created[0]);
  assert.ok(fs.readdirSync(path.join(root, "images")).length > 0);
  if (format === "labelme") {
    assert.ok(fs.readdirSync(path.join(root, "jsons")).some((name) => name.endsWith(".json")));
  } else if (format === "coco") {
    const document = JSON.parse(fs.readFileSync(path.join(root, "annotations", "instances.json"), "utf8"));
    assert.equal(document.images.length, 1);
    assert.ok(document.annotations.length > 0);
  } else {
    assert.ok(fs.existsSync(path.join(root, "data.yaml")));
    assert.ok(fs.readdirSync(path.join(root, "labels")).some((name) => name.endsWith(".txt")));
  }
}

async function main() {
  assert.equal((await request("GET", "/api/health/live")).status, "ok");
  assert.equal((await request("GET", "/api/health/ready")).status, "ok");
  const config = await request("GET", "/api/config");
  assert.equal(config.browseRootDisplay, browseRoot);
  const dirs = await request("GET", `/api/fs/dirs?path=${encodeURIComponent(dataRoot)}`);
  assert.equal(dirs.parent, "");
  assert.ok(dirs.dirs.some((entry) => entry.name === "coco"));

  const nested = (await request("POST", "/api/projects", { name: "level-a/level-b/level-c" })).project;
  assert.equal(nested.name, "level-c");
  const projectTree = await request("GET", "/api/projects");
  const middle = projectTree.projects.find((project) => project.id === nested.parent_id);
  const root = projectTree.projects.find((project) => project.id === middle.parent_id);
  assert.equal(middle.name, "level-b");
  assert.equal(root.name, "level-a");
  await request("POST", "/api/projects", { name: "too/deep/path/here" }, 400);
  const trashTreeName = `trash-tree-${Date.now()}`;
  const trashLeaf = (await request("POST", "/api/projects", { name: `${trashTreeName}/branch/leaf` })).project;
  const trashTree = await request("GET", "/api/projects");
  const trashBranch = trashTree.projects.find((project) => project.id === trashLeaf.parent_id);
  const trashRoot = trashTree.projects.find((project) => project.id === trashBranch.parent_id);
  await request("DELETE", `/api/projects/${trashRoot.id}`, null);
  const afterDeleteTree = await request("GET", "/api/projects");
  assert.ok(!afterDeleteTree.projects.some((project) => [trashRoot.id, trashBranch.id, trashLeaf.id].includes(project.id)));
  const trashAfterTreeDelete = await request("GET", "/api/projects/trash");
  assert.ok([trashRoot.id, trashBranch.id, trashLeaf.id].every((id) => trashAfterTreeDelete.projects.some((project) => project.id === id)));
  await request("POST", `/api/projects/${trashRoot.id}/restore`, {});
  const afterRestoreTree = await request("GET", "/api/projects");
  assert.ok([trashRoot.id, trashBranch.id, trashLeaf.id].every((id) => afterRestoreTree.projects.some((project) => project.id === id)));

  const labelme = await createAndImport("e2e-labelme", "labelme/scene-labelme");
  assert.equal(labelme.summary.image_count, 1);
  assert.equal(labelme.summary.annotation_count, 1);
  assert.deepEqual(labelme.summary.scenes, ["labelme-meta"]);
  assert.deepEqual(labelme.summary.labels, ["car"]);
  assert.match(labelme.batch.message, /LabelMe 1/);
  assert.equal(labelme.images.items[0].image_width, 120);
  assert.equal(labelme.images.items[0].annotations[0].label, "car");

  const coco = await createAndImport("e2e-coco", "coco/scene-coco");
  assert.equal(coco.summary.annotation_count, 1);
  assert.deepEqual(coco.summary.scenes, ["scene-coco"]);
  assert.deepEqual(coco.summary.labels, ["ship"]);
  assert.match(coco.batch.message, /COCO 1/);
  assert.equal(Number(coco.images.items[0].annotations[0].bbox_w), 50);

  const yolo = await createAndImport("e2e-yolo", "yolo/scene-yolo");
  assert.equal(yolo.summary.annotation_count, 1);
  assert.deepEqual(yolo.summary.scenes, ["scene-yolo"]);
  assert.deepEqual(yolo.summary.labels, ["vehicle"]);
  assert.match(yolo.batch.message, /YOLO 1/);
  assert.equal(Number(yolo.images.items[0].annotations[0].bbox_w), 80);
  assert.equal(Number(yolo.images.items[0].annotations[0].bbox_h), 20);

  const filtered = await request("GET", `/api/projects/${yolo.project.id}/images?page=1&pageSize=48&scenes=scene-yolo&labels=vehicle`);
  assert.equal(filtered.total, 1);

  const saved = await request("POST", `/api/project-images/${labelme.images.items[0].id}/annotations/save`, {
    annotations: [{ label: "edited", bbox_x: 1, bbox_y: 2, bbox_w: 30, bbox_h: 20 }],
  });
  assert.equal(saved.annotations[0].label, "edited");
  const editedSummary = (await request("GET", `/api/projects/${labelme.project.id}/summary`)).summary;
  assert.deepEqual(editedSummary.labels, ["edited"]);

  const video = await createAndImport("e2e-video", "video/scene-video");
  assert.equal(video.summary.video_count, 1);
  assert.equal(video.summary.image_count, 0);
  await request("DELETE", `/api/imports/${video.batch.id}`);
  const videoAfterDelete = (await request("GET", `/api/projects/${video.project.id}/summary`)).summary;
  assert.equal(videoAfterDelete.video_count, 0);
  await request("POST", `/api/imports/${video.batch.id}/restore`, {});
  const videoAfterRestore = (await request("GET", `/api/projects/${video.project.id}/summary`)).summary;
  assert.equal(videoAfterRestore.video_count, 1);

  await exportAndVerify(labelme.project.id, "labelme");
  await exportAndVerify(labelme.project.id, "coco");
  await exportAndVerify(labelme.project.id, "yolo");
  await request("POST", `/api/projects/${labelme.project.id}/export`, { format: "voc" }, 400);

  await request("DELETE", `/api/projects/${coco.project.id}`);
  const trash = await request("GET", "/api/projects/trash");
  assert.ok(trash.projects.some((project) => project.id === coco.project.id));
  await request("POST", `/api/projects/${coco.project.id}/restore`, {});
  const active = await request("GET", "/api/projects");
  assert.ok(active.projects.some((project) => project.id === coco.project.id));

  const baselinePreview = await request("POST", "/api/baselines/preview", {
    name: "e2e-baseline",
    sourceProjectIds: [labelme.project.id, yolo.project.id],
    iouSame: 0.9,
    iouLight: 0.75,
  });
  assert.equal(baselinePreview.summary.source_projects, 2);
  assert.equal(baselinePreview.summary.unique_images, 2);
  const baselineConflicts = await request("GET", `/api/baselines/${baselinePreview.runId}/conflicts`);
  assert.equal(baselineConflicts.conflicts.length, 0);
  const baseline = await request("POST", `/api/baselines/${baselinePreview.runId}/apply`, { name: "e2e-baseline-result" });
  assert.equal(baseline.imageCount, 2);

  const model = (await request("POST", "/api/ml/models", { name: "e2e-model", taskType: "detect", framework: "ultralytics" })).model;
  const version = (await request("POST", "/api/ml/model-versions", { modelId: model.id, versionName: "e2e-v1", stage: "pretrained" })).version;
  const renamed = (await request("PATCH", `/api/ml/model-versions/${version.id}`, { versionName: "e2e-v1-renamed" })).version;
  assert.equal(renamed.version_name, "e2e-v1-renamed");
  const template = (await request("POST", "/api/ml/training-templates", { name: "e2e-template", templateKey: "ultralytics_yolo", framework: "ultralytics", capabilities: { tasks: ["detect"] } })).template;
  const training = (await request("POST", "/api/ml/training-jobs", {
    name: "e2e-training",
    datasetProjectId: labelme.project.id,
    modelId: model.id,
    templateId: template.id,
    taskType: "detect",
    params: { epochs: 1 },
  })).job;
  assert.ok(["pending", "preparing", "running"].includes(training.status), `unexpected training status ${training.status}`);
  const trainingLogs = await request("GET", `/api/ml/training-jobs/${training.id}/logs`);
  assert.ok(trainingLogs.logs.length > 0);
  const requeued = (await request("POST", `/api/ml/training-jobs/${training.id}/requeue`, { params: { epochs: 2 } })).job;
  assert.equal(requeued.total_epochs, 2);
  const inference = (await request("POST", "/api/ml/inference-jobs", {
    name: "e2e-inference",
    datasetProjectId: labelme.project.id,
    modelVersionId: version.id,
    params: { conf: 0.25 },
  })).job;
  assert.ok(["pending", "preparing", "running"].includes(inference.status), `unexpected inference status ${inference.status}`);
  assert.ok((await request("GET", "/api/ml/models")).models.some((entry) => entry.id === model.id));
  assert.ok((await request("GET", "/api/ml/training-jobs")).jobs.some((entry) => entry.id === training.id));
  assert.ok((await request("GET", "/api/ml/inference-jobs")).jobs.some((entry) => entry.id === inference.id));

  const oversized = await fetch(`${baseUrl}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "x".repeat(1_100_000) }),
  });
  assert.equal(oversized.status, 413);

  assert.equal(await rawStatus("/../server/config.js"), 403);
  console.log("integration API smoke passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
