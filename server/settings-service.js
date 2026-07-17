"use strict";

const SETTING_FIELDS = new Set([
  "postgres",
  "dataStorage",
  "browseRoot",
  "minioStorage",
  "minioDataDir",
  "pythonAssets",
  "algorithmAssets",
  "exportRoot",
]);

function createSettingsService({
  query,
  path,
  databaseUrl,
  dataRoot,
  dataRootDisplay,
  browseRoot,
  browseRootDisplay,
  exportRootDisplay,
  minio,
}) {
  if (typeof query !== "function") throw new TypeError("createSettingsService requires query");
  if (!path || typeof path.join !== "function") throw new TypeError("createSettingsService requires path");

  function defaultSettings() {
    return {
      postgres: databaseUrl.replace(/:[^:@/]+@/, ":****@"),
      dataStorage: dataRootDisplay || dataRoot,
      browseRoot: browseRootDisplay || browseRoot,
      minioStorage: `${minio.endPoint}:${minio.port} / ${minio.bucket}`,
      minioDataDir: minio.dataDir,
      pythonAssets: "D:\\Program Files\\miniforge3",
      algorithmAssets: path.join(minio.dataDir, minio.bucket, "code-assets", "algorithms"),
      exportRoot: exportRootDisplay,
    };
  }

  async function getAppSettings() {
    const rows = (await query("SELECT key, value_json FROM app_settings")).rows;
    const settings = defaultSettings();
    for (const row of rows) settings[row.key] = row.value_json?.value ?? row.value_json;
    return settings;
  }

  async function saveAppSettings(body = {}) {
    const entries = Object.entries(body.settings || body).filter(([key]) => SETTING_FIELDS.has(key));
    for (const [key, value] of entries) {
      await query(
        `INSERT INTO app_settings (key, value_json, updated_at) VALUES ($1,$2,now())
         ON CONFLICT (key) DO UPDATE SET value_json=EXCLUDED.value_json, updated_at=now()`,
        [key, JSON.stringify({ value: String(value || "") })],
      );
    }
    return getAppSettings();
  }

  return Object.freeze({
    defaultSettings,
    getAppSettings,
    saveAppSettings,
  });
}

module.exports = {
  createSettingsService,
};
