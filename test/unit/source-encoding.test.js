const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { TextDecoder } = require("node:util");

const repositoryRoot = path.resolve(__dirname, "..", "..");
const sourceRoots = ["server", "src"];
const sourceExtensions = new Set([".js", ".jsx", ".json"]);

function collectSourceFiles(relativeDirectory) {
  const directory = path.join(repositoryRoot, relativeDirectory);
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(relativePath);
    return sourceExtensions.has(path.extname(entry.name)) ? [relativePath] : [];
  });
}

test("source files remain valid UTF-8 without replacement characters or conflict markers", () => {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const failures = [];

  for (const relativePath of sourceRoots.flatMap(collectSourceFiles)) {
    const bytes = fs.readFileSync(path.join(repositoryRoot, relativePath));
    try {
      const source = decoder.decode(bytes);
      if (source.includes("\uFFFD")) failures.push(`${relativePath}: replacement character`);
      if (/^(<<<<<<<|=======|>>>>>>>)/m.test(source)) failures.push(`${relativePath}: merge conflict marker`);
    } catch (error) {
      failures.push(`${relativePath}: ${error.message}`);
    }
  }

  assert.deepEqual(failures, []);
});
