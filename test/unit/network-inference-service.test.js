"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { decodeImageRequest } = require("../../server/runtime-jobs/network-inference-service");

test("network inference accepts Response-style JSON base64 metadata", () => {
  const image = Buffer.from("image-bytes");
  const decoded = decodeImageRequest(Buffer.from(JSON.stringify({
    sessionId: "session-1",
    projectImageId: "image-1",
    filename: "sample.jpg",
    imageBase64: image.toString("base64"),
  })), "application/json", {});

  assert.deepEqual(decoded.bytes, image);
  assert.equal(decoded.filename, "sample.jpg");
  assert.equal(decoded.sessionId, "session-1");
  assert.equal(decoded.projectImageId, "image-1");
});

test("network inference accepts raw image requests with compatibility headers", () => {
  const image = Buffer.from("raw-image");
  const decoded = decodeImageRequest(image, "image/png", {
    "x-filename": "camera.png",
    "x-session-id": "remote-session",
    "x-project-image-id": "remote-image",
  });

  assert.deepEqual(decoded.bytes, image);
  assert.equal(decoded.filename, "camera.png");
  assert.equal(decoded.sessionId, "remote-session");
  assert.equal(decoded.projectImageId, "remote-image");
});
