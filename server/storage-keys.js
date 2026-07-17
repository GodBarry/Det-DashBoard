const path = require("path");
const { cleanName } = require("./utils");

function imageObjectKey(sha256, ext) {
  return `objects/images/sha256/${sha256.slice(0, 2)}/${sha256}${ext}`;
}

function videoObjectKey(sha256, ext) {
  return `objects/videos/sha256/${sha256.slice(0, 2)}/${sha256}${ext}`;
}

function rawLabelObjectKey(projectId, versionId, name) {
  return `objects/raw-labels/${projectId}/${versionId}/${name}`;
}

function pythonEnvObjectKey(sha256, name) {
  const safeName = path.basename(name || `${sha256}.tar.gz`).replace(/[\\/:*?"<>|]/g, "_");
  return `envs/python/conda-pack/${sha256.slice(0, 2)}/${sha256}/${safeName}`;
}

function pythonEnvManifestKey(sha256) {
  return `envs/python/conda-pack/${sha256.slice(0, 2)}/${sha256}/manifest.json`;
}

function modelWeightManifestKey(modelId, versionId) {
  return `ml/artifacts/models/${modelId}/${versionId}/manifest.json`;
}

function serverPythonEnvObjectKey(sha256) {
  return `envs/python/server-python/${sha256.slice(0, 2)}/${sha256}/metadata.json`;
}

function algorithmAssetPrefix(algorithmKey, version = "builtin") {
  const safeKey = cleanName(algorithmKey || "custom_algorithm", "algorithm").toLowerCase();
  const safeVersion = cleanName(version || "builtin", "version").toLowerCase();
  return `code-assets/algorithms/${safeKey}/${safeVersion}`;
}

function algorithmManifestKey(algorithmKey, version = "builtin") {
  return `${algorithmAssetPrefix(algorithmKey, version)}/manifest.json`;
}

function algorithmAdapterKey(algorithmKey, version = "builtin") {
  return `${algorithmAssetPrefix(algorithmKey, version)}/adapter.py`;
}

module.exports = {
  imageObjectKey,
  videoObjectKey,
  rawLabelObjectKey,
  pythonEnvObjectKey,
  pythonEnvManifestKey,
  modelWeightManifestKey,
  serverPythonEnvObjectKey,
  algorithmAssetPrefix,
  algorithmManifestKey,
  algorithmAdapterKey,
};
