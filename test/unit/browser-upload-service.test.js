"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const { createBrowserUploadService } = require("../../server/dataset/browser-upload-service");

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

test("browser upload preserves nested paths and completes through the import service", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "det-browser-upload-"));
  const calls = [];
  const service = createBrowserUploadService({
    fs,
    path,
    crypto,
    dataRoot,
    httpError,
    importService: {
      async importPath(body, actor) {
        calls.push({ body, actor });
        return { batch: { id: "batch-1", status: "pending" } };
      },
    },
  });
  const actor = { id: "user-1" };
  const session = service.createSession({ rootName: "ZRC", fileCount: 2, totalBytes: 7 }, actor);
  await service.receiveFile(Readable.from(Buffer.from("abc")), "images/a.jpg", session);
  await service.receiveFile(Readable.from(Buffer.from("json")), "jsons/a.json", session);
  const result = await service.completeSession(session.id, { projectId: "project-1" }, actor);

  assert.equal(fs.readFileSync(path.join(session.targetRoot, "images", "a.jpg"), "utf8"), "abc");
  assert.equal(fs.readFileSync(path.join(session.targetRoot, "jsons", "a.json"), "utf8"), "json");
  assert.equal(calls[0].body.projectId, "project-1");
  assert.deepEqual(calls[0].body.sourcePaths, [session.targetRoot]);
  assert.equal(result.upload.files, 2);
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test("browser upload rejects traversal and incomplete sessions", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "det-browser-upload-"));
  const service = createBrowserUploadService({
    fs,
    path,
    crypto,
    dataRoot,
    httpError,
    importService: { importPath: async () => ({}) },
  });
  const actor = { id: "user-1" };
  const session = service.createSession({ rootName: "ZRC", fileCount: 1 }, actor);
  assert.throws(() => service.receiveFile(Readable.from(Buffer.from("x")), "../escape.txt", session), /路径无效/);
  await assert.rejects(service.completeSession(session.id, { projectId: "project-1" }, actor), /上传不完整/);
  fs.rmSync(dataRoot, { recursive: true, force: true });
});
