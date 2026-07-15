const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { createSettingsService } = require("../../server/settings-service");

function createFixture(rows = []) {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql === "SELECT key, value_json FROM app_settings") return { rows };
    return { rows: [] };
  };
  const service = createSettingsService({
    query,
    path,
    databaseUrl: "postgres://det:secret@db:5432/dashboard",
    dataRoot: "E:\\runtime\\data",
    dataRootDisplay: "F:\\datasets",
    browseRoot: "E:\\runtime\\browse",
    browseRootDisplay: "F:\\browse",
    exportRootDisplay: "F:\\exports",
    minio: {
      endPoint: "minio",
      port: 9000,
      bucket: "det-assets",
      dataDir: "E:\\runtime\\minio",
    },
  });
  return { calls, service };
}

test("defaultSettings preserves field names, paths, and masked database URL", () => {
  const { service } = createFixture();

  assert.deepEqual(service.defaultSettings(), {
    postgres: "postgres://det:****@db:5432/dashboard",
    dataStorage: "F:\\datasets",
    browseRoot: "F:\\browse",
    minioStorage: "minio:9000 / det-assets",
    minioDataDir: "E:\\runtime\\minio",
    pythonAssets: "D:\\Program Files\\miniforge3",
    algorithmAssets: path.join("E:\\runtime\\minio", "det-assets", "code-assets", "algorithms"),
    exportRoot: "F:\\exports",
  });
});

test("getAppSettings merges wrapped and raw JSON values over defaults", async () => {
  const rawValue = { nested: true };
  const { calls, service } = createFixture([
    { key: "dataStorage", value_json: { value: "G:\\data" } },
    { key: "custom", value_json: rawValue },
  ]);

  const settings = await service.getAppSettings();

  assert.equal(settings.dataStorage, "G:\\data");
  assert.equal(settings.custom, rawValue);
  assert.deepEqual(calls, [{ sql: "SELECT key, value_json FROM app_settings", params: undefined }]);
});

test("saveAppSettings persists only allowed fields with the existing JSON envelope", async () => {
  const { calls, service } = createFixture();
  const allowedSettings = {
    postgres: "postgres://new",
    dataStorage: "G:\\data",
    browseRoot: "G:\\browse",
    minioStorage: "storage:9000 / assets",
    minioDataDir: 0,
    pythonAssets: "G:\\python",
    algorithmAssets: "G:\\algorithms",
    exportRoot: "G:\\exports",
  };

  const settings = await service.saveAppSettings({
    settings: {
      ...allowedSettings,
      unknown: "ignored",
    },
  });

  const writes = calls.slice(0, -1);
  assert.equal(writes.length, 8);
  assert.deepEqual(writes.map((call) => call.params[0]), Object.keys(allowedSettings));
  for (const [index, [key, value]] of Object.entries(allowedSettings).entries()) {
    assert.match(writes[index].sql, /^INSERT INTO app_settings/);
    assert.deepEqual(writes[index].params, [key, JSON.stringify({ value: String(value || "") })]);
  }
  assert.deepEqual(calls.at(-1), { sql: "SELECT key, value_json FROM app_settings", params: undefined });
  assert.equal(settings.postgres, "postgres://det:****@db:5432/dashboard");
});
