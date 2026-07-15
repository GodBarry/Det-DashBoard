const crypto = require("crypto");

const ROLES = Object.freeze({
  ADMIN: "admin",
  USER: "user",
});

const PERMISSIONS = Object.freeze({
  VIEW: "asset:view",
  USE: "asset:use",
  EDIT: "asset:edit",
  DELETE: "asset:delete",
  SHARE: "asset:share",
  PUBLISH: "asset:publish",
  MANAGE_ACL: "asset:manage_acl",
});

const PLATFORM_PERMISSIONS = Object.freeze({
  DATASETS_IMPORT: "datasets.import",
  DATASETS_ANNOTATE: "datasets.annotate",
  DATASETS_SHARE: "datasets.share",
  ASSETS_REGISTER: "assets.register",
  ASSETS_USE: "assets.use",
  ASSETS_SHARE: "assets.share",
  TRAINING_RUN: "training.run",
  INFERENCE_RUN: "inference.run",
});

const ALL_PLATFORM_PERMISSIONS = Object.freeze(Object.values(PLATFORM_PERMISSIONS));

const ALL_PERMISSIONS = Object.freeze(Object.values(PERMISSIONS));
const PERMISSION_TEMPLATES = Object.freeze({
  viewer: Object.freeze([PERMISSIONS.VIEW]),
  consumer: Object.freeze([PERMISSIONS.VIEW, PERMISSIONS.USE]),
  editor: Object.freeze([PERMISSIONS.VIEW, PERMISSIONS.USE, PERMISSIONS.EDIT]),
  manager: Object.freeze([
    PERMISSIONS.VIEW,
    PERMISSIONS.USE,
    PERMISSIONS.EDIT,
    PERMISSIONS.DELETE,
    PERMISSIONS.SHARE,
    PERMISSIONS.PUBLISH,
    PERMISSIONS.MANAGE_ACL,
  ]),
  owner: ALL_PERMISSIONS,
  admin: Object.freeze(["*"]),
});

const SCHEMA_MIGRATIONS = Object.freeze([
  Object.freeze({
    version: 1,
    name: "access control core",
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS access_control_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS user_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ip_address TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '',
        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      "CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, created_at DESC)",
      "CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(token_hash, expires_at) WHERE revoked_at IS NULL",
      `CREATE TABLE IF NOT EXISTS asset_acl (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        resource_type TEXT NOT NULL,
        resource_id UUID NOT NULL,
        user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        permission TEXT NOT NULL,
        granted_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(resource_type, resource_id, user_id, permission)
      )`,
      "CREATE INDEX IF NOT EXISTS idx_asset_acl_resource ON asset_acl(resource_type, resource_id)",
      "CREATE INDEX IF NOT EXISTS idx_asset_acl_user ON asset_acl(user_id, permission, resource_type)",
      `CREATE TABLE IF NOT EXISTS share_invitations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        resource_type TEXT NOT NULL,
        resource_id UUID NOT NULL,
        invited_by UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        recipient_user_id UUID REFERENCES app_users(id) ON DELETE CASCADE,
        recipient_identifier TEXT NOT NULL DEFAULT '',
        permissions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        token_hash TEXT NOT NULL UNIQUE,
        message TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        expires_at TIMESTAMPTZ NOT NULL,
        accepted_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
        accepted_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK (status IN ('pending', 'accepted', 'declined', 'revoked', 'expired'))
      )`,
      "CREATE INDEX IF NOT EXISTS idx_share_invitations_resource ON share_invitations(resource_type, resource_id, created_at DESC)",
      "CREATE INDEX IF NOT EXISTS idx_share_invitations_recipient ON share_invitations(recipient_user_id, status, created_at DESC)",
      `CREATE TABLE IF NOT EXISTS public_publish_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        resource_type TEXT NOT NULL,
        resource_id UUID NOT NULL,
        requested_by UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        reason TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        reviewed_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
        review_note TEXT NOT NULL DEFAULT '',
        reviewed_at TIMESTAMPTZ,
        published_at TIMESTAMPTZ,
        unpublished_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'unpublished'))
      )`,
      "CREATE INDEX IF NOT EXISTS idx_publish_requests_resource ON public_publish_requests(resource_type, resource_id, created_at DESC)",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_publish_requests_one_pending ON public_publish_requests(resource_type, resource_id) WHERE status='pending'",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_publish_requests_one_public ON public_publish_requests(resource_type, resource_id) WHERE status='approved' AND unpublished_at IS NULL",
      `CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGSERIAL PRIMARY KEY,
        actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL DEFAULT '',
        resource_id UUID,
        outcome TEXT NOT NULL DEFAULT 'success',
        ip_address TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '',
        details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      "CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_user_id, created_at DESC)",
      "CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id, created_at DESC)",
      "CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action, created_at DESC)",
    ]),
  }),
  Object.freeze({
    version: 2,
    name: "access control constraints",
    statements: Object.freeze([
      "ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS revoked_reason TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE asset_acl ADD COLUMN IF NOT EXISTS source_invitation_id UUID REFERENCES share_invitations(id) ON DELETE SET NULL",
      "CREATE INDEX IF NOT EXISTS idx_asset_acl_expiry ON asset_acl(expires_at) WHERE expires_at IS NOT NULL",
    ]),
  }),
  Object.freeze({
    version: 3,
    name: "platform user permissions",
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS user_permissions (
        user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        permission TEXT NOT NULL,
        granted_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, permission)
      )`,
      "CREATE INDEX IF NOT EXISTS idx_user_permissions_permission ON user_permissions(permission, user_id)",
      "CREATE INDEX IF NOT EXISTS idx_user_permissions_granted_by ON user_permissions(granted_by, created_at DESC)",
    ]),
  }),
]);

const SCHEMA_SQL = Object.freeze(SCHEMA_MIGRATIONS.flatMap((migration) => migration.statements));
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESOURCE_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const SQL_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;
const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function fallbackHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function createAccessControl(dependencies = {}) {
  const { query, transaction, httpError = fallbackHttpError } = dependencies;
  const onPublicationStatus = dependencies.onPublicationStatus || null;
  if (typeof query !== "function") throw new TypeError("createAccessControl requires query(text, params)");
  if (typeof transaction !== "function") throw new TypeError("createAccessControl requires transaction(callback)");
  if (typeof httpError !== "function") throw new TypeError("httpError must be a function");

  function fail(statusCode, message) {
    throw httpError(statusCode, message);
  }

  function normalizeUuid(value, fieldName = "id") {
    const id = String(value || "").trim();
    if (!UUID_PATTERN.test(id)) fail(400, `${fieldName} must be a UUID`);
    return id;
  }

  function normalizeResourceType(value) {
    const resourceType = String(value || "").trim().toLowerCase();
    if (!RESOURCE_TYPE_PATTERN.test(resourceType)) fail(400, "invalid resource type");
    return resourceType;
  }

  function normalizePermission(value) {
    const permission = String(value || "").trim().toLowerCase();
    if (!ALL_PERMISSIONS.includes(permission)) fail(400, `unknown permission: ${permission || "(empty)"}`);
    return permission;
  }

  function normalizePermissions(value, fallback = PERMISSION_TEMPLATES.viewer) {
    let permissions = value;
    if (typeof value === "string" && PERMISSION_TEMPLATES[value.toLowerCase()]) {
      permissions = PERMISSION_TEMPLATES[value.toLowerCase()];
    }
    if (!Array.isArray(permissions) || !permissions.length) permissions = fallback;
    return [...new Set(permissions.map(normalizePermission))];
  }

  function normalizePlatformPermission(value) {
    const permission = String(value || "").trim().toLowerCase();
    if (!ALL_PLATFORM_PERMISSIONS.includes(permission)) {
      fail(400, `unknown platform permission: ${permission || "(empty)"}`);
    }
    return permission;
  }

  function normalizePlatformPermissions(value) {
    if (!Array.isArray(value)) fail(400, "platform permissions must be an array");
    return [...new Set(value.map(normalizePlatformPermission))];
  }

  function publicUser(row = {}) {
    if (!row || !row.id) return null;
    return {
      id: row.id,
      username: row.username,
      role: row.role,
      displayName: row.display_name || row.displayName || row.username,
      status: row.status,
    };
  }

  function isAdmin(user) {
    return Boolean(user && user.role === ROLES.ADMIN && (!user.status || user.status === "active"));
  }

  function isRegularUser(user) {
    return Boolean(user && user.role === ROLES.USER && (!user.status || user.status === "active"));
  }

  function requireUser(user) {
    if (!user) fail(401, "authentication required");
    if (user.status && user.status !== "active") fail(403, "user account is not active");
    return user;
  }

  function requireAdmin(user) {
    requireUser(user);
    if (!isAdmin(user)) fail(403, "administrator permission required");
    return user;
  }

  function requireRegularUser(user) {
    requireUser(user);
    if (!isRegularUser(user)) fail(403, "regular user permission required");
    return user;
  }

  function tokenHash(token) {
    return crypto.createHash("sha256").update(String(token || "")).digest("hex");
  }

  function newToken() {
    return crypto.randomBytes(32).toString("base64url");
  }

  function dateAfter(ttlMs, defaultTtlMs) {
    const ttl = Number(ttlMs ?? defaultTtlMs);
    if (!Number.isFinite(ttl) || ttl <= 0) fail(400, "expiry duration must be positive");
    return new Date(Date.now() + ttl);
  }

  function extractToken(source) {
    if (typeof source === "string") return source.trim();
    const headers = source?.headers || {};
    const authorization = String(headers.authorization || headers.Authorization || "");
    const bearer = authorization.match(/^Bearer\s+(.+)$/i);
    if (bearer) return bearer[1].trim();
    const direct = headers["x-session-token"] || headers["X-Session-Token"];
    if (direct) return String(direct).trim();
    const cookie = String(headers.cookie || "");
    const match = cookie.match(/(?:^|;\s*)(?:det_session|session_token)=([^;]+)/);
    if (!match) return "";
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }

  async function initializeSchema() {
    await query(SCHEMA_MIGRATIONS[0].statements[0]);
    const appliedRows = await query("SELECT version FROM access_control_schema_migrations");
    const applied = new Set(appliedRows.rows.map((row) => Number(row.version)));
    for (const migration of SCHEMA_MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      await transaction(async (client) => {
        for (const statement of migration.statements) await client.query(statement);
        await client.query(
          `INSERT INTO access_control_schema_migrations (version, name)
           VALUES ($1,$2) ON CONFLICT (version) DO NOTHING`,
          [migration.version, migration.name],
        );
      });
    }
    return { version: SCHEMA_MIGRATIONS.at(-1).version };
  }

  async function createSession(userOrId, options = {}) {
    const userId = normalizeUuid(userOrId?.id || userOrId, "user id");
    const user = (await query("SELECT * FROM app_users WHERE id=$1 AND status='active'", [userId])).rows[0];
    if (!user) fail(401, "active user not found");
    const token = newToken();
    const expiresAt = dateAfter(options.ttlMs, DEFAULT_SESSION_TTL_MS);
    const row = (await query(
      `INSERT INTO user_sessions
         (user_id, token_hash, expires_at, ip_address, user_agent, metadata_json)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, user_id, expires_at, created_at`,
      [
        userId,
        tokenHash(token),
        expiresAt,
        String(options.ipAddress || options.ip || "").slice(0, 200),
        String(options.userAgent || "").slice(0, 1000),
        JSON.stringify(options.metadata || {}),
      ],
    )).rows[0];
    await writeAudit({
      actorUserId: userId,
      action: "session.create",
      details: { sessionId: row.id },
      request: options.request,
    });
    return { token, expiresAt: row.expires_at, sessionId: row.id, user: publicUser(user) };
  }

  async function authenticateToken(tokenOrRequest, options = {}) {
    const token = extractToken(tokenOrRequest);
    if (!token) {
      if (options.optional) return null;
      fail(401, "session token required");
    }
    const row = (await query(
      `SELECT s.id AS session_id, s.expires_at, s.metadata_json,
              u.id, u.username, u.role, u.display_name, u.status
       FROM user_sessions s
       JOIN app_users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()
         AND u.status='active'`,
      [tokenHash(token)],
    )).rows[0];
    if (!row) {
      if (options.optional) return null;
      fail(401, "invalid or expired session");
    }
    await query("UPDATE user_sessions SET last_seen_at=now() WHERE id=$1", [row.session_id]);
    return {
      ...publicUser(row),
      sessionId: row.session_id,
      sessionExpiresAt: row.expires_at,
      sessionMetadata: row.metadata_json || {},
    };
  }

  async function revokeSession(sessionOrToken, actor = null, reason = "") {
    const value = String(sessionOrToken || "").trim();
    if (!value) fail(400, "session id or token required");
    const byId = UUID_PATTERN.test(value);
    const result = await query(
      `UPDATE user_sessions SET revoked_at=COALESCE(revoked_at,now()), revoked_reason=$1
       WHERE ${byId ? "id=$2" : "token_hash=$2"} AND revoked_at IS NULL
       RETURNING id, user_id`,
      [String(reason || "").slice(0, 500), byId ? value : tokenHash(value)],
    );
    if (!result.rowCount) return false;
    await writeAudit({
      actorUserId: actor?.id || result.rows[0].user_id,
      action: "session.revoke",
      details: { sessionId: result.rows[0].id, reason: String(reason || "") },
    });
    return true;
  }

  async function revokeUserSessions(userId, actor, reason = "") {
    requireAdmin(actor);
    const normalizedUserId = normalizeUuid(userId, "user id");
    const result = await query(
      `UPDATE user_sessions SET revoked_at=now(), revoked_reason=$1
       WHERE user_id=$2 AND revoked_at IS NULL RETURNING id`,
      [String(reason || "").slice(0, 500), normalizedUserId],
    );
    await writeAudit({
      actorUserId: actor.id,
      action: "session.revoke_all",
      resourceType: "user",
      resourceId: normalizedUserId,
      details: { count: result.rowCount, reason: String(reason || "") },
    });
    return result.rowCount;
  }

  async function cleanupExpiredSessions() {
    const result = await query("DELETE FROM user_sessions WHERE expires_at<now() OR revoked_at<now()-interval '30 days'");
    return result.rowCount;
  }

  async function listUsers(filters = {}, actor) {
    requireAdmin(actor);
    const params = [];
    const where = [];
    if (filters.status) {
      params.push(String(filters.status).trim().toLowerCase());
      where.push(`u.status=$${params.length}`);
    }
    if (filters.role) {
      params.push(String(filters.role).trim().toLowerCase());
      where.push(`u.role=$${params.length}`);
    }
    if (filters.search) {
      params.push(`%${String(filters.search).trim().toLowerCase()}%`);
      where.push(`(lower(u.username) LIKE $${params.length} OR lower(u.display_name) LIKE $${params.length})`);
    }
    const limit = Math.min(500, Math.max(1, Number(filters.limit) || 100));
    const offset = Math.max(0, Number(filters.offset) || 0);
    params.push(limit, offset);
    const rows = await query(
      `SELECT u.id, u.username, u.role, u.display_name, u.status, u.created_at, u.updated_at,
              COALESCE(array_agg(up.permission ORDER BY up.permission)
                FILTER (WHERE up.permission IS NOT NULL), '{}'::text[]) AS permissions
       FROM app_users u
       LEFT JOIN user_permissions up ON up.user_id=u.id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       GROUP BY u.id
       ORDER BY u.created_at ASC, u.username ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return rows.rows.map((row) => ({
      ...publicUser(row),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      permissions: row.role === ROLES.ADMIN ? ["*"] : row.permissions || [],
    }));
  }

  async function setUserPermissions(userIdOrInput, permissionsArg, actorArg) {
    const input = userIdOrInput && typeof userIdOrInput === "object" ? userIdOrInput : null;
    const actor = input ? (input.actor || actorArg || permissionsArg) : actorArg;
    const userId = normalizeUuid(input ? (input.userId || input.user_id) : userIdOrInput, "user id");
    const permissions = normalizePlatformPermissions(input ? input.permissions : permissionsArg);
    requireAdmin(actor);
    const target = await transaction(async (client) => {
      const user = (await client.query(
        "SELECT id, username, role, display_name, status, created_at, updated_at FROM app_users WHERE id=$1 FOR UPDATE",
        [userId],
      )).rows[0];
      if (!user) fail(404, "user not found");
      await client.query("DELETE FROM user_permissions WHERE user_id=$1", [userId]);
      for (const permission of permissions) {
        await client.query(
          "INSERT INTO user_permissions (user_id, permission, granted_by) VALUES ($1,$2,$3)",
          [userId, permission, actor.id],
        );
      }
      return user;
    });
    await writeAudit({
      actorUserId: actor.id,
      action: "user.permissions.set",
      resourceType: "user",
      resourceId: userId,
      details: { permissions },
    });
    return {
      ...publicUser(target),
      createdAt: target.created_at,
      updatedAt: target.updated_at,
      permissions: target.role === ROLES.ADMIN ? ["*"] : permissions,
    };
  }

  async function hasPlatformPermission(user, permission) {
    const normalizedPermission = normalizePlatformPermission(permission);
    if (isAdmin(user)) return true;
    if (!user || (user.status && user.status !== "active")) return false;
    const userId = normalizeUuid(user.id, "user id");
    const row = (await query(
      "SELECT 1 FROM user_permissions WHERE user_id=$1 AND permission=$2 LIMIT 1",
      [userId, normalizedPermission],
    )).rows[0];
    return Boolean(row);
  }

  async function requirePlatformPermission(user, permission) {
    if (await hasPlatformPermission(user, permission)) return true;
    if (!user) fail(401, "authentication required");
    fail(403, `platform permission required: ${permission}`);
  }

  async function setUserStatus(userIdOrInput, statusArg, actorArg) {
    const input = userIdOrInput && typeof userIdOrInput === "object" ? userIdOrInput : null;
    const actor = input ? (input.actor || actorArg || statusArg) : actorArg;
    const userId = normalizeUuid(input ? (input.userId || input.user_id) : userIdOrInput, "user id");
    const requestedStatus = input
      ? (input.status || (input.enabled === true ? "active" : input.enabled === false ? "disabled" : ""))
      : statusArg;
    const status = String(requestedStatus || "").trim().toLowerCase();
    requireAdmin(actor);
    if (!["active", "disabled"].includes(status)) fail(400, "user status must be active or disabled");
    if (userId === actor.id && status === "disabled") fail(409, "administrator cannot disable the current account");
    const user = await transaction(async (client) => {
      const row = (await client.query(
        `UPDATE app_users SET status=$1, updated_at=now()
         WHERE id=$2 RETURNING id, username, role, display_name, status, created_at, updated_at`,
        [status, userId],
      )).rows[0];
      if (!row) fail(404, "user not found");
      if (status === "disabled") {
        await client.query(
          `UPDATE user_sessions SET revoked_at=COALESCE(revoked_at,now()), revoked_reason='user disabled'
           WHERE user_id=$1 AND revoked_at IS NULL`,
          [userId],
        );
      }
      return row;
    });
    await writeAudit({
      actorUserId: actor.id,
      action: status === "active" ? "user.enable" : "user.disable",
      resourceType: "user",
      resourceId: userId,
      details: { status },
    });
    return publicUser(user);
  }

  function enableUser(userId, actor) {
    return setUserStatus(userId, "active", actor);
  }

  function disableUser(userId, actor) {
    return setUserStatus(userId, "disabled", actor);
  }

  function permissionsSatisfying(permission) {
    const wanted = normalizePermission(permission);
    if (wanted === PERMISSIONS.VIEW) return ALL_PERMISSIONS;
    if (wanted === PERMISSIONS.USE) {
      return [PERMISSIONS.USE, PERMISSIONS.EDIT, PERMISSIONS.DELETE, PERMISSIONS.SHARE, PERMISSIONS.PUBLISH, PERMISSIONS.MANAGE_ACL];
    }
    if (wanted === PERMISSIONS.EDIT) return [PERMISSIONS.EDIT, PERMISSIONS.DELETE, PERMISSIONS.MANAGE_ACL];
    if (wanted === PERMISSIONS.SHARE) return [PERMISSIONS.SHARE, PERMISSIONS.MANAGE_ACL];
    return [wanted, PERMISSIONS.MANAGE_ACL].filter((value, index, items) => items.indexOf(value) === index);
  }

  async function getAssetPermissions(user, resourceType, resourceId) {
    if (!user) return [];
    requireUser(user);
    if (isAdmin(user)) return ["*"];
    const type = normalizeResourceType(resourceType);
    const id = normalizeUuid(resourceId, "resource id");
    const rows = await query(
      `SELECT DISTINCT permission FROM asset_acl
       WHERE resource_type=$1 AND resource_id=$2 AND user_id=$3
         AND (expires_at IS NULL OR expires_at>now())
       ORDER BY permission`,
      [type, id, user.id],
    );
    return rows.rows.map((row) => row.permission);
  }

  async function isPublicResource(resourceType, resourceId) {
    const type = normalizeResourceType(resourceType);
    const id = normalizeUuid(resourceId, "resource id");
    const row = (await query(
      `SELECT 1 FROM public_publish_requests
       WHERE resource_type=$1 AND resource_id=$2 AND status='approved'
         AND published_at IS NOT NULL AND unpublished_at IS NULL LIMIT 1`,
      [type, id],
    )).rows[0];
    return Boolean(row);
  }

  async function hasAssetPermission(user, resourceType, resourceId, permission, options = {}) {
    const wanted = normalizePermission(permission);
    if (isAdmin(user)) return true;
    if ((!user || options.allowPublic !== false) && [PERMISSIONS.VIEW, PERMISSIONS.USE].includes(wanted)) {
      if (await isPublicResource(resourceType, resourceId)) return true;
    }
    if (!user || (user.status && user.status !== "active")) return false;
    const type = normalizeResourceType(resourceType);
    const id = normalizeUuid(resourceId, "resource id");
    const row = (await query(
      `SELECT 1 FROM asset_acl
       WHERE resource_type=$1 AND resource_id=$2 AND user_id=$3
         AND permission=ANY($4::text[])
         AND (expires_at IS NULL OR expires_at>now()) LIMIT 1`,
      [type, id, user.id, permissionsSatisfying(wanted)],
    )).rows[0];
    return Boolean(row);
  }

  async function requireAssetPermission(user, resourceType, resourceId, permission, options = {}) {
    const allowed = await hasAssetPermission(user, resourceType, resourceId, permission, options);
    if (!allowed) {
      if (!user) fail(401, "authentication required");
      fail(403, `permission required: ${permission}`);
    }
    return true;
  }

  async function grantAssetPermissions(input = {}) {
    const actor = requireUser(input.actor || input.user);
    const resourceType = normalizeResourceType(input.resourceType || input.resource_type);
    const resourceId = normalizeUuid(input.resourceId || input.resource_id, "resource id");
    const targetUserId = normalizeUuid(input.userId || input.user_id || input.targetUserId, "target user id");
    const permissions = normalizePermissions(input.permissions || input.template);
    if (!isAdmin(actor)) await requireAssetPermission(actor, resourceType, resourceId, PERMISSIONS.MANAGE_ACL, { allowPublic: false });
    const target = (await query("SELECT id FROM app_users WHERE id=$1 AND status='active'", [targetUserId])).rows[0];
    if (!target) fail(404, "target user not found");
    const expiresAt = input.expiresAt || input.expires_at || null;
    const rows = await transaction(async (client) => {
      const granted = [];
      for (const permission of permissions) {
        const row = (await client.query(
          `INSERT INTO asset_acl
             (resource_type, resource_id, user_id, permission, granted_by, expires_at, source_invitation_id, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,now())
           ON CONFLICT (resource_type, resource_id, user_id, permission)
           DO UPDATE SET granted_by=EXCLUDED.granted_by, expires_at=EXCLUDED.expires_at,
                         source_invitation_id=COALESCE(EXCLUDED.source_invitation_id,asset_acl.source_invitation_id), updated_at=now()
           RETURNING *`,
          [resourceType, resourceId, targetUserId, permission, actor.id, expiresAt, input.sourceInvitationId || null],
        )).rows[0];
        granted.push(row);
      }
      return granted;
    });
    await writeAudit({
      actorUserId: actor.id,
      action: "acl.grant",
      resourceType,
      resourceId,
      details: { userId: targetUserId, permissions, expiresAt },
      request: input.request,
    });
    return rows;
  }

  async function setAssetPermissions(input = {}) {
    const actor = requireUser(input.actor || input.user);
    const resourceType = normalizeResourceType(input.resourceType || input.resource_type);
    const resourceId = normalizeUuid(input.resourceId || input.resource_id, "resource id");
    const targetUserId = normalizeUuid(input.userId || input.user_id || input.targetUserId, "target user id");
    const permissions = normalizePermissions(input.permissions || input.template, []);
    if (!isAdmin(actor)) await requireAssetPermission(actor, resourceType, resourceId, PERMISSIONS.MANAGE_ACL, { allowPublic: false });
    await transaction(async (client) => {
      await client.query("DELETE FROM asset_acl WHERE resource_type=$1 AND resource_id=$2 AND user_id=$3", [resourceType, resourceId, targetUserId]);
      for (const permission of permissions) {
        await client.query(
          `INSERT INTO asset_acl (resource_type,resource_id,user_id,permission,granted_by,expires_at)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [resourceType, resourceId, targetUserId, permission, actor.id, input.expiresAt || null],
        );
      }
    });
    await writeAudit({ actorUserId: actor.id, action: "acl.set", resourceType, resourceId, details: { userId: targetUserId, permissions } });
    const rows = await query(
      `SELECT acl.*, u.username, u.display_name, grantor.username AS granted_by_username
       FROM asset_acl acl
       JOIN app_users u ON u.id=acl.user_id
       LEFT JOIN app_users grantor ON grantor.id=acl.granted_by
       WHERE acl.resource_type=$1 AND acl.resource_id=$2
       ORDER BY u.username, acl.permission`,
      [resourceType, resourceId],
    );
    return rows.rows;
  }

  async function revokeAssetPermissions(input = {}) {
    const actor = requireUser(input.actor || input.user);
    const resourceType = normalizeResourceType(input.resourceType || input.resource_type);
    const resourceId = normalizeUuid(input.resourceId || input.resource_id, "resource id");
    const targetUserId = normalizeUuid(input.userId || input.user_id || input.targetUserId, "target user id");
    if (!isAdmin(actor)) await requireAssetPermission(actor, resourceType, resourceId, PERMISSIONS.MANAGE_ACL, { allowPublic: false });
    const permissions = input.permissions ? normalizePermissions(input.permissions, []) : [];
    const params = [resourceType, resourceId, targetUserId];
    let sql = "DELETE FROM asset_acl WHERE resource_type=$1 AND resource_id=$2 AND user_id=$3";
    if (permissions.length) {
      params.push(permissions);
      sql += " AND permission=ANY($4::text[])";
    }
    const result = await query(`${sql} RETURNING permission`, params);
    await writeAudit({
      actorUserId: actor.id,
      action: "acl.revoke",
      resourceType,
      resourceId,
      details: { userId: targetUserId, permissions: result.rows.map((row) => row.permission) },
    });
    return result.rowCount;
  }

  async function listAssetAcl(resourceType, resourceId, actor) {
    requireUser(actor);
    const type = normalizeResourceType(resourceType);
    const id = normalizeUuid(resourceId, "resource id");
    if (!isAdmin(actor)) await requireAssetPermission(actor, type, id, PERMISSIONS.MANAGE_ACL, { allowPublic: false });
    const rows = await query(
      `SELECT acl.*, u.username, u.display_name, grantor.username AS granted_by_username
       FROM asset_acl acl
       JOIN app_users u ON u.id=acl.user_id
       LEFT JOIN app_users grantor ON grantor.id=acl.granted_by
       WHERE acl.resource_type=$1 AND acl.resource_id=$2
       ORDER BY u.username, acl.permission`,
      [type, id],
    );
    return rows.rows;
  }

  async function ensureAssetOwner(user, resourceType, resourceId) {
    requireUser(user);
    const type = normalizeResourceType(resourceType);
    const id = normalizeUuid(resourceId, "resource id");
    const existing = (await query("SELECT 1 FROM asset_acl WHERE resource_type=$1 AND resource_id=$2 LIMIT 1", [type, id])).rows[0];
    if (existing && !isAdmin(user)) fail(409, "resource already has access rules");
    const rows = await transaction(async (client) => {
      const granted = [];
      for (const permission of PERMISSION_TEMPLATES.owner) {
        granted.push((await client.query(
          `INSERT INTO asset_acl (resource_type,resource_id,user_id,permission,granted_by)
           VALUES ($1,$2,$3,$4,$3)
           ON CONFLICT (resource_type,resource_id,user_id,permission)
           DO UPDATE SET granted_by=EXCLUDED.granted_by, expires_at=NULL, updated_at=now()
           RETURNING *`,
          [type, id, user.id, permission],
        )).rows[0]);
      }
      return granted;
    });
    await writeAudit({ actorUserId: user.id, action: "acl.owner", resourceType: type, resourceId: id, details: { permissions: PERMISSION_TEMPLATES.owner } });
    return rows;
  }

  async function createShareInvitation(input = {}) {
    const actor = requireUser(input.actor || input.user);
    const resourceType = normalizeResourceType(input.resourceType || input.resource_type);
    const resourceId = normalizeUuid(input.resourceId || input.resource_id, "resource id");
    if (!isAdmin(actor)) await requireAssetPermission(actor, resourceType, resourceId, PERMISSIONS.SHARE, { allowPublic: false });
    let recipientUserId = input.recipientUserId || input.recipient_user_id
      ? normalizeUuid(input.recipientUserId || input.recipient_user_id, "recipient user id")
      : null;
    const recipientIdentifier = String(input.recipientIdentifier || input.recipient_identifier || "").trim().slice(0, 320);
    if (!recipientUserId && !recipientIdentifier) fail(400, "invitation recipient required");
    if (!recipientUserId && recipientIdentifier) {
      recipientUserId = (await query(
        `SELECT id FROM app_users
         WHERE status='active' AND lower(username)=lower($1)
         LIMIT 1`,
        [recipientIdentifier],
      )).rows[0]?.id || null;
    }
    if (recipientUserId) {
      const recipient = (await query("SELECT id FROM app_users WHERE id=$1 AND status='active'", [recipientUserId])).rows[0];
      if (!recipient) fail(404, "recipient user not found");
    }
    const permissions = normalizePermissions(input.permissions || input.template, PERMISSION_TEMPLATES.viewer);
    const token = newToken();
    const expiresAt = input.expiresAt || input.expires_at || dateAfter(input.ttlMs, DEFAULT_INVITATION_TTL_MS);
    const row = (await query(
      `INSERT INTO share_invitations
         (resource_type,resource_id,invited_by,recipient_user_id,recipient_identifier,permissions,token_hash,message,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [resourceType, resourceId, actor.id, recipientUserId, recipientIdentifier, permissions, tokenHash(token), String(input.message || "").slice(0, 2000), expiresAt],
    )).rows[0];
    await writeAudit({ actorUserId: actor.id, action: "share.invite", resourceType, resourceId, details: { invitationId: row.id, recipientUserId, permissions } });
    return { invitation: row, token };
  }

  async function acceptShareInvitation(token, user, options = {}) {
    requireUser(user);
    const invitation = await transaction(async (client) => {
      const invitationId = UUID_PATTERN.test(String(token || "")) ? String(token) : null;
      const row = (await client.query(
        invitationId
          ? `SELECT * FROM share_invitations
             WHERE id=$1 AND (recipient_user_id=$2 OR (recipient_user_id IS NULL AND lower(recipient_identifier)=lower($3)))
             FOR UPDATE`
          : `SELECT * FROM share_invitations WHERE token_hash=$1 FOR UPDATE`,
        invitationId ? [invitationId, user.id, user.username || ""] : [tokenHash(token)],
      )).rows[0];
      if (!row) fail(404, "invitation not found");
      if (row.status !== "pending") fail(409, `invitation is ${row.status}`);
      if (new Date(row.expires_at).getTime() <= Date.now()) {
        await client.query("UPDATE share_invitations SET status='expired', updated_at=now() WHERE id=$1", [row.id]);
        fail(410, "invitation expired");
      }
      if (row.recipient_user_id && row.recipient_user_id !== user.id) fail(403, "invitation belongs to another user");
      if (!row.recipient_user_id && row.recipient_identifier) {
        const identifier = row.recipient_identifier.toLowerCase();
        if (![user.username, user.email].filter(Boolean).some((value) => String(value).toLowerCase() === identifier)) {
          fail(403, "invitation recipient does not match current user");
        }
      }
      for (const permission of row.permissions || []) {
        await client.query(
          `INSERT INTO asset_acl
             (resource_type,resource_id,user_id,permission,granted_by,expires_at,source_invitation_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (resource_type,resource_id,user_id,permission)
           DO UPDATE SET granted_by=EXCLUDED.granted_by, expires_at=EXCLUDED.expires_at,
                         source_invitation_id=EXCLUDED.source_invitation_id, updated_at=now()`,
          [row.resource_type, row.resource_id, user.id, permission, row.invited_by, options.permissionExpiresAt || null, row.id],
        );
      }
      return (await client.query(
        `UPDATE share_invitations SET status='accepted', accepted_by=$1, accepted_at=now(), updated_at=now()
         WHERE id=$2 RETURNING *`,
        [user.id, row.id],
      )).rows[0];
    });
    await writeAudit({ actorUserId: user.id, action: "share.accept", resourceType: invitation.resource_type, resourceId: invitation.resource_id, details: { invitationId: invitation.id } });
    return invitation;
  }

  async function updateShareInvitationStatus(invitationId, actor, status) {
    requireUser(actor);
    if (!["declined", "revoked"].includes(status)) fail(400, "invalid invitation status");
    const id = normalizeUuid(invitationId, "invitation id");
    const invitation = (await query("SELECT * FROM share_invitations WHERE id=$1", [id])).rows[0];
    if (!invitation) fail(404, "invitation not found");
    if (status === "revoked") {
      if (!isAdmin(actor) && invitation.invited_by !== actor.id) fail(403, "only the inviter or an administrator may revoke this invitation");
    } else if (invitation.recipient_user_id && invitation.recipient_user_id !== actor.id) {
      fail(403, "invitation belongs to another user");
    } else if (!invitation.recipient_user_id && invitation.recipient_identifier
      && String(invitation.recipient_identifier).toLowerCase() !== String(actor.username || "").toLowerCase()) {
      fail(403, "invitation belongs to another user");
    }
    if (invitation.status !== "pending") fail(409, `invitation is ${invitation.status}`);
    const row = (await query(
      `UPDATE share_invitations SET status=$1, revoked_at=CASE WHEN $1='revoked' THEN now() ELSE revoked_at END, updated_at=now()
       WHERE id=$2 RETURNING *`,
      [status, id],
    )).rows[0];
    await writeAudit({ actorUserId: actor.id, action: `share.${status}`, resourceType: row.resource_type, resourceId: row.resource_id, details: { invitationId: id } });
    return row;
  }

  async function listShareInvitations(filters = {}, actor) {
    requireUser(actor);
    const params = [];
    const where = [];
    if (!isAdmin(actor)) {
      params.push(actor.id, String(actor.username || "").toLowerCase());
      where.push(`(si.invited_by=$${params.length - 1} OR si.recipient_user_id=$${params.length - 1}
        OR (si.recipient_user_id IS NULL AND lower(si.recipient_identifier)=$${params.length}))`);
    }
    if (filters.resourceType || filters.resource_type) {
      params.push(normalizeResourceType(filters.resourceType || filters.resource_type));
      where.push(`si.resource_type=$${params.length}`);
    }
    if (filters.resourceId || filters.resource_id) {
      params.push(normalizeUuid(filters.resourceId || filters.resource_id, "resource id"));
      where.push(`si.resource_id=$${params.length}`);
    }
    if (filters.status) {
      params.push(String(filters.status));
      where.push(`si.status=$${params.length}`);
    }
    const limit = Math.min(500, Math.max(1, Number(filters.limit) || 100));
    params.push(limit);
    const rows = await query(
      `SELECT si.*, inviter.username AS inviter_username, recipient.username AS recipient_username
       FROM share_invitations si
       JOIN app_users inviter ON inviter.id=si.invited_by
       LEFT JOIN app_users recipient ON recipient.id=si.recipient_user_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY si.created_at DESC LIMIT $${params.length}`,
      params,
    );
    return enrichResourceNames(rows.rows);
  }

  async function enrichResourceNames(rows = []) {
    const definitions = {
      project: ["projects", "name"],
      model: ["model_clusters", "name"],
      model_revision: ["model_revisions", "version_name"],
      runtime_env: ["runtime_envs", "name"],
      algorithm: ["algorithm_assets", "name"],
      training_template: ["training_templates", "name"],
    };
    const result = rows.map((row) => ({ ...row }));
    for (const [resourceType, [table, nameColumn]] of Object.entries(definitions)) {
      const ids = [...new Set(result.filter((row) => row.resource_type === resourceType).map((row) => row.resource_id))];
      if (!ids.length) continue;
      const names = await query(`SELECT id, ${nameColumn} AS resource_name FROM ${table} WHERE id=ANY($1::uuid[])`, [ids]);
      const byId = new Map(names.rows.map((row) => [String(row.id), row.resource_name]));
      for (const row of result) {
        if (row.resource_type === resourceType) row.resource_name = byId.get(String(row.resource_id)) || null;
      }
    }
    return result;
  }

  async function createPublishRequest(input = {}) {
    const actor = requireUser(input.actor || input.user);
    const resourceType = normalizeResourceType(input.resourceType || input.resource_type);
    const resourceId = normalizeUuid(input.resourceId || input.resource_id, "resource id");
    if (!isAdmin(actor)) await requireAssetPermission(actor, resourceType, resourceId, PERMISSIONS.PUBLISH, { allowPublic: false });
    try {
      const row = (await query(
        `INSERT INTO public_publish_requests (resource_type,resource_id,requested_by,reason)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [resourceType, resourceId, actor.id, String(input.reason || "").slice(0, 4000)],
      )).rows[0];
      await writeAudit({ actorUserId: actor.id, action: "publish.request", resourceType, resourceId, details: { requestId: row.id } });
      return row;
    } catch (error) {
      if (error.code === "23505") fail(409, "a publication request is already pending or approved");
      throw error;
    }
  }

  async function reviewPublishRequest(requestId, actor, decision, note = "") {
    requireAdmin(actor);
    const id = normalizeUuid(requestId, "publication request id");
    const normalizedDecision = String(decision || "").toLowerCase();
    if (!["approved", "rejected"].includes(normalizedDecision)) fail(400, "decision must be approved or rejected");
    const row = (await query(
      `UPDATE public_publish_requests
       SET status=$1, reviewed_by=$2, review_note=$3, reviewed_at=now(),
           published_at=CASE WHEN $1='approved' THEN now() ELSE NULL END, updated_at=now()
       WHERE id=$4 AND status='pending' RETURNING *`,
      [normalizedDecision, actor.id, String(note || "").slice(0, 4000), id],
    )).rows[0];
    if (!row) fail(409, "publication request is not pending");
    if (onPublicationStatus) await onPublicationStatus(row.resource_type, row.resource_id, normalizedDecision === "approved", actor);
    await writeAudit({ actorUserId: actor.id, action: `publish.${normalizedDecision}`, resourceType: row.resource_type, resourceId: row.resource_id, details: { requestId: id, note: String(note || "") } });
    return row;
  }

  async function cancelPublishRequest(requestId, actor) {
    requireUser(actor);
    const id = normalizeUuid(requestId, "publication request id");
    const params = isAdmin(actor) ? [id] : [id, actor.id];
    const ownership = isAdmin(actor) ? "" : " AND requested_by=$2";
    const row = (await query(
      `UPDATE public_publish_requests SET status='cancelled', updated_at=now()
       WHERE id=$1 AND status='pending'${ownership} RETURNING *`,
      params,
    )).rows[0];
    if (!row) fail(404, "pending publication request not found");
    await writeAudit({ actorUserId: actor.id, action: "publish.cancel", resourceType: row.resource_type, resourceId: row.resource_id, details: { requestId: id } });
    return row;
  }

  async function unpublishResource(resourceType, resourceId, actor, note = "") {
    requireAdmin(actor);
    const type = normalizeResourceType(resourceType);
    const id = normalizeUuid(resourceId, "resource id");
    const row = (await query(
      `UPDATE public_publish_requests
       SET status='unpublished', unpublished_at=now(), review_note=$1, updated_at=now()
       WHERE resource_type=$2 AND resource_id=$3 AND status='approved' AND unpublished_at IS NULL
       RETURNING *`,
      [String(note || "").slice(0, 4000), type, id],
    )).rows[0];
    if (!row) fail(404, "published resource not found");
    if (onPublicationStatus) await onPublicationStatus(type, id, false, actor);
    await writeAudit({ actorUserId: actor.id, action: "publish.unpublish", resourceType: type, resourceId: id, details: { requestId: row.id, note: String(note || "") } });
    return row;
  }

  async function listPublishRequests(filters = {}, actor) {
    requireUser(actor);
    const params = [];
    const where = [];
    if (!isAdmin(actor)) {
      params.push(actor.id);
      where.push(`pr.requested_by=$${params.length}`);
    }
    if (filters.status) {
      params.push(String(filters.status));
      where.push(`pr.status=$${params.length}`);
    }
    if (filters.resourceType || filters.resource_type) {
      params.push(normalizeResourceType(filters.resourceType || filters.resource_type));
      where.push(`pr.resource_type=$${params.length}`);
    }
    const limit = Math.min(500, Math.max(1, Number(filters.limit) || 100));
    params.push(limit);
    const rows = await query(
      `SELECT pr.*, requester.username AS requester_username, reviewer.username AS reviewer_username
       FROM public_publish_requests pr
       JOIN app_users requester ON requester.id=pr.requested_by
       LEFT JOIN app_users reviewer ON reviewer.id=pr.reviewed_by
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY pr.created_at DESC LIMIT $${params.length}`,
      params,
    );
    return enrichResourceNames(rows.rows);
  }

  function requestMetadata(request) {
    const headers = request?.headers || {};
    return {
      ipAddress: String(request?.socket?.remoteAddress || headers["x-forwarded-for"] || "").split(",")[0].trim().slice(0, 200),
      userAgent: String(headers["user-agent"] || "").slice(0, 1000),
    };
  }

  async function writeAudit(entry = {}) {
    const metadata = requestMetadata(entry.request);
    const actorUserId = entry.actorUserId || entry.actor_user_id || entry.actor?.id || null;
    const resourceType = entry.resourceType || entry.resource_type
      ? normalizeResourceType(entry.resourceType || entry.resource_type)
      : "";
    const resourceIdValue = entry.resourceId || entry.resource_id;
    const resourceId = resourceIdValue ? normalizeUuid(resourceIdValue, "resource id") : null;
    const action = String(entry.action || "").trim().slice(0, 120);
    if (!action) fail(400, "audit action required");
    const row = (await query(
      `INSERT INTO audit_logs
         (actor_user_id,action,resource_type,resource_id,outcome,ip_address,user_agent,details_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        actorUserId ? normalizeUuid(actorUserId, "actor user id") : null,
        action,
        resourceType,
        resourceId,
        String(entry.outcome || "success").slice(0, 40),
        String(entry.ipAddress || metadata.ipAddress || "").slice(0, 200),
        String(entry.userAgent || metadata.userAgent || "").slice(0, 1000),
        JSON.stringify(entry.details || entry.details_json || {}),
      ],
    )).rows[0];
    return row;
  }

  async function listAuditLogs(filters = {}, actor) {
    requireAdmin(actor);
    const params = [];
    const where = [];
    if (filters.actorUserId || filters.actor_user_id) {
      params.push(normalizeUuid(filters.actorUserId || filters.actor_user_id, "actor user id"));
      where.push(`al.actor_user_id=$${params.length}`);
    }
    if (filters.resourceType || filters.resource_type) {
      params.push(normalizeResourceType(filters.resourceType || filters.resource_type));
      where.push(`al.resource_type=$${params.length}`);
    }
    if (filters.resourceId || filters.resource_id) {
      params.push(normalizeUuid(filters.resourceId || filters.resource_id, "resource id"));
      where.push(`al.resource_id=$${params.length}`);
    }
    if (filters.action) {
      params.push(String(filters.action));
      where.push(`al.action=$${params.length}`);
    }
    if (filters.since) {
      params.push(filters.since);
      where.push(`al.created_at>=$${params.length}`);
    }
    const limit = Math.min(1000, Math.max(1, Number(filters.limit) || 200));
    params.push(limit);
    const rows = await query(
      `SELECT al.*, u.username AS actor_username, u.display_name AS actor_display_name
       FROM audit_logs al LEFT JOIN app_users u ON u.id=al.actor_user_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY al.created_at DESC LIMIT $${params.length}`,
      params,
    );
    return rows.rows;
  }

  function quotedIdentifier(identifier) {
    const value = String(identifier || "");
    if (!SQL_IDENTIFIER_PATTERN.test(value)) fail(400, "invalid SQL identifier");
    return value.split(".").map((part) => `"${part}"`).join(".");
  }

  function buildVisibilitySql(options = {}) {
    const resourceType = normalizeResourceType(options.resourceType || options.resource_type);
    const idExpression = quotedIdentifier(options.idExpression || options.idColumn || "id");
    const permission = normalizePermission(options.permission || PERMISSIONS.VIEW);
    const user = options.user || null;
    const params = Array.isArray(options.params) ? [...options.params] : [];
    if (isAdmin(user)) return { sql: "TRUE", params };
    const clauses = [];
    if (user && (!user.status || user.status === "active")) {
      params.push(resourceType, user.id, permissionsSatisfying(permission));
      const typeParam = `$${params.length - 2}`;
      const userParam = `$${params.length - 1}`;
      const permissionParam = `$${params.length}`;
      clauses.push(
        `EXISTS (SELECT 1 FROM asset_acl access_acl WHERE access_acl.resource_type=${typeParam} ` +
        `AND access_acl.resource_id=${idExpression} AND access_acl.user_id=${userParam} ` +
        `AND access_acl.permission=ANY(${permissionParam}::text[]) ` +
        "AND (access_acl.expires_at IS NULL OR access_acl.expires_at>now()))",
      );
    }
    if (options.includePublic !== false && [PERMISSIONS.VIEW, PERMISSIONS.USE].includes(permission)) {
      params.push(resourceType);
      clauses.push(
        `EXISTS (SELECT 1 FROM public_publish_requests access_public WHERE access_public.resource_type=$${params.length} ` +
        `AND access_public.resource_id=${idExpression} AND access_public.status='approved' ` +
        "AND access_public.published_at IS NOT NULL AND access_public.unpublished_at IS NULL)",
      );
    }
    return { sql: clauses.length ? `(${clauses.join(" OR ")})` : "FALSE", params };
  }

  return Object.freeze({
    ROLES,
    PERMISSIONS,
    PLATFORM_PERMISSIONS,
    USER_PERMISSIONS: PLATFORM_PERMISSIONS,
    PERMISSION_TEMPLATES,
    SCHEMA_SQL,
    SCHEMA_MIGRATIONS,
    initializeSchema,
    initialize: initializeSchema,
    ensureSchema: initializeSchema,
    publicUser,
    isAdmin,
    isRegularUser,
    requireUser,
    requireAdmin,
    requireRegularUser,
    extractToken,
    createSession,
    issueSession: createSession,
    authenticateToken,
    authenticateRequest: authenticateToken,
    resolveSession: authenticateToken,
    revokeSession,
    revokeUserSessions,
    cleanupExpiredSessions,
    listUsers,
    setUserPermissions,
    hasPlatformPermission,
    requirePlatformPermission,
    setUserStatus,
    enableUser,
    disableUser,
    getAssetPermissions,
    hasAssetPermission,
    canAccessAsset: hasAssetPermission,
    requireAssetPermission,
    requireAssetAccess: requireAssetPermission,
    grantAssetPermissions,
    grantAssetPermission: grantAssetPermissions,
    setAssetPermissions,
    setAssetAcl: setAssetPermissions,
    revokeAssetPermissions,
    revokeAssetPermission: revokeAssetPermissions,
    listAssetAcl,
    ensureAssetOwner,
    createShareInvitation,
    acceptShareInvitation,
    declineShareInvitation: (invitationId, actor) => updateShareInvitationStatus(invitationId, actor, "declined"),
    revokeShareInvitation: (invitationId, actor) => updateShareInvitationStatus(invitationId, actor, "revoked"),
    listShareInvitations,
    createPublishRequest,
    applyForPublication: createPublishRequest,
    reviewPublishRequest,
    reviewPublication: reviewPublishRequest,
    cancelPublishRequest,
    unpublishResource,
    listPublishRequests,
    isPublicResource,
    writeAudit,
    logAudit: writeAudit,
    audit: writeAudit,
    listAuditLogs,
    buildVisibilitySql,
    buildVisibilityPredicate: buildVisibilitySql,
    resourceVisibilitySql: buildVisibilitySql,
    visibilityWhere: buildVisibilitySql,
  });
}

module.exports = { createAccessControl };
