const fs = require("fs");
const path = require("path");

const MIME_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".map": "application/json",
});

const SECURITY_HEADERS = Object.freeze({
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
});

function createStaticHandler({ distRoot, sendError } = {}) {
  if (!distRoot) throw new TypeError("createStaticHandler requires distRoot");
  if (typeof sendError !== "function") throw new TypeError("createStaticHandler requires sendError");

  const root = path.resolve(distRoot);

  function isInsideRoot(filePath) {
    return filePath === root || filePath.startsWith(`${root}${path.sep}`);
  }

  function sendFile(req, res, filePath, requestedPath) {
    const ext = path.extname(filePath).toLowerCase();
    const cacheControl = requestedPath.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : ext === ".html" ? "no-store" : "public, max-age=3600";

    res.writeHead(200, {
      "content-type": MIME_TYPES[ext] || "application/octet-stream",
      "cache-control": cacheControl,
      ...SECURITY_HEADERS,
    });
    res.end(req.method === "HEAD" ? undefined : fs.readFileSync(filePath));
  }

  function handle(req, res, parsed) {
    if (req.method !== "GET" && req.method !== "HEAD") return false;

    let pathname = parsed?.pathname;
    if (!pathname) {
      const requestTarget = String(req.url || "/");
      if (requestTarget.startsWith("/")) {
        pathname = requestTarget.split(/[?#]/, 1)[0] || "/";
      } else {
        try {
          pathname = new URL(requestTarget, "http://localhost").pathname || "/";
        } catch {
          sendError(res, 400, "invalid path encoding");
          return true;
        }
      }
    }
    let requestedPath;
    try {
      requestedPath = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
    } catch {
      sendError(res, 400, "invalid path encoding");
      return true;
    }

    const filePath = path.resolve(root, `.${requestedPath}`);
    if (!isInsideRoot(filePath)) {
      sendError(res, 403, "forbidden");
      return true;
    }

    try {
      if (fs.statSync(filePath).isFile()) {
        sendFile(req, res, filePath, requestedPath);
        return true;
      }
    } catch {
      // Missing static files may still be handled by the SPA fallback.
    }

    if (!pathname.startsWith("/api/")) {
      const indexPath = path.join(root, "index.html");
      try {
        if (fs.statSync(indexPath).isFile()) {
          sendFile(req, res, indexPath, "/index.html");
          return true;
        }
      } catch {
        // Let the caller send its normal 404 response.
      }
    }

    return false;
  }

  return Object.freeze({ handle });
}

module.exports = { createStaticHandler };
