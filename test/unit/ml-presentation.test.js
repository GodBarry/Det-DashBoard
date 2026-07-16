const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const sourcePath = path.resolve(__dirname, "../../src/features/platform/mlPresentation.js");
const sharedUrl = pathToFileURL(path.resolve(__dirname, "../../src/shared/presentation.js")).href;
const source = fs.readFileSync(sourcePath, "utf8")
  .replace("../../shared/presentation.js", sharedUrl);
const presentationPromise = import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

test("model family labels preserve detector naming rules and defaults", async () => {
  const { modelFamilyLabel } = await presentationPromise;

  assert.equal(modelFamilyLabel(" YOLO11n "), "YOLOv11");
  assert.equal(modelFamilyLabel("rt_detr"), "RT-DETR");
  assert.equal(modelFamilyLabel("PP YOLOE"), "PP-YOLOE");
  assert.equal(modelFamilyLabel("custom"), "custom");
  assert.equal(modelFamilyLabel(), "未命名模型簇");
});

test("environment and version tooltips preserve display text and fallbacks", async () => {
  const { envTooltip, versionTooltip } = await presentationPromise;

  assert.equal(envTooltip({ name: "GPU", python_version: "3.12", torch_version: "2.8", cuda_available: true, cuda_version: "12.8" }), [
    "环境：GPU",
    "创建时间：--",
    "Python：3.12",
    "Torch：2.8",
    "加速：CUDA 12.8",
  ].join("\n"));
  assert.equal(envTooltip(), [
    "环境：未命名环境",
    "创建时间：--",
    "Python：未检测",
    "Torch：未检测",
    "加速：CPU",
  ].join("\n"));
  assert.match(versionTooltip({ version_name: "best_epoch-9", params_json: "{}", training_job_id: "job-1" }), /训练轮次：9/);
  assert.match(versionTooltip({ params_json: "{\"epoch\":12}" }), /训练轮次：12/);
  assert.match(versionTooltip(), /来源任务：手动登记\/预训练/);
});

test("best asset link filters, ranks by successes, and breaks ties by time", async () => {
  const { bestAssetLink } = await presentationPromise;
  const links = [
    { id: "other", algorithm_asset_id: "b", success_count: 20, last_success_at: "2026-01-01" },
    { id: "older", algorithm_asset_id: "a", success_count: 3, last_success_at: "2026-01-01" },
    { id: "newer", algorithm_asset_id: "a", success_count: 3, last_success_at: "2026-02-01" },
  ];

  assert.equal(bestAssetLink(links, "a").id, "newer");
  assert.equal(bestAssetLink(links).id, "other");
  assert.equal(bestAssetLink([], "a"), null);
  assert.deepEqual(links.map(({ id }) => id), ["other", "older", "newer"]);
});

test("project tree rows flatten three levels and retain child metadata", async () => {
  const { projectTreeRows } = await presentationPromise;
  const rows = projectTreeRows([
    { id: "root" },
    { id: "child", parent_id: "root" },
    { id: "grandchild", parent_id: "child" },
    { id: "great-grandchild", parent_id: "grandchild" },
  ]);

  assert.deepEqual(rows.map(({ id, depth, hasChildren }) => ({ id, depth, hasChildren })), [
    { id: "root", depth: 0, hasChildren: true },
    { id: "child", depth: 1, hasChildren: true },
    { id: "grandchild", depth: 2, hasChildren: true },
  ]);
});

test("prediction legend reads object and string labels with a default", async () => {
  const { predictionLegend } = await presentationPromise;

  assert.deepEqual(predictionLegend([
    { predictions_json: [{ label: "car" }, "label=person; score=0.8", { label: "car" }] },
    { predictions_json: JSON.stringify([{ label: "bike" }]) },
  ]), ["car", "person", "bike"]);
  assert.deepEqual(predictionLegend(), ["目标"]);
});

test("prediction box style supports pixel and normalized coordinates", async () => {
  const { predictionBoxStyle } = await presentationPromise;

  assert.deepEqual(predictionBoxStyle(
    { bbox_x: 20, bbox_y: 10, bbox_w: 50, bbox_h: 30 },
    { image_width: 100, image_height: 50 },
  ), { left: "20%", top: "20%", width: "50%", height: "60%" });
  assert.deepEqual(predictionBoxStyle(
    { x: 0.2, y: 0.1, width: 0.5, height: 0.3 },
    {},
  ), { left: "20%", top: "10%", width: "50%", height: "30%" });
  assert.equal(predictionBoxStyle({ width: 0, height: 1 }, {}), null);
});

test("prediction colors remain deterministic and use the shared palette", async () => {
  const { predictionColor } = await presentationPromise;

  assert.equal(predictionColor(), "#31d0aa");
  assert.equal(predictionColor("car"), predictionColor("car"));
  assert.match(predictionColor("person"), /^#[0-9a-f]{6}$/i);
});

test("prediction items preserve arrays and parse supported containers", async () => {
  const { predictionItems } = await presentationPromise;
  const items = [{ label: "car" }];

  assert.equal(predictionItems(items), items);
  assert.deepEqual(predictionItems(JSON.stringify(items)), items);
  assert.deepEqual(predictionItems({ predictions: items }), items);
  assert.deepEqual(predictionItems("bad json"), []);
  assert.deepEqual(predictionItems(), []);
});

test("JSON parsing preserves objects and defaults invalid values", async () => {
  const { parseMaybeJson } = await presentationPromise;
  const value = { epoch: 5 };

  assert.equal(parseMaybeJson(value), value);
  assert.deepEqual(parseMaybeJson("{\"epoch\":5}"), value);
  assert.deepEqual(parseMaybeJson("bad json"), {});
  assert.deepEqual(parseMaybeJson(), {});
});

test("metric helpers select the first present value and preserve formatting", async () => {
  const { metricValue, formatMetric } = await presentationPromise;

  assert.equal(metricValue({ empty: "", zero: 0, later: 4 }, ["missing", "empty", "zero", "later"]), 0);
  assert.equal(metricValue({}, ["missing"]), null);
  assert.equal(formatMetric(), "--");
  assert.equal(formatMetric("not-a-number"), "not-a-number");
  assert.equal(formatMetric(0), "0.00%");
  assert.equal(formatMetric(0.12345), "12.35%");
  assert.equal(formatMetric(2), "2.00");
});
