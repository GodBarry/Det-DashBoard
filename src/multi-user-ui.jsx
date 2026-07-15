import React, { useEffect, useId, useMemo, useState } from "react";
import {
  Ban,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Database,
  Eye,
  Globe2,
  Hand,
  Inbox,
  Link2,
  Loader2,
  Pencil,
  RotateCw,
  Send,
  ShieldCheck,
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
};

const ROLE_OPTIONS = [
  { value: "viewer", label: "查看者" },
  { value: "annotator", label: "标注员" },
  { value: "reviewer", label: "审核员" },
  { value: "admin", label: "管理员" },
];

const PERMISSION_OPTIONS = [
  { value: "annotate", label: "标注" },
  { value: "review", label: "审核" },
  { value: "publish", label: "公开资产" },
];

const STATUS_LABELS = {
  pending: "待处理",
  approved: "已通过",
  rejected: "已拒绝",
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
    createShare: (payload) => request(paths.shares, { method: "POST", body: toBody(payload) }),
    createPublicRequest: (payload) => request(paths.publicRequestSubmissions, { method: "POST", body: toBody(payload) }),
    listPublicRequests: () => request(paths.publicRequests),
    reviewPublicRequest: (requestId, decision, note = "") => request(
      `${paths.publicRequests}/${encodeURIComponent(requestId)}/review`,
      { method: "POST", body: toBody({ decision, note }) },
    ),
    listPublicAssets: () => request(paths.publicAssets),
    removePublicAsset: (assetId) => request(`${paths.publicAssets}/${encodeURIComponent(assetId)}`, { method: "DELETE" }),
    listAnnotationTasks: (queue = "mine") => request(`${paths.annotationTasks}${paths.annotationTasks.includes("?") ? "&" : "?"}queue=${encodeURIComponent(queue)}`),
    claimAnnotationTask: (taskId) => request(`${paths.annotationTasks}/${encodeURIComponent(taskId)}/claim`, { method: "POST" }),
    submitAnnotationTask: (taskId, payload = {}) => request(`${paths.annotationTasks}/${encodeURIComponent(taskId)}/submit`, {
      method: "POST",
      body: toBody(payload),
    }),
    reviewAnnotationTask: (taskId, decision, note = "") => request(
      `${paths.annotationTasks}/${encodeURIComponent(taskId)}/review`,
      { method: "POST", body: toBody({ decision, note }) },
    ),
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
  return entity?.name || entity?.title || entity?.username || entity?.displayName || entity?.fileName || fallback;
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
  const [permission, setPermission] = useState("view");
  const [expiresAt, setExpiresAt] = useState("");
  const [message, setMessage] = useState("");
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setRecipients(users || []), [users]);
  useEffect(() => {
    if (!open) return;
    setSelectedIds([]);
    setPermission("view");
    setExpiresAt("");
    setMessage("");
    setError("");
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
    if (!selectedIds.length) {
      setError("请至少选择一个共享对象。");
      return;
    }
    const payload = {
      resourceId: entityId(resource),
      resourceType: resource?.type || resource?.resourceType || "asset",
      recipientIds: selectedIds,
      permission,
      message: message.trim(),
      ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
    };
    setSubmitting(true);
    setError("");
    try {
      const result = onShare ? await onShare(payload, resource) : await client.createShare(payload);
      onShared?.(result, payload);
      onClose?.();
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
        <fieldset style={ui.fieldset}>
          <legend style={ui.label}>访问权限</legend>
          <div style={ui.segmented}>
            {[
              { value: "view", label: "仅查看", icon: Eye },
              { value: "edit", label: "可编辑", icon: Pencil },
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

  useEffect(() => {
    if (open) {
      setReason(defaultReason);
      setError("");
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
    try {
      const result = onRequest ? await onRequest(payload, resource) : await client.createPublicRequest(payload);
      onRequested?.(result, payload);
      onClose?.();
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

export function AdminCenter({
  api,
  fetcher,
  baseUrl = "",
  endpoints,
  users: usersProp,
  publicRequests: requestsProp,
  publicAssets: assetsProp,
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
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { if (usersProp !== undefined) setUsers(usersProp); }, [usersProp]);
  useEffect(() => { if (requestsProp !== undefined) setRequests(requestsProp); }, [requestsProp]);
  useEffect(() => { if (assetsProp !== undefined) setAssets(assetsProp); }, [assetsProp]);

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const [usersPayload, requestsPayload, assetsPayload] = await Promise.all([
        usersProp === undefined ? client.listUsers() : usersProp,
        requestsProp === undefined ? client.listPublicRequests() : requestsProp,
        assetsProp === undefined ? client.listPublicAssets() : assetsProp,
      ]);
      if (usersProp === undefined) setUsers(unwrapList(usersPayload, ["users", "items", "data"]));
      if (requestsProp === undefined) setRequests(unwrapList(requestsPayload, ["requests", "items", "data"]));
      if (assetsProp === undefined) setAssets(unwrapList(assetsPayload, ["assets", "items", "data"]));
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
    setUsers((current) => current.map((item) => entityId(item) === id ? { ...item, ...patch } : item));
    try {
      const result = onUserChange ? await onUserChange(user, patch) : await client.updateUser(id, patch);
      if (result && typeof result === "object") {
        const updated = result.user || result;
        setUsers((current) => current.map((item) => entityId(item) === id ? { ...item, ...updated } : item));
      }
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
    try {
      const result = onRequestReviewed
        ? await onRequestReviewed(requestItem, decision)
        : await client.reviewPublicRequest(id, decision);
      setRequests((current) => current.map((item) => entityId(item) === id ? { ...item, ...(result?.request || {}), status: decision === "approve" ? "approved" : "rejected" } : item));
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
      else await client.removePublicAsset(id);
      setAssets((current) => current.filter((item) => entityId(item) !== id));
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
                <select value={user.role || "viewer"} disabled={busy} onChange={(event) => updateUser(user, { role: event.target.value })} style={ui.select} aria-label={`${entityName(user)}的角色`}>
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
                  <input type="checkbox" checked={user.enabled !== false && user.status !== "disabled"} disabled={busy} onChange={(event) => updateUser(user, { enabled: event.target.checked })} />
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
                    <ActionButton icon={XCircle} busy={busy} onClick={() => reviewRequest(requestItem, "reject")}>拒绝</ActionButton>
                    <ActionButton icon={CheckCircle2} className="primary" busy={busy} onClick={() => reviewRequest(requestItem, "approve")}>通过</ActionButton>
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
    </section>
  );
}

function taskQueue(task) {
  const declaredQueue = String(task.queue || task.taskQueue || "").toLowerCase();
  if (["review", "reviewing", "audit"].includes(declaredQueue)) return "review";
  if (["mine", "annotation", "annotate"].includes(declaredQueue)) return "mine";
  const status = String(task.status || "available").toLowerCase();
  return ["submitted", "review", "pending_review"].includes(status) ? "review" : "mine";
}

export function AnnotationTaskPanel({
  api,
  fetcher,
  baseUrl = "",
  endpoints,
  tasks: tasksProp,
  initialQueue = "mine",
  onClaim,
  onSubmit,
  onReview,
  onOpenTask,
  onError,
  className = "",
}) {
  const client = useClient(api, fetcher, baseUrl, endpoints);
  const [queue, setQueue] = useState(initialQueue);
  const [tasks, setTasks] = useState(tasksProp || []);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { if (tasksProp !== undefined) setTasks(tasksProp); }, [tasksProp]);

  const loadTasks = async () => {
    if (tasksProp !== undefined) return;
    setLoading(true);
    setError("");
    try {
      const payload = await client.listAnnotationTasks(queue);
      setTasks(unwrapList(payload, ["tasks", "items", "data"]));
    } catch (requestError) {
      notifyError(requestError, onError, setError);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadTasks(); }, [client, queue, tasksProp]);

  const runTaskAction = async (task, action, decision) => {
    const id = entityId(task);
    setBusyId(id);
    setError("");
    try {
      let result;
      if (action === "claim") result = onClaim ? await onClaim(task) : await client.claimAnnotationTask(id);
      if (action === "submit") result = onSubmit ? await onSubmit(task) : await client.submitAnnotationTask(id);
      if (action === "review") result = onReview ? await onReview(task, decision) : await client.reviewAnnotationTask(id, decision);
      if (tasksProp === undefined) await loadTasks();
      else {
        const nextStatus = action === "claim" ? "in_progress" : action === "submit" ? "submitted" : decision === "approve" ? "completed" : "in_progress";
        setTasks((current) => current.map((item) => entityId(item) === id ? { ...item, ...(result?.task || {}), status: nextStatus } : item));
      }
    } catch (requestError) {
      notifyError(requestError, onError, setError);
    } finally {
      setBusyId("");
    }
  };

  const visibleTasks = tasks.filter((task) => tasksProp === undefined || taskQueue(task) === queue);
  const mineCount = tasksProp === undefined && queue !== "mine" ? undefined : tasks.filter((task) => taskQueue(task) === "mine").length;
  const reviewCount = tasksProp === undefined && queue !== "review" ? undefined : tasks.filter((task) => taskQueue(task) === "review").length;

  return (
    <section className={cx("multi-user-annotation-tasks", className)} style={ui.panel}>
      <header style={ui.panelHeader}>
        <div>
          <h2 style={ui.panelTitle}>标注任务</h2>
          <p style={ui.muted}>领取标注任务并完成提交或审核。</p>
        </div>
        <IconButton label="刷新任务" onClick={loadTasks} disabled={loading}><RotateCw size={17} /></IconButton>
      </header>
      <div role="tablist" aria-label="标注任务类型" style={ui.segmented}>
        {[
          { value: "mine", label: "我的任务", icon: Hand, count: mineCount },
          { value: "review", label: "审核任务", icon: ClipboardCheck, count: reviewCount },
        ].map((item) => {
          const Icon = item.icon;
          const active = queue === item.value;
          return (
            <button key={item.value} type="button" role="tab" aria-selected={active} onClick={() => setQueue(item.value)} style={{ ...ui.segmentButton, ...(active ? ui.segmentButtonActive : null) }}>
              <Icon size={15} /><span>{item.label}</span>{item.count !== undefined ? <b style={ui.count}>{item.count}</b> : null}
            </button>
          );
        })}
      </div>
      <ErrorBanner>{error}</ErrorBanner>
      {loading ? <div style={ui.loading}><Loader2 size={18} /> 正在加载任务</div> : null}
      {!loading && !visibleTasks.length ? <EmptyState icon={ClipboardCheck}>{queue === "mine" ? "暂无我的任务" : "暂无待审核任务"}</EmptyState> : null}
      {!loading && visibleTasks.length ? (
        <div style={ui.taskGrid}>
          {visibleTasks.map((task) => {
            const id = entityId(task);
            const status = String(task.status || "available").toLowerCase();
            const busy = busyId === id;
            const available = ["available", "unclaimed", "pending"].includes(status) && !task.assigneeId;
            const working = ["claimed", "assigned", "in_progress"].includes(status);
            const reviewable = ["submitted", "review", "pending_review", "pending"].includes(status);
            return (
              <article key={id} style={ui.taskCard}>
                <header style={ui.taskHeader}>
                  <span style={ui.listIcon}>{queue === "review" ? <ClipboardCheck size={17} /> : <Pencil size={17} />}</span>
                  <span style={ui.rowMain}>
                    <b>{entityName(task)}</b>
                    <small style={ui.muted}>{task.projectName || task.project?.name || "未分组"}</small>
                  </span>
                  <StatusBadge status={task.status || "available"} />
                </header>
                <div style={ui.taskMeta}>
                  <span><Database size={14} /> {task.itemCount ?? task.imageCount ?? 0} 项</span>
                  <span><CheckCircle2 size={14} /> {task.completedCount ?? task.annotatedCount ?? 0} 已完成</span>
                  <span><Clock3 size={14} /> {formatTime(task.dueAt || task.deadline)}</span>
                </div>
                {task.description ? <p style={ui.taskDescription}>{task.description}</p> : null}
                <footer style={ui.taskActions}>
                  {onOpenTask ? <ActionButton icon={Eye} onClick={() => onOpenTask(task, queue)}>打开</ActionButton> : null}
                  {queue === "mine" && available ? <ActionButton icon={Hand} className="primary" busy={busy} onClick={() => runTaskAction(task, "claim")}>领取</ActionButton> : null}
                  {queue === "mine" && working ? <ActionButton icon={Send} className="primary" busy={busy} onClick={() => runTaskAction(task, "submit")}>提交</ActionButton> : null}
                  {queue === "review" && reviewable ? (
                    <>
                      <ActionButton icon={XCircle} busy={busy} onClick={() => runTaskAction(task, "review", "reject")}>退回</ActionButton>
                      <ActionButton icon={CheckCircle2} className="primary" busy={busy} onClick={() => runTaskAction(task, "review", "approve")}>审核通过</ActionButton>
                    </>
                  ) : null}
                </footer>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

const ui = {
  panel: { minWidth: 0, display: "grid", gap: 14, color: "var(--text, #17202a)" },
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
