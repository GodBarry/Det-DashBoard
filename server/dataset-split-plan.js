const fs = require("fs");
const path = require("path");
const YAML = require("yaml");
const { IMAGE_EXTS, walk } = require("./utils");
const { imageKey } = require("./dataset-formats");

function splitName(value) {
  const match = String(value || "").toLowerCase().match(/(?:^|[\\/_\-.])(train(?:ing)?|val(?:id|idation)?|test)\d*(?:[\\/_\-.]|$)/);
  if (!match) return "";
  if (match[1] === "training") return "train";
  if (match[1] === "valid" || match[1] === "validation") return "val";
  return match[1];
}

function addSplitReference(plan, split, reference, baseDir, sourceRoot) {
  if (!plan[split] || !reference) return;
  const raw = String(reference).trim().replace(/^['"]|['"]$/g, "");
  if (!raw || /^https?:\/\//i.test(raw)) return;
  const candidates = [path.resolve(baseDir, raw), path.resolve(sourceRoot, raw)];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const stat = fs.statSync(candidate);
    if (stat.isDirectory()) plan[split].directories.add(path.resolve(candidate));
    else if (IMAGE_EXTS.has(path.extname(candidate).toLowerCase())) plan[split].files.add(imageKey(candidate));
    else if (/\.txt$/i.test(candidate)) {
      const lines = fs.readFileSync(candidate, "utf8").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
      for (const line of lines) addSplitReference(plan, split, line, path.dirname(candidate), sourceRoot);
      plan[split].manifests.add(candidate);
    }
    break;
  }
}

function discoverDatasetSplitPlan(sourceGroups) {
  const plan = Object.fromEntries(["train", "val", "test"].map((name) => [name, { files: new Set(), directories: new Set(), manifests: new Set() }]));
  for (const group of sourceGroups) {
    const yamlFiles = group.files.filter((file) => /(^|[\\/])(data|dataset)\.ya?ml$/i.test(file));
    for (const yamlFile of yamlFiles) {
      try {
        const document = YAML.parse(fs.readFileSync(yamlFile, "utf8")) || {};
        const datasetRoot = document.path ? path.resolve(path.dirname(yamlFile), String(document.path)) : group.sourceRoot;
        for (const split of ["train", "val", "test"]) {
          const references = Array.isArray(document[split]) ? document[split] : [document[split]];
          for (const reference of references) addSplitReference(plan, split, reference, datasetRoot, group.sourceRoot);
          if (document[split]) plan[split].manifests.add(yamlFile);
        }
      } catch {}
    }
    for (const textFile of group.files.filter((file) => /(^|[\\/])(train|val|test)\.txt$/i.test(file))) {
      const split = path.basename(textFile, path.extname(textFile)).toLowerCase();
      addSplitReference(plan, split, textFile, path.dirname(textFile), group.sourceRoot);
    }
    for (const jsonFile of group.files.filter((file) => /\.json$/i.test(file))) {
      const split = splitName(path.relative(group.sourceRoot, jsonFile));
      if (!split) continue;
      try {
        const document = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
        if (!Array.isArray(document.images) || !Array.isArray(document.annotations)) continue;
        const groupImages = group.images || group.files.filter((file) => IMAGE_EXTS.has(path.extname(file).toLowerCase()));
        for (const image of document.images) {
          const reference = String(image.file_name || "").replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
          const matches = groupImages.filter((file) => {
            const relative = path.relative(group.sourceRoot, file).replace(/\\/g, "/").toLowerCase();
            return relative === reference || relative.endsWith(`/${reference}`) || path.basename(relative) === path.basename(reference);
          });
          if (matches.length === 1) plan[split].files.add(imageKey(matches[0]));
          else addSplitReference(plan, split, image.file_name, path.dirname(jsonFile), group.sourceRoot);
        }
        plan[split].manifests.add(jsonFile);
      } catch {}
    }
  }
  const active = Object.entries(plan).filter(([, entry]) => entry.files.size || entry.directories.size);
  return active.length ? plan : null;
}

function splitForImage(file, splitPlan) {
  if (!splitPlan) return "";
  const resolved = path.resolve(file);
  const key = imageKey(resolved);
  for (const split of ["train", "val", "test"]) {
    const entry = splitPlan[split];
    if (entry.files.has(key)) return split;
    if ([...entry.directories].some((directory) => resolved === directory || resolved.startsWith(`${directory}${path.sep}`))) return split;
  }
  return "";
}

function serializeSplitPlan(splitPlan, projectIds = {}, toDisplayPath = (value) => value) {
  if (!splitPlan) return { detected: false, splits: {} };
  const splits = {};
  for (const split of ["train", "val", "test"]) {
    const entry = splitPlan[split];
    if (!entry.files.size && !entry.directories.size) continue;
    const listedImageKeys = new Set(entry.files);
    for (const directory of entry.directories) {
      if (!fs.existsSync(directory)) continue;
      for (const file of walk(directory)) {
        if (fs.statSync(file).isFile() && IMAGE_EXTS.has(path.extname(file).toLowerCase())) listedImageKeys.add(imageKey(file));
      }
    }
    splits[split] = {
      projectId: projectIds[split] || null,
      listedImages: listedImageKeys.size,
      sourceDirectories: entry.directories.size,
      manifests: [...entry.manifests].map(toDisplayPath),
    };
  }
  return { detected: Object.keys(splits).length > 0, splits };
}

module.exports = { splitName, addSplitReference, discoverDatasetSplitPlan, splitForImage, serializeSplitPlan };
