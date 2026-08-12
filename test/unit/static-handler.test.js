const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createStaticHandler } = require("../../server/static-handler");

function responseCapture() {
  return {
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; },
  };
}

test("missing versioned assets return 404 instead of the SPA document", () => {
  const distRoot = fs.mkdtempSync(path.join(os.tmpdir(), "det-static-"));
  fs.writeFileSync(path.join(distRoot, "index.html"), "<div id=\"root\"></div>");
  const errors = [];
  const handler = createStaticHandler({
    distRoot,
    sendError(res, status, message) {
      errors.push({ status, message });
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    },
  });
  const response = responseCapture();

  assert.equal(handler.handle({ method: "GET", url: "/assets/old.js" }, response, { pathname: "/assets/old.js" }), true);
  assert.deepEqual(errors, [{ status: 404, message: "static asset not found" }]);
  assert.equal(response.status, 404);
  assert.doesNotMatch(String(response.body), /root/);
});

test("application routes still use the SPA fallback", () => {
  const distRoot = fs.mkdtempSync(path.join(os.tmpdir(), "det-static-"));
  fs.writeFileSync(path.join(distRoot, "index.html"), "<div id=\"root\"></div>");
  const handler = createStaticHandler({ distRoot, sendError() {} });
  const response = responseCapture();

  assert.equal(handler.handle({ method: "GET", url: "/evaluation" }, response, { pathname: "/evaluation" }), true);
  assert.equal(response.status, 200);
  assert.match(String(response.body), /root/);
  assert.equal(response.headers["cache-control"], "no-store");
});
