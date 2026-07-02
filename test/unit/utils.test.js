const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const { inferSceneFromPath, inferSceneFromImportRoot, walkAsync } = require("../../server/utils");

const roots = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "det-utils-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
});

test("infers nearest semantic scene and respects explicit metadata", () => {
  const root = fixture();
  const file = path.join(root, "mountain", "2026-07-02", "images", "train", "one.jpg");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "");
  assert.equal(inferSceneFromPath({}, file, root), "2026-07-02");
  assert.equal(inferSceneFromPath({ scene: "json-scene" }, file, root), "json-scene");
});

test("backfills only an unambiguous single scene root", async () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, "scene-a", "images"), { recursive: true });
  fs.writeFileSync(path.join(root, "scene-a", "images", "one.jpg"), "");
  assert.equal(await inferSceneFromImportRoot(root), "scene-a");
  fs.mkdirSync(path.join(root, "scene-b", "images"), { recursive: true });
  assert.equal(await inferSceneFromImportRoot(root), "");
});

test("walkAsync scans files and supports cooperative cancellation", async () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, "a", "b"), { recursive: true });
  fs.writeFileSync(path.join(root, "a", "one.jpg"), "");
  fs.writeFileSync(path.join(root, "a", "b", "two.json"), "{}");
  const files = await walkAsync(root);
  assert.equal(files.length, 2);
  await assert.rejects(() => walkAsync(root, { shouldStop: async () => true }), { code: "SCAN_CANCELLED" });
});
