"use strict";

function createBrowserUploadService(options = {}) {
  const {
    fs,
    path,
    crypto,
    dataRoot,
    storageRoot,
    importService,
    httpError,
  } = options;
  const uploadRoot = path.join(storageRoot || dataRoot, "browser-imports");
  const sessions = new Map();

  function cleanSegment(value, fallback = "dataset") {
    const cleaned = String(value || "")
      .normalize("NFC")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/^\.+|\.+$/g, "")
      .trim();
    return cleaned || fallback;
  }

  function normalizeRelativePath(value) {
    const parts = String(value || "")
      .replace(/\\/g, "/")
      .split("/")
      .filter((part) => part && part !== ".");
    if (!parts.length || parts.some((part) => part === "..")) throw httpError(400, "上传文件路径无效");
    return parts.map((part) => cleanSegment(part, "file")).join("/");
  }

  function sessionFor(id, actor) {
    const session = sessions.get(String(id));
    if (!session || session.actorId !== String(actor.id)) throw httpError(404, "上传会话不存在或已失效");
    return session;
  }

  function createSession(body, actor) {
    const id = crypto.randomUUID();
    const rootName = cleanSegment(body.rootName, "dataset");
    const targetRoot = path.join(uploadRoot, String(actor.id), `${Date.now()}-${id}`, rootName);
    fs.mkdirSync(targetRoot, { recursive: true });
    const session = {
      id,
      actorId: String(actor.id),
      rootName,
      targetRoot,
      expectedFiles: Math.max(0, Number(body.fileCount) || 0),
      expectedBytes: Math.max(0, Number(body.totalBytes) || 0),
      uploadedFiles: 0,
      uploadedBytes: 0,
      createdAt: Date.now(),
    };
    sessions.set(id, session);
    return session;
  }

  function receiveFile(req, relativePath, session) {
    const safeRelativePath = normalizeRelativePath(relativePath);
    const target = path.resolve(session.targetRoot, safeRelativePath);
    const relative = path.relative(session.targetRoot, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw httpError(400, "上传文件超出目标目录");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.uploading-${crypto.randomUUID()}`;

    return new Promise((resolve, reject) => {
      let bytes = 0;
      let settled = false;
      const output = fs.createWriteStream(temporary, { flags: "wx" });
      const finishError = (error) => {
        if (settled) return;
        settled = true;
        output.destroy();
        fs.rm(temporary, { force: true }, () => reject(error));
      };
      req.on("data", (chunk) => { bytes += chunk.length; });
      req.on("aborted", () => finishError(httpError(499, "浏览器中止了文件上传")));
      req.on("error", finishError);
      output.on("error", finishError);
      output.on("finish", () => {
        if (settled) return;
        settled = true;
        fs.renameSync(temporary, target);
        session.uploadedFiles += 1;
        session.uploadedBytes += bytes;
        resolve({
          path: safeRelativePath,
          uploadedFiles: session.uploadedFiles,
          uploadedBytes: session.uploadedBytes,
        });
      });
      req.pipe(output);
    });
  }

  async function completeSession(id, body, actor) {
    const session = sessionFor(id, actor);
    if (session.expectedFiles && session.uploadedFiles !== session.expectedFiles) {
      throw httpError(409, `文件上传不完整：已上传 ${session.uploadedFiles} / ${session.expectedFiles}`);
    }
    const result = await importService.importPath({
      ...body,
      sourcePath: session.targetRoot,
      sourcePaths: [session.targetRoot],
    }, actor);
    sessions.delete(session.id);
    return { ...result, upload: { rootName: session.rootName, files: session.uploadedFiles, bytes: session.uploadedBytes } };
  }

  function cancelSession(id, actor) {
    const session = sessionFor(id, actor);
    sessions.delete(session.id);
    fs.rmSync(path.dirname(session.targetRoot), { recursive: true, force: true });
    return { ok: true };
  }

  return {
    createSession,
    sessionFor,
    receiveFile,
    completeSession,
    cancelSession,
  };
}

module.exports = { createBrowserUploadService };
