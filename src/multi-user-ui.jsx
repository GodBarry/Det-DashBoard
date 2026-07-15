import React, { useEffect, useId, useMemo, useState } from "react";
import {
  Ban,
  Check,
  CheckCircle2,
  ChevronLeft,
  ClipboardCheck,
  Clock3,
  Database,
  Eye,
  Globe2,
  Hand,
  Inbox,
  KeyRound,
  Link2,
  ListChecks,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RotateCw,
  Send,
  ShieldCheck,
  Trash2,
  Unlock,
  UserPlus,
  UserCheck,
  Users,
  X,
  XCircle,
} from "lucide-react";

const DEFAULT_ENDPOINTS = {
  shares: "/api/shares",
  shareRecipients: "/api/users?shareable=1",
  users: "/api/admin/users",
  publicRequestSubmissions: "/api/public-requests",
  publicRequests: "/api/admin/public-requests",
  publicAssets: "/api/admin/public-assets",
  annotationTasks: "/api/annotation-tasks",
  auditLogs: "/api/admin/audit",
  acl: "/api/acl",
};

const ROLE_OPTIONS = [
  { value: "user", label: "普通用户" },
  { value: "admin", label: "管理员" },
];

const PERMISSION_OPTIONS = [
  { value: "datasets.import", label: "导入数据" },
  { value: "datasets.annotate", label: "标注数据" },
  { value: "datasets.share", label: "共享数据" },
  { value: "assets.register", label: "登记资产" },
  { value: "assets.use", label: "使用资产" },
  { value: "assets.share", label: "共享资产" },
  { value: "training.run", label: "运行训练" },
  { value: "inference.run", label: "运行推理" },
];

const SHARE_PERMISSIONS = Object.freeze({
  "asset:view": ["asset:view"],
  "asset:edit": ["asset:view", "asset:use", "asset:edit"],
});

const ACL_PERMISSION_OPTIONS = [
  { value: "asset:view", label: "查看" },
  { value: "asset:use", label: "使用" },
  { value: "asset:edit", label: "编辑" },
  { value: "asset:delete", label: "删除" },
  { value: "asset:share", label: "分享" },
  { value: "asset:publish", label: "公开" },
  { value: "asset:manage_acl", label: "管理 ACL" },
];

const STATUS_LABELS = {
  pending: "待处理",
  approved: "已通过",
  rejected: "已拒绝",
  declined: "已拒绝",
  revoked: "已撤销",
  cancelled: "已取消",
  expired: "已过期",
  open: "进行中",
  active: "进行中",
  available: "待领取",
  claimed: "进行中",
  in_progress: "进行中",
  submitted: "待审核",
  review: "待审核",
  pending_review: "待审核",
  completed: "已完成",
  done: "已完成",
};

function joinUrl(baseUrl, path) {
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

async function requestJson(fetcher, url, options = {}) {
  if (typeof fetcher !== "function") throw new Error("当前环境未提供 fetch，请通过 fetcher prop 注入请求函数。");
  const hasBody = options.body !== undefined && options.body !== null;
  const response = await fetcher(url, {
    ...options,
    headers: {
      ...(hasBody ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    let message = `请求失败 (${response.status})`;
    try {
      const detail = await response.json();
      message = detail.message || detail.error || message;
    } catch {
      // Keep the status-based message when the response has no JSON body.
    }
    throw new Error(message);
  }
  if (response.status === 204) return null;
  const contentType = response.headers?.get?.("content-type") || "";
  return contentType.includes("json") || typeof response.json === "function" ? response.json() : null;
}

function toBody(payload) {
  return JSON.stringify(payload || {});
}

export function createMultiUserApi({
  fetcher = globalThis.fetch,
  baseUrl = "",
  endpoints = {},
} = {}) {
  const paths = { ...DEFAULT_ENDPOINTS, ...endpoints };
  const request = (path, options) => requestJson(fetcher, joinUrl(baseUrl, path), options);

  return {
    listUsers: () => request(paths.users),
    listShareRecipients: () => request(paths.shareRecipients),
    updateUser: (userId, payload) => request(`${paths.users}/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: toBody(payload),
    }),
    updateUserPermissions: (userId, permissions) => request(`/api/users/${encodeURIComponent(userId)}/permissions`, {
      method: "PUT",
      body: toBody({ permissions }),
    }),
    createShare: (payload) => request(paths.shares, { method: "POST", body: toBody(payload) }),
    listShares: () => request(paths.shares),
    acceptShare: (invitationId) => request(`${paths.shares}/${encodeURIComponent(invitationId)}/accept`, { method: "POST" }),
    declineShare: (invitationId) => request(`${paths.shares}/${encodeURIComponent(invitationId)}/decline`, { method: "POST" }),
    revokeShare: (invitationId) => request(`${paths.shares}/${encodeURIComponent(invitationId)}/revoke`, { method: "POST" }),
    createPublicRequest: (payload) => request(paths.publicRequestSubmissions, { method: "POST", body: toBody(payload) }),
    listMyPublicRequests: () => request(paths.publicRequestSubmissions),
    cancelPublicRequest: (requestId) => request(`${paths.publicRequestSubmissions}/${encodeURIComponent(requestId)}`, { method: "DELETE" }),
    listPublicRequests: () => request(paths.publicRequests),
    reviewPublicRequest: (requestId, decision, note = "") => request(
      `${paths.publicRequests}/${encodeURIComponent(requestId)}/review`,
      { method: "POST", body: toBody({ decision, note }) },
    ),
    listPublicAssets: () => request(paths.publicAssets),
    removePublicAsset: (asset) => request(`${paths.publicAssets}/${encodeURIComponent(entityId(asset))}`, {
      method: "DELETE",
      body: toBody({ resourceType: asset?.resourceType || asset?.resource_type || asset?.type }),
    }),
    listMyPermissions: () => request("/api/me/permissions"),
    listAnnotationTasks: () => request(paths.annotationTasks),
    createAnnotationTask: (payload) => request(paths.annotationTasks, { method: "POST", body: toBody(payload) }),
    listAnnotationItems: (taskId) => request(`${paths.annotationTasks}/${encodeURIComponent(taskId)}/items?pageSize=500`),
    claimAnnotationTask: (taskId) => request(`${paths.annotationTasks}/${encodeURIComponent(taskId)}/claim`, { method: "POST" }),
    lockAnnotationItem: (itemId) => request(`/api/annotation-items/${encodeURIComponent(itemId)}/lock`, { method: "POST" }),
    renewAnnotationLock: (lockToken) => request(`/api/annotation-locks/${encodeURIComponent(lockToken)}/renew`, { method: "POST" }),
    releaseAnnotationLock: (lockToken) => request(`/api/annotation-locks/${encodeURIComponent(lockToken)}`, { method: "DELETE" }),
    submitAnnotationItem: (itemId, payload = {}) => request(`/api/annotation-items/${encodeURIComponent(itemId)}/submit`, {
      method: "POST",
      body: toBody(payload),
    }),
    reviewAnnotationItem: (itemId, decision, comment = "") => request(
      `/api/annotation-items/${encodeURIComponent(itemId)}/review`,
      { method: "POST", body: toBody({ decision, comment }) },
    ),
    listAuditLogs: () => request(paths.auditLogs),
    listAssetAcl: (resourceType, resourceId) => request(`${paths.acl}/${encodeURIComponent(resourceType)}/${encodeURIComponent(resourceId)}`),
    grantAssetAcl: (resourceType, resourceId, payload) => request(`${paths.acl}/${encodeURIComponent(resourceType)}/${encodeURIComponent(resourceId)}`, { method: "POST", body: toBody(payload) }),
    setAssetAcl: (resourceType, resourceId, userId, payload) => request(`${paths.acl}/${encodeURIComponent(resourceType)}/${encodeURIComponent(resourceId)}/${encodeURIComponent(userId)}`, { method: "PUT", body: toBody(payload) }),
    revokeAssetAcl: (resourceType, resourceId, userId) => request(`${paths.acl}/${encodeURIComponent(resourceType)}/${encodeURIComponent(resourceId)}/${encodeURIComponent(userId)}`, { method: "DELETE" }),
  };
}

function useClient(api, fetcher, baseUrl, endpoints) {
  const endpointsKey = JSON.stringify(endpoints || {});
  return useMemo(
    () => api || createMultiUserApi({ fetcher: fetcher || globalThis.fetch, baseUrl, endpoints }),
    [api, fetcher, baseUrl, endpointsKey],
  );
}

function cx(...values) {
  return values.filter(Boolean).join(" ");
}

function unwrapList(payload, keys) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
    if (Array.isArray(payload?.data?.[key])) return payload.data[key];
  }
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function entityId(entity) {
  return entity?.id
    ?? entity?._id
    ?? entity?.userId
    ?? entity?.user_id
    ?? entity?.requestId
    ?? entity?.request_id
    ?? entity?.taskId
    ?? entity?.task_id
    ?? entity?.assetId
    ?? entity?.asset_id
    ?? entity?.resourceId
    ?? entity?.resource_id
    ?? "";
}

function entityName(entity, fallback = "未命名") {
  return entity?.name || entity?.resource_name || entity?.title || entity?.username || entity?.displayName || entity?.fileName || fallback;
}

function formatTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || "操作失败");
}

function notifyError(error, onError, setError) {
  setError?.(errorMessage(error));
  onError?.(error);
}

function IconButton({ label, children, className, style, ...props }) {
  return (
    <button
      type="button"
      className={className}
      title={label}
      aria-label={label}
      style={{ ...ui.iconButton, ...style }}
      {...props}
    >
      {children}
    </button>
  );
}

function ActionButton({ icon: Icon, children, busy, disabled, className = "ghost", style, ...props }) {
  return (
    <button
      type="button"
      className={className}
      style={{ ...ui.actionButton, ...style }}
      {...props}
      disabled={busy || disabled}
    >
      {busy ? <Loader2 size={15} aria-hidden="true" /> : Icon ? <Icon size={15} aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
}

function StatusBadge({ status }) {
  const normalized = String(status || "pending").toLowerCase();
  const tone = ["approved", "completed", "done"].includes(normalized)
    ? "success"
    : normalized === "rejected"
      ? "danger"
      : ["claimed", "in_progress"].includes(normalized)
        ? "active"
        : "pending";
  return (
    <span className={`multi-user-status multi-user-status-${tone}`} style={{ ...ui.status, ...ui[`status_${tone}`] }}>
      {STATUS_LABELS[normalized] || status || "待处理"}
    </span>
  );
}

function EmptyState({ icon: Icon = Inbox, children }) {
  return (
    <div className="empty-state multi-user-empty" style={ui.empty}>
      <Icon size={24} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

function ErrorBanner({ children }) {
  if (!children) return null;
  return <div role="alert" style={ui.error}>{children}</div>;
}

function FeedbackBanner({ message, tone = "success", onClose }) {
  if (!message) return null;
  return (
    <div className={`multi-user-feedback ${tone}`} role={tone === "error" ? "alert" : "status"}>
      {tone === "error" ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
      <span>{message}</span>
      {onClose ? <IconButton label="关闭提示" onClick={onClose}><X size={14} /></IconButton> : null}
    </div>
  );
}

export function ScopeTabs({
  value,
  defaultValue = "mine",
  onChange,
  counts = {},
  disabled = false,
  className = "",
  labels = {},
}) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const current = value ?? internalValue;
  const tabs = [
    { value: "mine", label: labels.mine || "我的", icon: UserCheck },
    { value: "shared", label: labels.shared || "共享给我", icon: Users },
    { value: "public", label: labels.public || "公共", icon: Globe2 },
  ];

  const select = (nextValue) => {
    if (value === undefined) setInternalValue(nextValue);
    onChange?.(nextValue);
  };

  return (
    <div className={cx("multi-user-scope-tabs", className)} role="tablist" aria-label="资产范围" style={ui.segmented}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = current === tab.value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            data-state={active ? "active" : "inactive"}
            onClick={() => select(tab.value)}
            style={{ ...ui.segmentButton, ...(active ? ui.segmentButtonActive : null) }}
          >
            <Icon size={15} aria-hidden="true" />
            <span>{tab.label}</span>
            {counts[tab.value] !== undefined ? <b style={ui.count}>{counts[tab.value]}</b> : null}
          </button>
        );
      })}
    </div>
  );
}

function DialogShell({ open, title, description, icon: Icon, onClose, children, footer, busy = false, className = "" }) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !busy) onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onClose]);

  if (!open) return null;
  return (
    <div
      className="auth-overlay multi-user-dialog-overlay"
      style={ui.overlay}
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose?.()}
    >
      <section className={cx("settings-dialog multi-user-dialog", className)} role="dialog" aria-modal="true" aria-labelledby={titleId} style={ui.dialog}>
        <header style={ui.dialogHeader}>
          <span style={ui.dialogIcon}><Icon size={18} aria-hidden="true" /></span>
          <div style={ui.dialogHeading}>
            <h2 id={titleId} style={ui.dialogTitle}>{title}</h2>
            {description ? <p style={ui.muted}>{description}</p> : null}
          </div>
          <IconButton label="关闭" onClick={onClose} disabled={busy}><X size={17} /></IconButton>
        </header>
        <div style={ui.dialogBody}>{children}</div>
        {footer ? <footer className="settings-actions" style={ui.dialogFooter}>{footer}</footer> : null}
      </section>
    </div>
  );
}

export function ShareDialog({
  open,
  resource,
  users,
  onClose,
  onShare,
  onShared,
  onError,
  api,
  fetcher,
  baseUrl = "",
  endpoints,
  allowExpiration = true,
}) {
  const client = useClient(api, fetcher, baseUrl, endpoints);
  const [recipients, setRecipients] = useState(users || []);
  const [selectedIds, setSelectedIds] = useState([]);
  const [recipientIdentifier, setRecipientIdentifier] = useState("");
  const [permission, setPermission] = useState("asset:view");
  const [expiresAt, setExpiresAt] = useState("");
  const [message, setMessage] = useState("");
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => setRecipients(users || []), [users]);
  useEffect(() => {
    if (!open) return;
    setSelectedIds([]);
    setRecipientIdentifier("");
    setPermission("asset:view");
    setExpiresAt("");
    setMessage("");
    setError("");
    setSuccess("");
    if (users !== undefined) return;
    let cancelled = false;
    setLoadingUsers(true);
    client.listShareRecipients()
      .then((payload) => !cancelled && setRecipients(unwrapList(payload, ["users", "items", "data"])))
      .catch((requestError) => !cancelled && notifyError(requestError, onError, setError))
      .finally(() => !cancelled && setLoadingUsers(false));
    return () => { cancelled = true; };
  }, [open, users, client, onError]);

  const toggleRecipient = (id) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!selectedIds.length && !recipientIdentifier.trim()) {
      setError("请至少选择一个共享对象。");
      return;
    }
    const payload = {
      resourceId: entityId(resource),
      resourceType: resource?.resourceType || resource?.resource_type || resource?.type || "asset",
      permissions: SHARE_PERMISSIONS[permission] || SHARE_PERMISSIONS["asset:view"],
      message: message.trim(),
      ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
    };
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const invitations = [
        ...selectedIds.map((recipientUserId) => ({ ...payload, recipientUserId })),
        ...(recipientIdentifier.trim() ? [{ ...payload, recipientIdentifier: recipientIdentifier.trim() }] : []),
      ];
      const result = onShare
        ? await onShare(invitations, resource)
        : await Promise.all(invitations.map((invitation) => client.createShare(invitation)));
      onShared?.(result, payload);
      setSelectedIds([]);
      setRecipientIdentifier("");
      setSuccess(`已发出 ${invitations.length} 个分享邀请。`);
    } catch (requestError) {
      notifyError(requestError, onError, setError);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogShell
      open={open}
      title="共享资产"
      description={resource ? entityName(resource) : "选择共享对象与访问权限"}
      icon={Link2}
      onClose={onClose}
      busy={submitting}
      footer={(
        <>
          <ActionButton onClick={onClose} disabled={submitting}>取消</ActionButton>
          <ActionButton icon={Send} className="primary" busy={submitting} onClick={submit}>确认共享</ActionButton>
        </>
      )}
    >
      <form onSubmit={submit} style={ui.form}>
        <ErrorBanner>{error}</ErrorBanner>
        <FeedbackBanner message={success} onClose={() => setSuccess("")} />
        <fieldset style={ui.fieldset}>
          <legend style={ui.label}>访问权限</legend>
          <div style={ui.segmented}>
            {[
              { value: "asset:view", label: "仅查看", icon: Eye },
              { value: "asset:edit", label: "可编辑", icon: Pencil },
            ].map((option) => {
              const Icon = option.icon;
              const active = permission === option.value;
              return (
                <button key={option.value} type="button" onClick={() => setPermission(option.value)} style={{ ...ui.segmentButton, ...(active ? ui.segmentButtonActive : null) }}>
                  <Icon size={15} /><span>{option.label}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
        <label style={ui.field}>
          <span style={ui.label}>用户名或邮箱</span>
          <input value={recipientIdentifier} onChange={(event) => setRecipientIdentifier(event.target.value)} style={ui.input} placeholder="输入一个用户名或邮箱" />
        </label>
        <div style={ui.field}>
          <span style={ui.label}>共享给</span>
          <div style={ui.recipientList}>
            {loadingUsers ? <div style={ui.loading}><Loader2 size={17} /> 正在加载用户</div> : null}
            {!loadingUsers && !recipients.length ? <EmptyState>暂无可共享用户</EmptyState> : null}
            {recipients.map((user) => {
              const id = entityId(user);
              const checked = selectedIds.includes(id);
              return (
                <label key={id} style={{ ...ui.checkRow, ...(checked ? ui.checkRowActive : null) }}>
                  <input type="checkbox" checked={checked} onChange={() => toggleRecipient(id)} />
                  <span style={ui.avatar}>{(entityName(user, "?").trim()[0] || "?").toUpperCase()}</span>
                  <span style={ui.rowMain}><b>{entityName(user)}</b><small style={ui.muted}>{user.email || user.department || user.role || ""}</small></span>
                  {checked ? <Check size={16} color="var(--accent, #0f9d97)" /> : null}
                </label>
              );
            })}
          </div>
        </div>
        {allowExpiration ? (
          <label style={ui.field}>
            <span style={ui.label}>到期时间（可选）</span>
            <input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} style={ui.input} />
          </label>
        ) : null}
        <label style={ui.field}>
          <span style={ui.label}>附言（可选）</span>
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={3} maxLength={300} style={ui.textarea} placeholder="说明共享用途" />
        </label>
      </form>
    </DialogShell>
  );
}

export function PublicRequestDialog({
  open,
  resource,
  onClose,
  onRequest,
  onRequested,
  onError,
  api,
  fetcher,
  baseUrl = "",
  endpoints,
  defaultReason = "",
}) {
  const client = useClient(api, fetcher, baseUrl, endpoints);
  const [reason, setReason] = useState(defaultReason);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (open) {
      setReason(defaultReason);
      setError("");
      setSuccess("");
    }
  }, [open, defaultReason, resource]);

  const submit = async (event) => {
    event.preventDefault();
    if (!reason.trim()) {
      setError("请填写公开原因。");
      return;
    }
    const payload = {
      resourceId: entityId(resource),
      resourceType: resource?.type || resource?.resourceType || "asset",
      reason: reason.trim(),
    };
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const result = onRequest ? await onRequest(payload, resource) : await client.createPublicRequest(payload);
      onRequested?.(result, payload);
      setSuccess("公开申请已提交，等待管理员审核。");
    } catch (requestError) {
      notifyError(requestError, onError, setError);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogShell
      open={open}
      title="申请公开"
      description={resource ? entityName(resource) : "提交后由管理员审核"}
      icon={Globe2}
      onClose={onClose}
      busy={submitting}
      footer={(
        <>
          <ActionButton onClick={onClose} disabled={submitting}>取消</ActionButton>
          <ActionButton icon={Send} className="primary" busy={submitting} onClick={submit}>提交申请</ActionButton>
        </>
      )}
    >
      <form onSubmit={submit} style={ui.form}>
        <ErrorBanner>{error}</ErrorBanner>
        <FeedbackBanner message={success} onClose={() => setSuccess("")} />
        <div style={ui.notice}>
          <Globe2 size={17} aria-hidden="true" />
          <span>公开后，所有有权访问平台的用户都可以查看该资产。</span>
        </div>
        <label style={ui.field}>
          <span style={ui.label}>公开原因</span>
          <textarea autoFocus value={reason} onChange={(event) => setReason(event.target.value)} rows={5} maxLength={500} style={ui.textarea} placeholder="说明资产用途、适用范围和公开价值" />
          <small style={{ ...ui.muted, textAlign: "right" }}>{reason.length}/500</small>
        </label>
      </form>
    </DialogShell>
  );
}

function groupedAcl(rows) {
  const groups = new Map();
  for (const row of rows) {
    const userId = row.user_id || row.userId;
    if (!groups.has(userId)) groups.set(userId, { userId, name: row.display_name || row.username || userId, permissions: [] });
    groups.get(userId).permissions.push(row.permission);
  }
  return [...groups.values()];
}

export function AdminCenter({
  api,
  fetcher,
  baseUrl = "",
  endpoints,
  users: usersProp,
  publicRequests: requestsProp,
  publicAssets: assetsProp,
  auditLogs: auditLogsProp,
  initialSection = "users",
  onUserChange,
  onRequestReviewed,
  onAssetRemoved,
  onError,
  className = "",
}) {
  const client = useClient(api, fetcher, baseUrl, endpoints);
  const [section, setSection] = useState(initialSection);
  const [users, setUsers] = useState(usersProp || []);
  const [requests, setRequests] = useState(requestsProp || []);
  const [assets, setAssets] = useState(assetsProp || []);
  const [auditLogs, setAuditLogs] = useState(auditLogsProp || []);
  const [aclRows, setAclRows] = useState([]);
  const [aclResourceType, setAclResourceType] = useState("project");
  const [aclResourceId, setAclResourceId] = useState("");
  const [aclUserId, setAclUserId] = useState("");
  const [aclPermissions, setAclPermissions] = useState(["asset:view"]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => { if (usersProp !== undefined) setUsers(usersProp); }, [usersProp]);
  useEffect(() => { if (requestsProp !== undefined) setRequests(requestsProp); }, [requestsProp]);
  useEffect(() => { if (assetsProp !== undefined) setAssets(assetsProp); }, [assetsProp]);
  useEffect(() => { if (auditLogsProp !== undefined) setAuditLogs(auditLogsProp); }, [auditLogsProp]);

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const [usersPayload, requestsPayload, assetsPayload, auditPayload] = await Promise.all([
        usersProp === undefined ? client.listUsers() : usersProp,
        requestsProp === undefined ? client.listPublicRequests() : requestsProp,
        assetsProp === undefined ? client.listPublicAssets() : assetsProp,
        auditLogsProp === undefined ? client.listAuditLogs() : auditLogsProp,
      ]);
      if (usersProp === undefined) setUsers(unwrapList(usersPayload, ["users", "items", "data"]));
      if (requestsProp === undefined) setRequests(unwrapList(requestsPayload, ["requests", "items", "data"]));
      if (assetsProp === undefined) setAssets(unwrapList(assetsPayload, ["assets", "items", "data"]));
      if (auditLogsProp === undefined) setAuditLogs(unwrapList(auditPayload, ["logs", "items", "data"]));
    } catch (requestError) {
      notifyError(requestError, onError, setError);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [client]);

  const updateUser = async (user, patch) => {
    const id = entityId(user);
    const previous = users;
    setBusyKey(`user:${id}`);
    setSuccess("");
    setUsers((current) => current.map((item) => entityId(item) === id ? { ...item, ...patch } : item));
    try {
      const result = onUserChange
        ? await onUserChange(user, patch)
        : patch.permissions
          ? await client.updateUserPermissions(id, Object.keys(patch.permissions).filter((key) => patch.permissions[key]))
          : await client.updateUser(id, patch);
      if (result && typeof result === "object") {
        const updated = result.user || result;
        setUsers((current) => current.map((item) => entityId(item) === id ? { ...item, ...updated } : item));
      }
      setSuccess(`已更新 ${entityName(user)}。`);
    } catch (requestError) {
      setUsers(previous);
      notifyError(requestError, onError, setError);
    } finally {
      setBusyKey("");
    }
  };

  const reviewRequest = async (requestItem, decision) => {
    const id = entityId(requestItem);
    setBusyKey(`request:${id}`);
    setSuccess("");
    try {
      const result = onRequestReviewed
        ? await onRequestReviewed(requestItem, decision)
        : await client.reviewPublicRequest(id, decision);
      setRequests((current) => current.map((item) => entityId(item) === id ? { ...item, ...(result?.request || {}), status: decision } : item));
      setSuccess(decision === "approved" ? "公开申请已通过。" : "公开申请已退回。");
    } catch (requestError) {
      notifyError(requestError, onError, setError);
    } finally {
      setBusyKey("");
    }
  };

  const removeAsset = async (asset) => {
    const id = entityId(asset);
    setBusyKey(`asset:${id}`);
    try {
      if (onAssetRemoved) await onAssetRemoved(asset);
      else await client.removePublicAsset(asset);
      setAssets((current) => current.filter((item) => entityId(item) !== id));
      setSuccess("资产已取消公开。");
    } catch (requestError) {
      notifyError(requestError, onError, setError);
    } finally {
      setBusyKey("");
    }
  };

  const loadAcl = async () => {
    if (!aclResourceType.trim() || !aclResourceId.trim()) {
      setError("请输入资产类型和资产 ID。");
      return;
    }
    setBusyKey("acl:load");
    setError("");
    try {
      const payload = await client.listAssetAcl(aclResourceType.trim(), aclResourceId.trim());
      setAclRows(unwrapList(payload, ["acl", "items", "data"]));
    } catch (requestError) {
      notifyError(requestError, onError, setError);
    } finally {
      setBusyKey("");
    }
  };

  const saveAcl = async (userId = aclUserId, permissions = aclPermissions, exists = false) => {
    if (!userId || !permissions.length) {
      setError("请选择用户和至少一项资产权限。");
      return;
    }
    setBusyKey(`acl:${userId}`);
    setError("");
    setSuccess("");
    try {
      if (exists) await client.setAssetAcl(aclResourceType, aclResourceId, userId, { permissions });
      else await client.grantAssetAcl(aclResourceType, aclResourceId, { userId, permissions });
      await loadAcl();
      setSuccess(exists ? "ACL 权限已更新。" : "ACL 授权已添加。");
    } catch (requestError) {
      notifyError(requestError, onError, setError);
    } finally {
      setBusyKey("");
    }
  };

  const revokeAcl = async (userId) => {
    setBusyKey(`acl:${userId}`);
    setError("");
    setSuccess("");
    try {
      await client.revokeAssetAcl(aclResourceType, aclResourceId, userId);
      await loadAcl();
      setSuccess("该用户的资产授权已撤销。");
    } catch (requestError) {
      notifyError(requestError, onError, setError);
    } finally {
      setBusyKey("");
    }
  };

  const sections = [
    { value: "users", label: "用户权限", icon: ShieldCheck, count: users.length },
    { value: "requests", label: "公开申请", icon: ClipboardCheck, count: requests.filter((item) => ["pending", "requested", undefined].includes(item.status)).length },
    { value: "assets", label: "公共资产", icon: Database, count: assets.length },
    { value: "acl", label: "资产 ACL", icon: KeyRound, count: aclRows.length },
    { value: "audit", label: "审计日志", icon: ListChecks, count: auditLogs.length },
  ];

  return (
    <section className={cx("multi-user-admin-center", className)} style={ui.panel}>
      <header style={ui.panelHeader}>
        <div>
          <h2 style={ui.panelTitle}>管理中心</h2>
          <p style={ui.muted}>管理用户访问范围、公开审批与公共资产。</p>
        </div>
        <IconButton label="刷新" onClick={refresh} disabled={loading}><RotateCw size={17} /></IconButton>
      </header>
      <nav role="tablist" aria-label="管理中心" style={ui.adminTabs}>
        {sections.map((item) => {
          const Icon = item.icon;
          const active = section === item.value;
          return (
            <button key={item.value} type="button" role="tab" aria-selected={active} onClick={() => setSection(item.value)} style={{ ...ui.adminTab, ...(active ? ui.adminTabActive : null) }}>
              <Icon size={16} /><span>{item.label}</span><b style={ui.count}>{item.count}</b>
            </button>
          );
        })}
      </nav>
      <ErrorBanner>{error}</ErrorBanner>
      <FeedbackBanner message={success} onClose={() => setSuccess("")} />
      {loading ? <div style={ui.loading}><Loader2 size={18} /> 正在加载管理数据</div> : null}
      {!loading && section === "users" ? (
        <div style={ui.table}>
          <div style={{ ...ui.tableRow, ...ui.tableHeader, gridTemplateColumns: "minmax(190px, 1.2fr) 130px minmax(250px, 1fr) 86px" }}>
            <span>用户</span><span>角色</span><span>权限</span><span>状态</span>
          </div>
          {!users.length ? <EmptyState icon={Users}>暂无用户</EmptyState> : users.map((user) => {
            const id = entityId(user);
            const permissionSet = new Set(Array.isArray(user.permissions) ? user.permissions : Object.keys(user.permissions || {}).filter((key) => user.permissions[key]));
            const busy = busyKey === `user:${id}`;
            return (
              <div key={id} style={{ ...ui.tableRow, gridTemplateColumns: "minmax(190px, 1.2fr) 130px minmax(250px, 1fr) 86px" }}>
                <span style={ui.rowMain}><b>{entityName(user)}</b><small style={ui.muted}>{user.email || user.department || "--"}</small></span>
                <select value={user.role || "user"} disabled style={ui.select} aria-label={`${entityName(user)}的角色`}>
                  {ROLE_OPTIONS.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                </select>
                <span style={ui.permissionGroup}>
                  {PERMISSION_OPTIONS.map((permission) => {
                    const checked = permissionSet.has(permission.value);
                    return (
                      <label key={permission.value} style={ui.inlineCheck}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={busy}
                          onChange={(event) => updateUser(user, {
                            permissions: {
                              ...(Array.isArray(user.permissions) ? Object.fromEntries(user.permissions.map((item) => [item, true])) : user.permissions),
                              [permission.value]: event.target.checked,
                            },
                          })}
                        />
                        <span>{permission.label}</span>
                      </label>
                    );
                  })}
                </span>
                <label style={ui.switchLabel}>
                  <input type="checkbox" checked={user.status !== "disabled"} disabled={busy} onChange={(event) => updateUser(user, { status: event.target.checked ? "active" : "disabled" })} />
                  <span>{user.enabled !== false && user.status !== "disabled" ? "启用" : "停用"}</span>
                </label>
              </div>
            );
          })}
        </div>
      ) : null}
      {!loading && section === "requests" ? (
        <div style={ui.list}>
          {!requests.length ? <EmptyState icon={ClipboardCheck}>暂无公开申请</EmptyState> : requests.map((requestItem) => {
            const id = entityId(requestItem);
            const pending = !requestItem.status || ["pending", "requested"].includes(requestItem.status);
            const busy = busyKey === `request:${id}`;
            return (
              <article key={id} style={ui.listRow}>
                <span style={ui.listIcon}><Globe2 size={17} /></span>
                <span style={ui.rowMain}>
                  <b>{entityName(requestItem.resource || requestItem)}</b>
                  <small style={ui.muted}>{requestItem.requesterName || requestItem.requester?.name || "未知申请人"} · {formatTime(requestItem.createdAt)}</small>
                  {requestItem.reason ? <span style={ui.reason}>{requestItem.reason}</span> : null}
                </span>
                <StatusBadge status={requestItem.status || "pending"} />
                {pending ? (
                  <span style={ui.actions}>
                    <ActionButton icon={XCircle} busy={busy} onClick={() => reviewRequest(requestItem, "rejected")}>拒绝</ActionButton>
                    <ActionButton icon={CheckCircle2} className="primary" busy={busy} onClick={() => reviewRequest(requestItem, "approved")}>通过</ActionButton>
                  </span>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
      {!loading && section === "assets" ? (
        <div style={ui.list}>
          {!assets.length ? <EmptyState icon={Database}>暂无公共资产</EmptyState> : assets.map((asset) => {
            const id = entityId(asset);
            const busy = busyKey === `asset:${id}`;
            return (
              <article key={id} style={ui.listRow}>
                <span style={ui.listIcon}><Database size={17} /></span>
                <span style={ui.rowMain}>
                  <b>{entityName(asset)}</b>
                  <small style={ui.muted}>{asset.type || asset.assetType || "资产"} · {asset.ownerName || asset.owner?.name || "--"} · {formatTime(asset.publishedAt || asset.updatedAt)}</small>
                </span>
                <StatusBadge status="approved" />
                <ActionButton icon={Ban} busy={busy} onClick={() => removeAsset(asset)}>取消公开</ActionButton>
              </article>
            );
          })}
        </div>
      ) : null}
      {!loading && section === "acl" ? (
        <div className="multi-user-acl" style={ui.stack}>
          <div className="multi-user-acl-query">
            <label style={ui.field}><span style={ui.label}>资产类型</span><input style={ui.input} value={aclResourceType} onChange={(event) => setAclResourceType(event.target.value)} placeholder="project / model / runtime_env" /></label>
            <label style={ui.field}><span style={ui.label}>资产 ID</span><input style={ui.input} value={aclResourceId} onChange={(event) => setAclResourceId(event.target.value)} placeholder="UUID" /></label>
            <ActionButton icon={RotateCw} busy={busyKey === "acl:load"} onClick={loadAcl}>读取明细</ActionButton>
          </div>
          <div className="multi-user-acl-grant">
            <select style={ui.select} value={aclUserId} onChange={(event) => setAclUserId(event.target.value)} aria-label="授权用户">
              <option value="">选择用户</option>
              {users.map((user) => <option key={entityId(user)} value={entityId(user)}>{entityName(user)}</option>)}
            </select>
            <span style={ui.permissionGroup}>
              {ACL_PERMISSION_OPTIONS.map((permission) => (
                <label key={permission.value} style={ui.inlineCheck}>
                  <input type="checkbox" checked={aclPermissions.includes(permission.value)} onChange={(event) => setAclPermissions((current) => event.target.checked ? [...new Set([...current, permission.value])] : current.filter((item) => item !== permission.value))} />
                  <span>{permission.label}</span>
                </label>
              ))}
            </span>
            <ActionButton icon={UserPlus} className="primary" busy={busyKey === `acl:${aclUserId}`} onClick={() => saveAcl()}>逐用户授权</ActionButton>
          </div>
          <div style={ui.list}>
            {!aclRows.length ? <EmptyState icon={KeyRound}>输入资产后读取 ACL 明细</EmptyState> : groupedAcl(aclRows).map((entry) => (
              <AclUserRow key={entry.userId} entry={entry} busy={busyKey === `acl:${entry.userId}`} onSave={(permissions) => saveAcl(entry.userId, permissions, true)} onRevoke={() => revokeAcl(entry.userId)} />
            ))}
          </div>
        </div>
      ) : null}
      {!loading && section === "audit" ? (
        <div className="multi-user-audit" style={ui.table}>
          <div style={{ ...ui.tableRow, ...ui.tableHeader, gridTemplateColumns: "150px minmax(160px, .8fr) minmax(180px, 1fr) minmax(220px, 1.4fr)" }}>
            <span>时间</span><span>操作人</span><span>动作</span><span>资源 / 结果</span>
          </div>
          {!auditLogs.length ? <EmptyState icon={ListChecks}>暂无审计日志</EmptyState> : auditLogs.map((log) => (
            <div key={entityId(log)} style={{ ...ui.tableRow, gridTemplateColumns: "150px minmax(160px, .8fr) minmax(180px, 1fr) minmax(220px, 1.4fr)" }}>
              <span style={ui.muted}>{formatTime(log.created_at || log.createdAt)}</span>
              <span>{log.actor_display_name || log.actor_username || "系统"}</span>
              <code>{log.action || "--"}</code>
              <span style={ui.rowMain}><b>{log.resource_type || "平台"} {String(log.resource_id || "").slice(0, 12)}</b><small style={ui.muted}>{log.outcome || "success"}</small></span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function AclUserRow({ entry, busy, onSave, onRevoke }) {
  const [permissions, setPermissions] = useState(entry.permissions);
  useEffect(() => setPermissions(entry.permissions), [entry.permissions.join("|")]);
  return (
    <article className="multi-user-acl-row" style={ui.listRow}>
      <span style={ui.listIcon}><UserCheck size={17} /></span>
      <span style={ui.rowMain}><b>{entry.name}</b><small style={ui.muted}>{entry.userId}</small></span>
      <span style={ui.permissionGroup}>
        {ACL_PERMISSION_OPTIONS.map((permission) => (
          <label key={permission.value} style={ui.inlineCheck}>
            <input type="checkbox" disabled={busy} checked={permissions.includes(permission.value)} onChange={(event) => setPermissions((current) => event.target.checked ? [...new Set([...current, permission.value])] : current.filter((item) => item !== permission.value))} />
            <span>{permission.label}</span>
          </label>
        ))}
      </span>
      <span style={ui.actions}>
        <ActionButton icon={Check} busy={busy} disabled={!permissions.length} onClick={() => onSave(permissions)}>改权</ActionButton>
        <ActionButton icon={Trash2} busy={busy} onClick={onRevoke}>撤权</ActionButton>
      </span>
    </article>
  );
}

export function AnnotationTaskPanel({
  api,
  fetcher,
  baseUrl = "",
  endpoints,
  tasks: tasksProp,
  projects = [],
  currentUser,
  onOpenItem,
  onError,
  className = "",
}) {
  const client = useClient(api, fetcher, baseUrl, endpoints);
  const [workspace, setWorkspace] = useState("tasks");
  const [queue, setQueue] = useState("mine");
  const [tasks, setTasks] = useState(tasksProp || []);
  const [shares, setShares] = useState([]);
  const [publicRequests, setPublicRequests] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [selectedTask, setSelectedTask] = useState(null);
  const [items, setItems] = useState([]);
  const [locks, setLocks] = useState({});
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => { if (tasksProp !== undefined) setTasks(tasksProp); }, [tasksProp]);

  const loadWorkspace = async () => {
    setLoading(true);
    setError("");
    try {
      const [taskPayload, sharePayload, publicPayload, permissionPayload] = await Promise.all([
        tasksProp === undefined ? client.listAnnotationTasks() : tasksProp,
        client.listShares(),
        client.listMyPublicRequests(),
        client.listMyPermissions(),
      ]);
      if (tasksProp === undefined) setTasks(unwrapList(taskPayload, ["tasks", "items", "data"]));
      setShares(unwrapList(sharePayload, ["invitations", "shares", "items", "data"]));
      setPublicRequests(unwrapList(publicPayload, ["requests", "items", "data"]));
      setPermissions(unwrapList(permissionPayload, ["permissions", "items", "data"]));
    } catch (requestError) {
      notifyError(requestError, onError, setError);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadWorkspace(); }, [client, tasksProp]);

  const loadItems = async (task = selectedTask) => {
    if (!task) return;
    const id = entityId(task);
    setBusyId(`items:${id}`);
    setError("");
    try {
      const payload = await client.listAnnotationItems(id);
      setItems(unwrapList(payload, ["items", "data"]));
    } catch (requestError) {
      notifyError(requestError, onError, setError);
    } finally {
      setBusyId("");
    }
  };

  const openTask = async (task) => {
    setSelectedTask(task);
    setItems([]);
    await loadItems(task);
  };

  const updateAfterItemAction = async (message) => {
    setSuccess(message);
    await Promise.all([loadItems(), tasksProp === undefined ? client.listAnnotationTasks().then((payload) => setTasks(unwrapList(payload, ["tasks", "items", "data"]))) : Promise.resolve()]);
  };

  const itemForViewer = (item) => ({
    ...item,
    id: item.project_image_id,
    collaboration_item_id: entityId(item),
    display_name: item.display_name || entityName(item),
    annotations: Array.isArray(item.annotation_json) ? item.annotation_json : [],
  });

  const openAnnotationItem = async (item, readOnly = false, existingResult = null) => {
    if (readOnly) {
      onOpenItem?.(itemForViewer(item), { readOnly: true, task: selectedTask });
      return;
    }
    const itemId = entityId(item);
    setBusyId(`item:${itemId}`);
    setError("");
    try {
      const result = existingResult || await client.lockAnnotationItem(itemId);
      const token = result?.lock?.token || locks[itemId];
      if (!token) throw new Error("锁定成功但未返回锁令牌。");
      setLocks((current) => ({ ...current, [itemId]: { token, expiresAt: result?.lock?.expires_at } }));
      const nextItem = { ...item, ...(result?.item || {}) };
      onOpenItem?.(itemForViewer(nextItem), {
        readOnly: false,
        task: selectedTask,
        save: async (annotations) => {
          const response = await client.submitAnnotationItem(itemId, { lockToken: token, submission: annotations });
          setLocks((current) => { const next = { ...current }; delete next[itemId]; return next; });
          await updateAfterItemAction("该图标注已提交审核。");
          return { annotations: response?.item?.annotation_json || annotations };
        },
      });
    } catch (requestError) {
      notifyError(requestError, onError, setError);
    } finally {
      setBusyId("");
    }
  };

  const claimTask = async (task) => {
    const taskId = entityId(task);
    setBusyId(`task:${taskId}`);
    setError("");
    setSuccess("");
    try {
      const result = await client.claimAnnotationTask(taskId);
      await openTask(task);
      const claimedItem = { ...(result?.item || {}), project_image_id: result?.item?.project_image_id };
      if (result?.lock?.token && entityId(claimedItem)) {
        setLocks((current) => ({ ...current, [entityId(claimedItem)]: { token: result.lock.token, expiresAt: result.lock.expires_at } }));
      }
      setSuccess("已领取一条标注并获得编辑锁。");
    } catch (requestError) {
      notifyError(requestError, onError, setError);
    } finally {
      setBusyId("");
    }
  };

  const renewLock = async (item) => {
    const itemId = entityId(item);
    const token = locks[itemId]?.token;
    if (!token) return setError("当前页面没有该条目的锁令牌，请重新锁定。");
    setBusyId(`item:${itemId}`);
    try {
      const result = await client.renewAnnotationLock(token);
      setLocks((current) => ({ ...current, [itemId]: { token, expiresAt: result?.lock?.expires_at } }));
      setSuccess("编辑锁已续期。");
      await loadItems();
    } catch (requestError) {
      notifyError(requestError, onError, setError);
    } finally { setBusyId(""); }
  };

  const releaseLock = async (item) => {
    const itemId = entityId(item);
    const token = locks[itemId]?.token;
    if (!token) return setError("当前页面没有该条目的锁令牌，无法释放。");
    setBusyId(`item:${itemId}`);
    try {
      await client.releaseAnnotationLock(token);
      setLocks((current) => { const next = { ...current }; delete next[itemId]; return next; });
      await updateAfterItemAction("编辑锁已释放。");
    } catch (requestError) {
      notifyError(requestError, onError, setError);
    } finally { setBusyId(""); }
  };

  const reviewItem = async (item, decision) => {
    const itemId = entityId(item);
    setBusyId(`item:${itemId}`);
    try {
      await client.reviewAnnotationItem(itemId, decision);
      await updateAfterItemAction(decision === "approved" ? "标注已审核通过。" : "标注已退回修改。");
    } catch (requestError) {
      notifyError(requestError, onError, setError);
    } finally { setBusyId(""); }
  };

  const runShareAction = async (share, action) => {
    const id = entityId(share);
    setBusyId(`share:${id}`);
    setError("");
    setSuccess("");
    try {
      if (action === "accept") {
        await client.acceptShare(id);
      } else if (action === "decline") await client.declineShare(id);
      else await client.revokeShare(id);
      setSuccess(action === "accept" ? "分享已接受。" : action === "decline" ? "分享已拒绝。" : "分享邀请已撤销。");
      const payload = await client.listShares();
      setShares(unwrapList(payload, ["invitations", "items", "data"]));
    } catch (requestError) {
      notifyError(requestError, onError, setError);
    } finally { setBusyId(""); }
  };

  const cancelPublicRequest = async (requestItem) => {
    const id = entityId(requestItem);
    setBusyId(`public:${id}`);
    try {
      const result = await client.cancelPublicRequest(id);
      setPublicRequests((current) => current.map((item) => entityId(item) === id ? { ...item, ...(result?.request || {}), status: "cancelled" } : item));
      setSuccess("公开申请已取消。");
    } catch (requestError) {
      notifyError(requestError, onError, setError);
    } finally { setBusyId(""); }
  };

  const currentUserId = entityId(currentUser);
  const sentShares = shares.filter((item) => (item.invited_by || item.invitedBy) === currentUserId || currentUser?.role === "admin" && !(item.recipient_user_id || item.recipientUserId));
  const receivedShares = shares.filter((item) => (item.recipient_user_id || item.recipientUserId) === currentUserId
    || (!item.recipient_user_id && String(item.recipient_identifier || "").toLowerCase() === String(currentUser?.username || "").toLowerCase()));
  const canCreate = currentUser?.role === "admin" || permissions.includes("datasets.annotate");
  const visibleTasks = queue === "review"
    ? tasks.filter((task) => Number(task.submitted_count || 0) > 0)
    : tasks;

  return (
    <section className={cx("multi-user-annotation-tasks", className)} style={ui.panel}>
      <header style={ui.panelHeader}>
        <div>
          <h2 style={ui.panelTitle}>{selectedTask ? entityName(selectedTask) : "协同工作台"}</h2>
          {selectedTask ? <p style={ui.muted}>{`${selectedTask.dataset_version_name || "数据集版本"} · ${items.length} 个条目`}</p> : null}
        </div>
        <span style={ui.actions}>
          {selectedTask ? <ActionButton icon={ChevronLeft} onClick={() => { setSelectedTask(null); setItems([]); }}>返回任务</ActionButton> : null}
          {!selectedTask && workspace === "tasks" && canCreate ? <ActionButton icon={Plus} className="primary" onClick={() => setShowCreate(true)}>创建任务</ActionButton> : null}
          <IconButton label="刷新" onClick={() => selectedTask ? loadItems() : loadWorkspace()} disabled={loading}><RotateCw size={17} /></IconButton>
        </span>
      </header>
      {!selectedTask ? <div role="tablist" aria-label="协同工作区" style={ui.segmented}>
        {[
          { value: "tasks", label: "标注任务", icon: Pencil, count: tasks.length },
          { value: "shares", label: "分享", icon: Link2, count: shares.length },
          { value: "public", label: "公开申请", icon: Globe2, count: publicRequests.length },
        ].map((item) => {
          const Icon = item.icon;
          const active = workspace === item.value;
          return (
            <button key={item.value} type="button" role="tab" aria-selected={active} onClick={() => setWorkspace(item.value)} style={{ ...ui.segmentButton, ...(active ? ui.segmentButtonActive : null) }}>
              <Icon size={15} /><span>{item.label}</span><b style={ui.count}>{item.count}</b>
            </button>
          );
        })}
      </div> : null}
      <ErrorBanner>{error}</ErrorBanner>
      <FeedbackBanner message={success} onClose={() => setSuccess("")} />
      {loading ? <div style={ui.loading}><Loader2 size={18} /> 正在刷新协同状态</div> : null}
      {!loading && !selectedTask && workspace === "tasks" ? <>
        {currentUser?.role === "admin" ? <div role="tablist" aria-label="任务队列" style={ui.segmented}>
          <button type="button" role="tab" aria-selected={queue === "mine"} onClick={() => setQueue("mine")} style={{ ...ui.segmentButton, ...(queue === "mine" ? ui.segmentButtonActive : null) }}><Hand size={15} />全部任务</button>
          <button type="button" role="tab" aria-selected={queue === "review"} onClick={() => setQueue("review")} style={{ ...ui.segmentButton, ...(queue === "review" ? ui.segmentButtonActive : null) }}><ClipboardCheck size={15} />待审核</button>
        </div> : null}
        {!visibleTasks.length ? <EmptyState icon={ClipboardCheck}>暂无标注任务</EmptyState> : (
        <div style={ui.taskGrid}>
          {visibleTasks.map((task) => {
            const id = entityId(task);
            const status = String(task.status || "available").toLowerCase();
            const busy = busyId === `task:${id}`;
            const claimable = !["completed", "cancelled"].includes(status) && Number(task.pending_count || task.rejected_count || task.item_count || 0) > 0;
            return (
              <article key={id} style={ui.taskCard} onDoubleClick={() => openTask(task)}>
                <header style={ui.taskHeader}>
                  <span style={ui.listIcon}>{queue === "review" ? <ClipboardCheck size={17} /> : <Pencil size={17} />}</span>
                  <span style={ui.rowMain}>
                    <b>{entityName(task)}</b>
                    <small style={ui.muted}>{task.projectName || task.project_name || task.datasetVersionName || task.dataset_version_name || task.project?.name || "未分组"}</small>
                  </span>
                  <StatusBadge status={task.status || "available"} />
                </header>
                <div style={ui.taskMeta}>
                  <span><Database size={14} /> {task.itemCount ?? task.item_count ?? task.imageCount ?? task.image_count ?? 0} 项</span>
                  <span><CheckCircle2 size={14} /> {task.approved_count ?? 0} 已通过</span>
                  <span><ClipboardCheck size={14} /> {task.submitted_count ?? 0} 待审核</span>
                  <span><Clock3 size={14} /> {formatTime(task.dueAt || task.due_at || task.deadline)}</span>
                </div>
                {task.description ? <p style={ui.taskDescription}>{task.description}</p> : null}
                <footer style={ui.taskActions}>
                  <ActionButton icon={Eye} onClick={() => openTask(task)}>详情 / 条目</ActionButton>
                  {queue !== "review" && claimable ? <ActionButton icon={Hand} className="primary" busy={busy} onClick={() => claimTask(task)}>领取一条</ActionButton> : null}
                </footer>
              </article>
            );
          })}
        </div>
        )}
      </> : null}
      {!loading && !selectedTask && workspace === "shares" ? <ShareWorkspace sentShares={sentShares} receivedShares={receivedShares} busyId={busyId} onAction={runShareAction} /> : null}
      {!loading && !selectedTask && workspace === "public" ? <PublicRequestWorkspace requests={publicRequests} busyId={busyId} onCancel={cancelPublicRequest} /> : null}
      {!loading && selectedTask ? <TaskItemList items={items} locks={locks} currentUser={currentUser} busyId={busyId} onOpen={openAnnotationItem} onRenew={renewLock} onRelease={releaseLock} onReview={reviewItem} /> : null}
      <CreateTaskDialog open={showCreate} projects={projects} client={client} onClose={() => setShowCreate(false)} onCreated={async () => { setShowCreate(false); setSuccess("协同标注任务已创建。"); await loadWorkspace(); }} onError={(requestError) => notifyError(requestError, onError, setError)} />
    </section>
  );
}

function ShareWorkspace({ sentShares, receivedShares, busyId, onAction }) {
  const renderShare = (share, direction) => {
    const id = entityId(share);
    const pending = String(share.status || "pending") === "pending";
    return <article key={`${direction}:${id}`} style={ui.listRow}>
      <span style={ui.listIcon}>{direction === "received" ? <Inbox size={17} /> : <Send size={17} />}</span>
      <span style={ui.rowMain}>
        <b>{share.resource_name || share.resource_type || "资产"}</b>
        <small style={ui.muted}>{direction === "received" ? `来自 ${share.inviter_username || "未知用户"}` : `发送给 ${share.recipient_username || share.recipient_identifier || "未知用户"}`} · {formatTime(share.created_at)}</small>
        {share.message ? <span style={ui.reason}>{share.message}</span> : null}
      </span>
      <StatusBadge status={share.status} />
      {pending ? <span style={ui.actions}>
        {direction === "received" ? <><ActionButton icon={XCircle} busy={busyId === `share:${id}`} onClick={() => onAction(share, "decline")}>拒绝</ActionButton><ActionButton icon={CheckCircle2} className="primary" busy={busyId === `share:${id}`} onClick={() => onAction(share, "accept")}>接受</ActionButton></> : <ActionButton icon={Ban} busy={busyId === `share:${id}`} onClick={() => onAction(share, "revoke")}>撤销</ActionButton>}
      </span> : null}
    </article>;
  };
  return <div className="multi-user-share-columns">
    <section><h3>收到的分享</h3><div style={ui.list}>{receivedShares.length ? receivedShares.map((item) => renderShare(item, "received")) : <EmptyState icon={Inbox}>暂无收到的分享</EmptyState>}</div></section>
    <section><h3>发出的分享</h3><div style={ui.list}>{sentShares.length ? sentShares.map((item) => renderShare(item, "sent")) : <EmptyState icon={Send}>暂无发出的分享</EmptyState>}</div></section>
  </div>;
}

function PublicRequestWorkspace({ requests, busyId, onCancel }) {
  return <div style={ui.list}>
    {!requests.length ? <EmptyState icon={Globe2}>暂无公开申请</EmptyState> : requests.map((requestItem) => {
      const id = entityId(requestItem);
      return <article key={id} style={ui.listRow}>
        <span style={ui.listIcon}><Globe2 size={17} /></span>
        <span style={ui.rowMain}><b>{requestItem.resource_name || requestItem.resource_type || "资产"}</b><small style={ui.muted}>{formatTime(requestItem.created_at)}</small>{requestItem.reason ? <span style={ui.reason}>{requestItem.reason}</span> : null}</span>
        <StatusBadge status={requestItem.status} />
        {String(requestItem.status || "pending") === "pending" ? <ActionButton icon={XCircle} busy={busyId === `public:${id}`} onClick={() => onCancel(requestItem)}>取消申请</ActionButton> : null}
      </article>;
    })}
  </div>;
}

function TaskItemList({ items, locks, currentUser, busyId, onOpen, onRenew, onRelease, onReview }) {
  return <div className="multi-user-task-items" style={ui.list}>
    {!items.length ? <EmptyState icon={Database}>该任务暂无条目</EmptyState> : items.map((item, index) => {
      const id = entityId(item);
      const status = String(item.status || "pending").toLowerCase();
      const localLock = locks[id];
      const lockedByOther = item.lock_owner_id && item.lock_owner_id !== entityId(currentUser) && !localLock;
      const busy = busyId === `item:${id}`;
      return <article key={id} className="multi-user-task-item" style={ui.listRow}>
        <span style={ui.listIcon}><span>{index + 1}</span></span>
        <span style={ui.rowMain}><b>{item.display_name || entityName(item)}</b><small style={ui.muted}>{item.assignment_status || "未领取"} · {item.lock_expires_at ? `锁至 ${formatTime(item.lock_expires_at)}` : "未锁定"}</small>{item.latest_review_comment ? <span style={ui.reason}>审核意见：{item.latest_review_comment}</span> : null}</span>
        <StatusBadge status={status} />
        <span style={ui.actions}>
          <ActionButton icon={Eye} onClick={() => onOpen(item, true)}>查看</ActionButton>
          {!["submitted", "approved"].includes(status) && !lockedByOther ? <ActionButton icon={Lock} className="primary" busy={busy} onClick={() => onOpen(item, false)}>{localLock ? "继续标注" : "锁定并标注"}</ActionButton> : null}
          {localLock ? <><IconButton label="续锁" disabled={busy} onClick={() => onRenew(item)}><Clock3 size={15} /></IconButton><IconButton label="释放锁" disabled={busy} onClick={() => onRelease(item)}><Unlock size={15} /></IconButton></> : null}
          {currentUser?.role === "admin" && status === "submitted" ? <><ActionButton icon={XCircle} busy={busy} onClick={() => onReview(item, "rejected")}>退回</ActionButton><ActionButton icon={CheckCircle2} className="primary" busy={busy} onClick={() => onReview(item, "approved")}>通过</ActionButton></> : null}
        </span>
      </article>;
    })}
  </div>;
}

function CreateTaskDialog({ open, projects, client, onClose, onCreated, onError }) {
  const [form, setForm] = useState({ projectId: "", name: "", description: "", dueAt: "", reviewRequired: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (open) setForm((current) => ({ ...current, projectId: current.projectId || entityId(projects[0]) })); }, [open, projects]);
  const submit = async (event) => {
    event.preventDefault();
    if (!form.projectId || !form.name.trim()) return setError("请选择项目并填写任务名称。");
    setBusy(true); setError("");
    try {
      const result = await client.createAnnotationTask({ ...form, name: form.name.trim(), description: form.description.trim(), ...(form.dueAt ? { dueAt: new Date(form.dueAt).toISOString() } : {}) });
      await onCreated(result);
      setForm({ projectId: entityId(projects[0]), name: "", description: "", dueAt: "", reviewRequired: true });
    } catch (requestError) { setError(errorMessage(requestError)); onError?.(requestError); } finally { setBusy(false); }
  };
  return <DialogShell open={open} title="创建协同标注任务" description="默认纳入所选项目的全部图片" icon={Plus} onClose={onClose} busy={busy} footer={<><ActionButton onClick={onClose}>取消</ActionButton><ActionButton icon={Plus} className="primary" busy={busy} onClick={submit}>创建任务</ActionButton></>}>
    <form style={ui.form} onSubmit={submit}><ErrorBanner>{error}</ErrorBanner>
      <label style={ui.field}><span style={ui.label}>项目</span><select style={ui.select} value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })}><option value="">选择项目</option>{projects.map((project) => <option key={entityId(project)} value={entityId(project)}>{entityName(project)}</option>)}</select></label>
      <label style={ui.field}><span style={ui.label}>任务名称</span><input style={ui.input} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={160} /></label>
      <label style={ui.field}><span style={ui.label}>说明</span><textarea style={ui.textarea} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={3} /></label>
      <label style={ui.field}><span style={ui.label}>截止时间（可选）</span><input type="datetime-local" style={ui.input} value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} /></label>
      <label style={ui.inlineCheck}><input type="checkbox" checked={form.reviewRequired} onChange={(event) => setForm({ ...form, reviewRequired: event.target.checked })} /><span>提交后需要管理员审核</span></label>
    </form>
  </DialogShell>;
}

const ui = {
  panel: { minWidth: 0, display: "grid", gap: 14, color: "var(--text, #17202a)" },
  stack: { minWidth: 0, display: "grid", gap: 12 },
  panelHeader: { minWidth: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
  panelTitle: { margin: 0, color: "var(--text-strong, #0b1320)", fontSize: 18, letterSpacing: 0 },
  iconButton: { width: 34, height: 34, padding: 0, display: "inline-grid", placeItems: "center", flex: "0 0 auto" },
  actionButton: { minHeight: 34, padding: "0 11px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, whiteSpace: "nowrap" },
  segmented: { minWidth: 0, width: "fit-content", maxWidth: "100%", display: "flex", alignItems: "stretch", border: "1px solid var(--border, #d9e1ea)", borderRadius: 7, overflow: "hidden", background: "var(--surface-soft, #f8fafc)" },
  segmentButton: { minWidth: 0, minHeight: 36, margin: 0, padding: "0 12px", border: 0, borderRight: "1px solid var(--border, #d9e1ea)", borderRadius: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, background: "transparent", color: "var(--muted, #667085)", boxShadow: "none", letterSpacing: 0 },
  segmentButtonActive: { color: "var(--accent, #0f9d97)", background: "var(--accent-soft, #e6f7f5)", fontWeight: 700 },
  count: { minWidth: 20, height: 20, padding: "0 6px", borderRadius: 10, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "rgba(127, 146, 160, .14)", color: "inherit", fontSize: 11 },
  overlay: { position: "fixed", inset: 0, zIndex: 90, display: "grid", placeItems: "center", padding: 16, background: "rgba(3, 10, 16, .62)", backdropFilter: "blur(3px)" },
  dialog: { width: "min(620px, calc(100vw - 32px))", maxHeight: "min(780px, calc(100vh - 32px))", padding: 0, display: "grid", gridTemplateRows: "auto minmax(0, 1fr) auto", gap: 0, overflow: "hidden", borderRadius: 8, color: "var(--text, #17202a)", background: "var(--surface, #fff)" },
  dialogHeader: { minWidth: 0, padding: "18px 20px", display: "flex", alignItems: "flex-start", gap: 12, borderBottom: "1px solid var(--border-soft, #e8edf3)" },
  dialogIcon: { width: 34, height: 34, display: "grid", placeItems: "center", flex: "0 0 auto", borderRadius: 7, color: "var(--accent, #0f9d97)", background: "var(--accent-soft, #e6f7f5)" },
  dialogHeading: { minWidth: 0, flex: 1, display: "grid", gap: 4 },
  dialogTitle: { margin: 0, color: "var(--text-strong, #0b1320)", fontSize: 18, letterSpacing: 0 },
  dialogBody: { minHeight: 0, padding: 20, overflow: "auto" },
  dialogFooter: { minHeight: 66, padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, borderTop: "1px solid var(--border-soft, #e8edf3)", background: "var(--surface-soft, #f8fafc)" },
  form: { display: "grid", gap: 16 },
  field: { minWidth: 0, display: "grid", gap: 7 },
  fieldset: { minWidth: 0, margin: 0, padding: 0, display: "grid", gap: 7, border: 0 },
  label: { color: "var(--text, #17202a)", fontSize: 12, fontWeight: 700 },
  input: { width: "100%", height: 38, padding: "0 10px", border: "1px solid var(--border, #d9e1ea)", borderRadius: 6, color: "var(--text, #17202a)", background: "var(--surface, #fff)", boxSizing: "border-box" },
  textarea: { width: "100%", minHeight: 80, padding: 10, resize: "vertical", border: "1px solid var(--border, #d9e1ea)", borderRadius: 6, color: "var(--text, #17202a)", background: "var(--surface, #fff)", boxSizing: "border-box", font: "inherit", lineHeight: 1.5 },
  select: { width: "100%", height: 34, padding: "0 8px", border: "1px solid var(--border, #d9e1ea)", borderRadius: 6, color: "var(--text, #17202a)", background: "var(--surface, #fff)" },
  muted: { margin: 0, color: "var(--muted, #667085)", fontSize: 12, letterSpacing: 0 },
  error: { padding: "9px 11px", border: "1px solid rgba(217, 45, 32, .26)", borderRadius: 6, color: "#b42318", background: "rgba(217, 45, 32, .08)", fontSize: 12 },
  notice: { padding: 12, display: "flex", alignItems: "flex-start", gap: 9, border: "1px solid var(--border-soft, #e8edf3)", borderRadius: 7, color: "var(--muted, #667085)", background: "var(--surface-soft, #f8fafc)", fontSize: 12, lineHeight: 1.5 },
  recipientList: { maxHeight: 250, overflow: "auto", display: "grid", gap: 6 },
  checkRow: { minWidth: 0, padding: "9px 10px", display: "flex", alignItems: "center", gap: 9, border: "1px solid var(--border-soft, #e8edf3)", borderRadius: 7, cursor: "pointer", background: "var(--surface, #fff)" },
  checkRowActive: { borderColor: "var(--accent, #0f9d97)", background: "var(--accent-soft, #e6f7f5)" },
  avatar: { width: 30, height: 30, display: "grid", placeItems: "center", flex: "0 0 auto", borderRadius: "50%", color: "var(--text, #17202a)", background: "rgba(127, 146, 160, .16)", fontSize: 12, fontWeight: 700 },
  rowMain: { minWidth: 0, flex: 1, display: "grid", gap: 3, overflowWrap: "anywhere" },
  loading: { minHeight: 90, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--muted, #667085)", fontSize: 13 },
  empty: { minHeight: 110, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, color: "var(--muted, #667085)" },
  status: { width: "fit-content", minHeight: 24, padding: "0 8px", display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 12, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" },
  status_success: { color: "#067647", background: "rgba(18, 183, 106, .12)" },
  status_danger: { color: "#b42318", background: "rgba(217, 45, 32, .10)" },
  status_active: { color: "#175cd3", background: "rgba(47, 128, 237, .12)" },
  status_pending: { color: "#b54708", background: "rgba(247, 144, 9, .12)" },
  adminTabs: { minWidth: 0, display: "flex", gap: 2, overflowX: "auto", borderBottom: "1px solid var(--border, #d9e1ea)" },
  adminTab: { minHeight: 42, padding: "0 13px", border: 0, borderBottom: "2px solid transparent", borderRadius: 0, display: "inline-flex", alignItems: "center", gap: 7, color: "var(--muted, #667085)", background: "transparent", boxShadow: "none", whiteSpace: "nowrap" },
  adminTabActive: { color: "var(--accent, #0f9d97)", borderBottomColor: "var(--accent, #0f9d97)", fontWeight: 700 },
  table: { minWidth: 0, overflowX: "auto", borderTop: "1px solid var(--border-soft, #e8edf3)" },
  tableRow: { minWidth: 760, minHeight: 58, padding: "10px 12px", display: "grid", alignItems: "center", gap: 14, borderBottom: "1px solid var(--border-soft, #e8edf3)" },
  tableHeader: { minHeight: 38, color: "var(--muted, #667085)", background: "var(--surface-soft, #f8fafc)", fontSize: 11, fontWeight: 700 },
  permissionGroup: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "5px 10px" },
  inlineCheck: { display: "inline-flex", alignItems: "center", gap: 4, color: "var(--muted, #667085)", fontSize: 11, whiteSpace: "nowrap" },
  switchLabel: { display: "inline-flex", alignItems: "center", gap: 5, color: "var(--muted, #667085)", fontSize: 11, whiteSpace: "nowrap" },
  list: { minWidth: 0, display: "grid", borderTop: "1px solid var(--border-soft, #e8edf3)" },
  listRow: { minWidth: 0, minHeight: 70, padding: "12px 10px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid var(--border-soft, #e8edf3)" },
  listIcon: { width: 34, height: 34, display: "grid", placeItems: "center", flex: "0 0 auto", borderRadius: 7, color: "var(--accent, #0f9d97)", background: "var(--accent-soft, #e6f7f5)" },
  reason: { marginTop: 4, color: "var(--text, #17202a)", fontSize: 12, lineHeight: 1.5 },
  actions: { display: "inline-flex", alignItems: "center", gap: 7 },
  taskGrid: { minWidth: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 330px), 1fr))", gap: 10 },
  taskCard: { minWidth: 0, padding: 14, display: "grid", gap: 12, border: "1px solid var(--border, #d9e1ea)", borderRadius: 8, background: "var(--surface, #fff)", boxShadow: "var(--shadow-sm, 0 1px 2px rgba(16,24,40,.06))" },
  taskHeader: { minWidth: 0, display: "flex", alignItems: "center", gap: 10 },
  taskMeta: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "7px 14px", color: "var(--muted, #667085)", fontSize: 11 },
  taskDescription: { margin: 0, color: "var(--text, #17202a)", fontSize: 12, lineHeight: 1.5 },
  taskActions: { minHeight: 34, display: "flex", alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap", gap: 7 },
};

export default {
  ScopeTabs,
  ShareDialog,
  PublicRequestDialog,
  AdminCenter,
  AnnotationTaskPanel,
  createMultiUserApi,
};
