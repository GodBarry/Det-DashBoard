const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const { port } = require("./config");
const { query } = require("./db");
const store = require("./object-store");

function sendJson(res, data, code = 200) {
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(data));
}

function sendError(res, code, message) {
  sendJson(res, { error: message }, code);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

async function ensureRuntimeSchema() {
  const statements = [
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ",
    "ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ",
    "ALTER TABLE project_images ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ",
    "ALTER TABLE project_videos ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ",
    "ALTER TABLE label_versions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ",
  ];
  for (const sql of statements) await query(sql);
}

async function listProjects(trash = false) {
  const result = await query(
    `SELECT p.*,
      (SELECT count(*)::int FROM project_images pi WHERE pi.project_id=p.id AND pi.deleted_at IS NULL) AS image_count,
      (SELECT count(*)::int FROM project_videos pv WHERE pv.project_id=p.id AND pv.deleted_at IS NULL) AS video_count,
      (SELECT max(created_at) FROM import_batches ib WHERE ib.project_id=p.id) AS last_import_at
     FROM projects p
     WHERE ${trash ? "p.deleted_at IS NOT NULL" : "p.deleted_at IS NULL"}
     ORDER BY p.created_at DESC`,
  );
  return result.rows;
}

async function createProject(body) {
  const name = String(body.name || "").trim() || `project_${Date.now()}`;
  const result = await query(
    "INSERT INTO projects (name, description) VALUES ($1,$2) RETURNING *",
    [name, body.description || ""],
  );
  return result.rows[0];
}

function serveStatic(reqPath, res) {
  const dist = path.join(__dirname, "..", "dist");
  let filePath = path.join(dist, reqPath === "/" ? "index.html" : reqPath);
  if (!path.resolve(filePath).startsWith(path.resolve(dist))) {
    sendError(res, 403, "forbidden");
    return true;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    filePath = path.join(dist, "index.html");
  }
  if (!fs.existsSync(filePath)) return false;
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".json": "application/json; charset=utf-8",
  };
  res.writeHead(200, {
    "content-type": mimeTypes[ext] || "application/octet-stream",
    "cache-control": ext === ".html" ? "no-store" : "public, max-age=3600",
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

async function route(req, res) {
  const parsed = url.parse(req.url, true);
  const method = req.method;

  if (method === "GET" && parsed.pathname === "/api/projects") {
    return sendJson(res, { projects: await listProjects(false) });
  }
  if (method === "GET" && parsed.pathname === "/api/projects/trash") {
    return sendJson(res, { projects: await listProjects(true) });
  }
  if (method === "POST" && parsed.pathname === "/api/projects") {
    return sendJson(res, { project: await createProject(await readBody(req)) });
  }

  const deleteProject = parsed.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (method === "DELETE" && deleteProject) {
    await query("UPDATE projects SET deleted_at=now() WHERE id=$1", [deleteProject[1]]);
    return sendJson(res, { ok: true });
  }
  const restoreProject = parsed.pathname.match(/^\/api\/projects\/([^/]+)\/restore$/);
  if (method === "POST" && restoreProject) {
    await query("UPDATE projects SET deleted_at=NULL WHERE id=$1", [restoreProject[1]]);
    return sendJson(res, { ok: true });
  }

  const imports = parsed.pathname.match(/^\/api\/projects\/([^/]+)\/imports$/);
  if (method === "GET" && imports) return sendJson(res, { imports: [] });
  const imageList = parsed.pathname.match(/^\/api\/projects\/([^/]+)\/images$/);
  if (method === "GET" && imageList) return sendJson(res, { page: 1, pageSize: 48, total: 0, items: [] });
  const summary = parsed.pathname.match(/^\/api\/projects\/([^/]+)\/summary$/);
  if (method === "GET" && summary) {
    return sendJson(res, { summary: { image_count: 0, video_count: 0, annotation_count: 0, scenes: [], views: [], modalities: [], labels: [] } });
  }
  if (method === "GET" && parsed.pathname === "/api/imports/latest") return sendJson(res, { importBatch: null });
  if (method === "GET" && parsed.pathname === "/api/jobs") return sendJson(res, { jobs: [] });

  if (method === "GET" && !parsed.pathname.startsWith("/api/")) {
    if (serveStatic(parsed.pathname, res)) return;
  }
  sendError(res, 404, "not found");
}

async function main() {
  await ensureRuntimeSchema();
  await store.ensureBucket();
  const server = http.createServer((req, res) => {
    route(req, res).catch((error) => {
      console.error(error);
      sendError(res, 500, error.message);
    });
  });
  globalThis.detDashboardStableServer = server;
  server.on("error", (error) => console.error("Stable server error:", error));
  server.on("close", () => console.error("Stable server closed"));
  server.listen(port, "127.0.0.1", () => {
    console.log(`Stable API: http://localhost:${port}`);
  });
}

process.on("beforeExit", (code) => console.error(`Stable beforeExit: ${code}`));
process.on("exit", (code) => console.error(`Stable exit: ${code}`));

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
