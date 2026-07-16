const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path").posix;

const { createInferenceInputCacheService } = require("../../server/runtime-jobs/inference-input-cache-service");

function createFixture({ rows = [], fsOverrides = {} } = {}) {
  const calls = {
    queries: [],
    mkdir: [],
    remove: [],
    links: [],
    symlinks: [],
    copies: [],
    writes: [],
    objectWrites: [],
  };
  const fs = {
    mkdirSync: (...args) => calls.mkdir.push(args),
    rmSync: (...args) => calls.remove.push(args),
    existsSync: () => true,
    linkSync: (...args) => calls.links.push(args),
    symlinkSync: (...args) => calls.symlinks.push(args),
    copyFileSync: (...args) => calls.copies.push(args),
    writeFileSync: (...args) => calls.writes.push(args),
    ...fsOverrides,
  };
  const query = async (sql, params) => {
    calls.queries.push({ sql, params });
    if (sql.includes("FROM project_images pi")) return { rows };
    return { rows: [] };
  };
  const service = createInferenceInputCacheService({
    query,
    fs,
    path,
    storageRoot: "/storage",
    writeObjectToFile: async (...args) => calls.objectWrites.push(args),
  });
  return { calls, service };
}

test("inferenceListParam preserves aliases, comma splitting, arrays, and all filtering", () => {
  const { service } = createFixture();

  assert.deepEqual(service.inferenceListParam({ scenes: " night, day ,," }, "scenes", "scene"), ["night", "day"]);
  assert.deepEqual(service.inferenceListParam({ scenes: "all", scene: [" front ", "", 7] }, "scenes", "scene"), ["front", "7"]);
  assert.deepEqual(service.inferenceListParam({ scene: "all" }, "scenes", "scene"), []);
});

test("linkOrCopyFile preserves hard-link, symlink, copy fallback, and copy-only behavior", () => {
  const { calls, service } = createFixture({
    fsOverrides: {
      linkSync: (...args) => {
        calls.links.push(args);
        throw new Error("hard links unavailable");
      },
      symlinkSync: (...args) => {
        calls.symlinks.push(args);
        throw new Error("symlinks unavailable");
      },
    },
  });

  service.linkOrCopyFile("/cache/source.jpg", "/job/images/one.jpg");
  service.linkOrCopyFile("/cache/source.jpg", "/job/images/two.jpg", true);

  assert.deepEqual(calls.mkdir, [
    ["/job/images", { recursive: true }],
    ["/job/images", { recursive: true }],
  ]);
  assert.deepEqual(calls.remove, [
    ["/job/images/one.jpg", { force: true }],
    ["/job/images/two.jpg", { force: true }],
  ]);
  assert.deepEqual(calls.links, [["/cache/source.jpg", "/job/images/one.jpg"]]);
  assert.deepEqual(calls.symlinks, [["../../cache/source.jpg", "/job/images/one.jpg"]]);
  assert.deepEqual(calls.copies, [
    ["/cache/source.jpg", "/job/images/one.jpg"],
    ["/cache/source.jpg", "/job/images/two.jpg"],
  ]);
});

test("ensureImageAssetCache downloads only missing assets and preserves extension precedence", async () => {
  const existing = new Set(["/storage/runtime/cache/assets/images/asset-existing.png"]);
  const { calls, service } = createFixture({
    fsOverrides: { existsSync: (target) => existing.has(target) },
  });

  assert.equal(await service.ensureImageAssetCache({
    image_asset_id: "asset-existing",
    original_ext: ".png",
    object_key: "images/existing.jpg",
  }), "/storage/runtime/cache/assets/images/asset-existing.png");
  assert.equal(await service.ensureImageAssetCache({
    image_asset_id: "asset-missing",
    original_ext: "",
    object_key: "images/missing.webp",
  }), "/storage/runtime/cache/assets/images/asset-missing.webp");

  assert.deepEqual(calls.objectWrites, [[
    "images/missing.webp",
    "/storage/runtime/cache/assets/images/asset-missing.webp",
  ]]);
});

test("prepareInferenceInputCache preserves filters, job-copy cache, manifests, and pending update", async () => {
  const row = {
    project_image_id: "image-1",
    project_id: "project-1",
    image_asset_id: "asset-1",
    import_batch_id: "batch-1",
    display_name: "camera.jpg",
    scene: "night",
    view: "front",
    modality: "rgb",
    keyword: "road",
    object_key: "objects/asset-1.jpg",
    original_ext: ".jpg",
    width: 1920,
    height: 1080,
    file_size: 1234,
  };
  const { calls, service } = createFixture({
    rows: [row],
    fsOverrides: { existsSync: () => false },
  });
  const job = {
    id: "job-1",
    dataset_project_id: "project-1",
    output_root: "/jobs/job-1",
    params_json: JSON.stringify({
      confidence: 0.4,
      input: {
        sourceType: "project_images",
        cachePolicy: "job_copy",
        limit: 2,
        filters: {
          scenes: "night,day",
          views: ["front"],
          modalities: "rgb",
          importBatchIds: "batch-1",
          q: " needle ",
          labels: "car",
        },
      },
    }),
  };

  const manifest = await service.prepareInferenceInputCache(job);

  const select = calls.queries[0];
  assert.match(select.sql, /pi\.scene = ANY\(\$2\)/);
  assert.match(select.sql, /pi\.view = ANY\(\$3\)/);
  assert.match(select.sql, /pi\.modality = ANY\(\$4\)/);
  assert.match(select.sql, /pi\.import_batch_id = ANY\(\$5::uuid\[\]\)/);
  assert.match(select.sql, /pi\.display_name ILIKE \$6/);
  assert.match(select.sql, /a\.label = ANY\(\$7\)/);
  assert.match(select.sql, /LIMIT \$8/);
  assert.deepEqual(select.params, [
    "project-1",
    ["night", "day"],
    ["front"],
    ["rgb"],
    ["batch-1"],
    "%needle%",
    ["car"],
    2,
  ]);
  assert.deepEqual(calls.objectWrites, [[
    "objects/asset-1.jpg",
    "/storage/runtime/cache/assets/images/asset-1.jpg",
  ]]);
  assert.deepEqual(calls.copies, [[
    "/storage/runtime/cache/assets/images/asset-1.jpg",
    "/jobs/job-1/input-cache/images/00000001.jpg",
  ]]);
  assert.equal(manifest.imageCount, 1);
  assert.equal(manifest.images[0].localPath, "images/00000001.jpg");

  const written = Object.fromEntries(calls.writes.map(([file, content]) => [path.basename(file), JSON.parse(content)]));
  assert.equal(written["manifest.json"].images[0].projectImageId, "image-1");
  assert.deepEqual(written["dataset_meta.json"], {
    projectId: "project-1",
    imageCount: 1,
    modalities: ["rgb"],
    scenes: ["night"],
    views: ["front"],
  });
  assert.equal(written["source_filters.json"].cachePolicy, "job_copy");

  const update = calls.queries[1];
  assert.equal(update.sql, "UPDATE runtime_inference_jobs SET status='pending', progress=5, params_json=$1, message=$2 WHERE id=$3");
  assert.equal(update.params[1], "推理输入缓存已准备：1 张图片");
  assert.equal(update.params[2], "job-1");
  const nextParams = JSON.parse(update.params[0]);
  assert.equal(nextParams.confidence, 0.4);
  assert.equal(nextParams.input.manifestPath, "/jobs/job-1/input-cache/manifest.json");
  assert.equal(nextParams.input.imageCount, 1);
});

test("prepareInferenceInputCache rejects an empty selection before writing cache files", async () => {
  const { calls, service } = createFixture();

  await assert.rejects(
    () => service.prepareInferenceInputCache({ id: "job-empty", dataset_project_id: "project-1", params_json: {} }),
    { message: "推理输入范围内没有可用图片" },
  );
  assert.equal(calls.queries.length, 1);
  assert.deepEqual(calls.writes, []);
});
