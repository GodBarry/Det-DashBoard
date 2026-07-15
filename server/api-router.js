"use strict";

const DEFAULT_BODY_LIMIT = 1024 * 1024;
const ACCESS_LEVELS = new Set(["public", "protected", "admin"]);

function httpError(statusCode, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details !== undefined) error.details = details;
  return error;
}

function sendJson(res, data, statusCode = 200, headers = {}) {
  if (res.writableEnded) return;
  const body = statusCode === 204 ? "" : JSON.stringify(data === undefined ? null : data);
  const responseHeaders = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  };
  if (!res.headersSent) res.writeHead(statusCode, responseHeaders);
  res.end(body);
}

function sendError(res, error, fallbackStatus = 500) {
  const statusCode = Number(error?.statusCode || error?.status || fallbackStatus);
  const safeStatus = statusCode >= 400 && statusCode <= 599 ? statusCode : fallbackStatus;
  const payload = { error: error?.message || "internal server error" };
  if (error?.code) payload.code = error.code;
  if (error?.details !== undefined) payload.details = error.details;
  sendJson(res, payload, safeStatus);
}

function readBody(req, options = {}) {
  if (req.body !== undefined) return Promise.resolve(req.body);
  const limit = Number(options.limit || options.maxBytes || DEFAULT_BODY_LIMIT);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        reject(httpError(413, `request body exceeds ${limit} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(httpError(400, "request body must be valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function normalizePath(pathname) {
  const value = String(pathname || "/").split("?")[0] || "/";
  return value.length > 1 ? value.replace(/\/+$/, "") : value;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compilePath(path) {
  const normalized = normalizePath(path);
  if (normalized === "/") return { expression: /^\/$/, names: [] };
  const names = [];
  const segments = normalized.slice(1).split("/");
  const source = segments.map((segment) => {
    if (segment === "*") {
      names.push("wildcard");
      return "(.*)";
    }
    if (segment.startsWith(":")) {
      const optional = segment.endsWith("?");
      const name = segment.slice(1, optional ? -1 : undefined);
      if (!name) throw new TypeError(`invalid route parameter in ${path}`);
      names.push(name);
      return optional ? "([^/]*)" : "([^/]+)";
    }
    return escapeRegExp(segment);
  }).join("/");
  return { expression: new RegExp(`^/${source}/?$`), names };
}

function queryObject(searchParams) {
  const result = Object.create(null);
  for (const [key, value] of searchParams) {
    if (result[key] === undefined) result[key] = value;
    else if (Array.isArray(result[key])) result[key].push(value);
    else result[key] = [result[key], value];
  }
  return result;
}

function routeArguments(pathOrOptions, metadataOrHandler, maybeHandler) {
  if (pathOrOptions && typeof pathOrOptions === "object") {
    return {
      path: pathOrOptions.path,
      metadata: { ...pathOrOptions, path: undefined, method: undefined, handler: undefined },
      handler: pathOrOptions.handler,
    };
  }
  if (typeof metadataOrHandler === "function") {
    return { path: pathOrOptions, metadata: {}, handler: metadataOrHandler };
  }
  return { path: pathOrOptions, metadata: metadataOrHandler || {}, handler: maybeHandler };
}

function createRouter(options = {}) {
  const routes = [];
  const authenticate = options.authenticate;
  const requireAdmin = options.requireAdmin;
  const bodyReader = options.readBody || readBody;
  const jsonSender = options.sendJson || sendJson;
  const errorSender = options.sendError
    ? (res, error) => options.sendError(
      res,
      Number(error?.statusCode || error?.status || 500),
      error?.message || "internal server error",
      error,
    )
    : sendError;

  function add(method, pathOrOptions, metadataOrHandler, maybeHandler) {
    const definition = routeArguments(pathOrOptions, metadataOrHandler, maybeHandler);
    const handler = definition.handler;
    if (typeof handler !== "function") throw new TypeError("route handler must be a function");
    const metadata = { ...definition.metadata };
    const access = metadata.access || (metadata.admin ? "admin" : metadata.public ? "public" : "protected");
    if (!ACCESS_LEVELS.has(access)) throw new TypeError(`unknown route access level: ${access}`);
    const compiled = compilePath(definition.path);
    const route = Object.freeze({
      method: String(method || "GET").toUpperCase(),
      path: normalizePath(definition.path),
      access,
      metadata: Object.freeze({ ...metadata, access }),
      handler,
      ...compiled,
    });
    routes.push(route);
    return route;
  }

  function match(method, pathname) {
    const normalizedMethod = String(method || "GET").toUpperCase();
    const normalizedPath = normalizePath(pathname);
    for (const route of routes) {
      if (route.method !== normalizedMethod && !(normalizedMethod === "HEAD" && route.method === "GET")) continue;
      const matched = route.expression.exec(normalizedPath);
      if (!matched) continue;
      const params = Object.create(null);
      route.names.forEach((name, index) => {
        try {
          params[name] = decodeURIComponent(matched[index + 1]);
        } catch {
          throw httpError(400, `invalid path parameter: ${name}`);
        }
      });
      return { route, params };
    }
    return null;
  }

  async function handle(req, res, extraContext = {}) {
    let matched;
    try {
      const requestUrl = new URL(req.url || "/", "http://localhost");
      matched = match(req.method, requestUrl.pathname);
      if (!matched) return false;
      const { route, params } = matched;
      const context = {
        ...extraContext,
        req,
        res,
        route,
        metadata: route.metadata,
        params,
        query: queryObject(requestUrl.searchParams),
        body: undefined,
        user: extraContext.user || null,
        send(data, statusCode = 200, headers) {
          jsonSender(res, data, statusCode, headers);
        },
        fail(statusCode, message, details) {
          throw httpError(statusCode, message, details);
        },
      };

      if (route.access !== "public") {
        if (!context.user) {
          if (typeof authenticate !== "function") throw new TypeError("protected routes require authenticate(req, context)");
          context.user = await authenticate(req, context);
        }
        if (!context.user) throw httpError(401, "authentication required");
      }
      if (route.access === "admin") {
        if (typeof requireAdmin === "function") await requireAdmin(context.user, context);
        else if (context.user.role !== "admin") throw httpError(403, "administrator permission required");
      }
      if (!["GET", "HEAD"].includes(String(req.method).toUpperCase()) && route.metadata.readBody !== false) {
        context.body = await bodyReader(req, context);
      } else {
        context.body = req.body === undefined ? {} : req.body;
      }

      const result = await route.handler(context);
      if (!res.writableEnded && result !== undefined) {
        const statusCode = Number(result?.statusCode || route.metadata.statusCode || 200);
        if (result && result.__routerResponse === true) jsonSender(res, result.body, statusCode, result.headers);
        else jsonSender(res, result, statusCode);
      }
      return true;
    } catch (error) {
      if (!matched) throw error;
      if (!res.writableEnded) errorSender(res, error);
      return true;
    }
  }

  const router = {
    routes,
    add,
    register: add,
    match,
    handle,
    dispatch: handle,
  };
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    router[method] = (...args) => add(method.toUpperCase(), ...args);
  }
  return router;
}

function pickFunction(source, names, required = false) {
  for (const name of names) {
    if (typeof source?.[name] === "function") return source[name].bind(source);
  }
  if (required) throw new TypeError(`missing dependency: ${names.join(" or ")}`);
  return null;
}

function withActor(body, actor, request) {
  return { ...(body || {}), actor, request };
}

function clientMetadata(req) {
  return {
    request: req,
    ipAddress: String(req.socket?.remoteAddress || req.headers?.["x-forwarded-for"] || "").split(",")[0].trim(),
    userAgent: String(req.headers?.["user-agent"] || ""),
  };
}

function createMultiUserRouter(deps = {}) {
  const accessControl = deps.accessControl;
  const collaborationService = deps.collaborationService;
  if (!accessControl) throw new TypeError("createMultiUserRouter requires accessControl");
  if (!collaborationService) throw new TypeError("createMultiUserRouter requires collaborationService");

  const authenticate = deps.authenticate || pickFunction(accessControl, ["authenticateRequest", "authenticateToken", "resolveSession"], true);
  const adminGuard = deps.requireAdmin || pickFunction(accessControl, ["requireAdmin"]);
  const login = pickFunction(deps, ["authenticateCredentials", "loginUser", "login"]);
  const listUsers = pickFunction(deps, ["listUsers"]);
  const updateUser = pickFunction(deps, ["updateUser"]);
  const getUserPermissions = pickFunction(deps, ["getUserPermissions", "listUserPermissions"]);
  const updateUserPermissions = pickFunction(deps, ["updateUserPermissions", "setUserPermissions"]);
  const listPublicAssets = pickFunction(deps, ["listPublicAssets"]);
  const removePublicAsset = pickFunction(deps, ["removePublicAsset"]);
  const router = createRouter({
    authenticate,
    requireAdmin: adminGuard,
    readBody: deps.readBody,
    sendJson: deps.sendJson,
    sendError: deps.sendError,
  });

  router.post("/api/auth/login", { access: "public" }, async ({ body, req }) => {
    if (!login) throw httpError(501, "credential authentication is not configured");
    const authenticated = await login(body, req);
    const user = authenticated?.user || authenticated;
    if (!user?.id) throw httpError(401, "invalid credentials");
    const session = await accessControl.createSession(user, clientMetadata(req));
    return { ...session, user: session.user || accessControl.publicUser?.(user) || user };
  });
  router.get("/api/auth/me", async ({ user }) => ({ user }));
  router.get("/api/me", async ({ user }) => ({ user }));
  router.post("/api/auth/logout", async ({ req, user, body }) => {
    const token = accessControl.extractToken?.(req) || user.sessionId;
    const revoked = await accessControl.revokeSession(token, user, body.reason || "logout");
    return { ok: true, revoked };
  });

  async function usersResponse(context, adminOnly) {
    if (!listUsers) throw httpError(501, "user listing is not configured");
    const users = await listUsers(context.query, context.user, { adminOnly });
    return Array.isArray(users) ? { users } : users;
  }
  router.get("/api/users", usersResponse);
  router.get("/api/admin/users", { access: "admin" }, (context) => usersResponse(context, true));
  router.patch("/api/admin/users/:userId", { access: "admin" }, async ({ params, body, user }) => {
    if (!updateUser) throw httpError(501, "user updates are not configured");
    return { user: await updateUser(params.userId, body, user) };
  });
  router.get("/api/me/permissions", async ({ user }) => ({
    permissions: getUserPermissions ? await getUserPermissions(user.id, user) : [],
  }));
  router.get("/api/permissions/:resourceType/:resourceId", async ({ params, user }) => ({
    permissions: await accessControl.getAssetPermissions(user, params.resourceType, params.resourceId),
  }));
  router.get("/api/users/:userId/permissions", { access: "admin" }, async ({ params, user }) => {
    if (!getUserPermissions) throw httpError(501, "user permissions are not configured");
    return { permissions: await getUserPermissions(params.userId, user) };
  });
  router.put("/api/users/:userId/permissions", { access: "admin" }, async ({ params, body, user }) => {
    if (!updateUserPermissions) throw httpError(501, "user permission updates are not configured");
    return { permissions: await updateUserPermissions(params.userId, body.permissions || body, user) };
  });

  router.get("/api/acl/:resourceType/:resourceId", async ({ params, user }) => ({
    acl: await accessControl.listAssetAcl(params.resourceType, params.resourceId, user),
  }));
  router.post("/api/acl/:resourceType/:resourceId", async ({ params, body, user, req }) => ({
    acl: await accessControl.grantAssetPermissions(withActor({ ...body, ...params }, user, req)),
  }));
  router.put("/api/acl/:resourceType/:resourceId/:userId", async ({ params, body, user, req }) => ({
    acl: await accessControl.setAssetPermissions(withActor({ ...body, ...params }, user, req)),
  }));
  router.delete("/api/acl/:resourceType/:resourceId/:userId", async ({ params, body, user, req }) => ({
    revoked: await accessControl.revokeAssetPermissions(withActor({ ...body, ...params }, user, req)),
  }));

  router.get("/api/shares", async ({ query, user }) => ({ invitations: await accessControl.listShareInvitations(query, user) }));
  router.post("/api/shares", async ({ body, user, req }) => accessControl.createShareInvitation(withActor(body, user, req)));
  router.post("/api/shares/accept", async ({ body, user, req }) => ({
    invitation: await accessControl.acceptShareInvitation(body.token, user, { ...body, request: req }),
  }));
  router.post("/api/shares/:invitationId/decline", async ({ params, user }) => ({
    invitation: await accessControl.declineShareInvitation(params.invitationId, user),
  }));
  router.post("/api/shares/:invitationId/revoke", async ({ params, user }) => ({
    invitation: await accessControl.revokeShareInvitation(params.invitationId, user),
  }));

  router.get("/api/public-requests", async ({ query, user }) => ({ requests: await accessControl.listPublishRequests(query, user) }));
  router.post("/api/public-requests", async ({ body, user, req }) => ({
    request: await accessControl.createPublishRequest(withActor(body, user, req)),
  }));
  router.delete("/api/public-requests/:requestId", async ({ params, user }) => ({
    request: await accessControl.cancelPublishRequest(params.requestId, user),
  }));
  router.get("/api/admin/public-requests", { access: "admin" }, async ({ query, user }) => ({
    requests: await accessControl.listPublishRequests(query, user),
  }));
  router.post("/api/admin/public-requests/:requestId/review", { access: "admin" }, async ({ params, body, user }) => ({
    request: await accessControl.reviewPublishRequest(params.requestId, user, body.decision, body.note),
  }));
  router.get("/api/admin/public-assets", { access: "admin" }, async ({ query, user }) => {
    const assets = listPublicAssets
      ? await listPublicAssets(query, user)
      : await accessControl.listPublishRequests({ ...query, status: "approved" }, user);
    return Array.isArray(assets) ? { assets } : assets;
  });
  router.delete("/api/admin/public-assets/:resourceId", { access: "admin" }, async ({ params, query, body, user }) => {
    if (removePublicAsset) return removePublicAsset(params.resourceId, { ...query, ...body }, user);
    const resourceType = body.resourceType || body.resource_type || query.resourceType || query.resource_type;
    if (!resourceType) throw httpError(400, "resourceType is required");
    return { request: await accessControl.unpublishResource(resourceType, params.resourceId, user, body.note) };
  });

  router.get("/api/admin/audit", { access: "admin" }, async ({ query, user }) => ({ logs: await accessControl.listAuditLogs(query, user) }));
  router.get("/api/audit", { access: "admin" }, async ({ query, user }) => ({ logs: await accessControl.listAuditLogs(query, user) }));
  router.get("/api/audit-logs", { access: "admin" }, async ({ query, user }) => ({ logs: await accessControl.listAuditLogs(query, user) }));

  router.get("/api/annotation-tasks", async ({ query, user }) => collaborationService.listTasks(query, user));
  router.post("/api/annotation-tasks", async ({ body, user }) => collaborationService.createTask(body, user));
  router.get("/api/annotation-tasks/:taskId/items", async ({ params, query, user }) => (
    collaborationService.listTaskItems(params.taskId, query, user)
  ));
  router.post("/api/annotation-tasks/:taskId/claim", async ({ params, body, user }) => (
    collaborationService.claimTask(params.taskId, user, body)
  ));
  router.post("/api/annotation-items/:itemId/lock", async ({ params, body, user }) => (
    collaborationService.acquireLock(params.itemId, user, body)
  ));
  router.post("/api/annotation-locks/:lockToken/renew", async ({ params, body, user }) => (
    collaborationService.renewLock(params.lockToken, user, body)
  ));
  router.delete("/api/annotation-locks/:lockToken", async ({ params, user }) => (
    collaborationService.releaseLock(params.lockToken, user)
  ));
  router.post("/api/annotation-items/:itemId/submit", async ({ params, body, user }) => (
    collaborationService.saveSubmission({ ...body, itemId: params.itemId }, user)
  ));
  router.post("/api/annotation-items/:itemId/review", { access: "admin" }, async ({ params, body, user }) => (
    collaborationService.reviewSubmission({ ...body, itemId: params.itemId }, user)
  ));
  router.post("/api/annotation-tasks/:taskId/submit", async ({ params, body, user }) => {
    const itemId = body.itemId || body.item_id;
    if (!itemId) throw httpError(400, "itemId is required");
    return collaborationService.saveSubmission({ ...body, itemId, taskId: params.taskId }, user);
  });
  router.post("/api/annotation-tasks/:taskId/review", { access: "admin" }, async ({ params, body, user }) => {
    const itemId = body.itemId || body.item_id;
    if (!itemId) throw httpError(400, "itemId is required");
    return collaborationService.reviewSubmission({ ...body, itemId, taskId: params.taskId }, user);
  });

  return router;
}

module.exports = {
  createRouter,
  createMultiUserRouter,
  readBody,
  sendJson,
  sendError,
  httpError,
};
