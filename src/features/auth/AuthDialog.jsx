import { useEffect, useState } from "react";
import { X } from "lucide-react";

const EMPTY_REGISTER_FORM = {
  username: "",
  password: "",
  confirm: "",
  displayName: "",
};

const DEFAULT_LOGIN_FORM = {
  ...EMPTY_REGISTER_FORM,
  username: "admin",
  password: "admin",
};

function initialForm(mode, initialValues) {
  const defaults = mode === "login" ? DEFAULT_LOGIN_FORM : EMPTY_REGISTER_FORM;
  return { ...defaults, ...initialValues };
}

/**
 * Controlled authentication dialog.
 * onSubmit receives { mode, credentials } and must return the signed-in user.
 */
export function AuthDialog({
  mode,
  setMode,
  onClose,
  onSignedIn,
  onSubmit,
  onError,
  required = false,
  initialValues,
}) {
  const [form, setForm] = useState(() => initialForm(mode, initialValues));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setForm(initialForm(mode, initialValues));
    setError("");
  }, [mode]);

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const reportError = (message, cause) => {
    setError(message);
    onError?.(cause || new Error(message));
  };

  const submit = async () => {
    if (busy) return;
    if (mode === "register" && form.password !== form.confirm) {
      reportError("两次输入的密码不一致");
      return;
    }
    if (typeof onSubmit !== "function") {
      reportError("认证服务未配置");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const credentials = {
        username: form.username.trim(),
        password: form.password,
        displayName: form.displayName.trim(),
      };
      const signedInUser = await onSubmit({ mode, credentials });
      onSignedIn?.(signedInUser);
      onClose?.();
    } catch (cause) {
      reportError(cause?.message || "认证失败", cause);
    } finally {
      setBusy(false);
    }
  };

  const nextMode = mode === "login" ? "register" : "login";

  return (
    <div className="auth-overlay">
      <section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-dialog-title">
        {!required && (
          <button type="button" className="auth-close" aria-label="关闭" onClick={onClose}>
            <X size={16} />
          </button>
        )}

        <h2 id="auth-dialog-title">{mode === "login" ? "登录 Det Dashboard" : "注册用户"}</h2>
        <label>
          用户名
          <input
            autoComplete="username"
            value={form.username}
            onChange={(event) => updateField("username", event.target.value)}
          />
        </label>
        {mode === "register" && (
          <label>
            显示名称
            <input
              value={form.displayName}
              onChange={(event) => updateField("displayName", event.target.value)}
              placeholder="可选"
            />
          </label>
        )}
        <label>
          密码
          <input
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={form.password}
            onChange={(event) => updateField("password", event.target.value)}
          />
        </label>
        {mode === "register" && (
          <label>
            确认密码
            <input
              type="password"
              autoComplete="new-password"
              value={form.confirm}
              onChange={(event) => updateField("confirm", event.target.value)}
            />
          </label>
        )}
        {error && <p className="error-msg" role="alert">{error}</p>}
        <button type="button" className="primary" disabled={busy} onClick={submit}>
          {busy ? "处理中..." : mode === "login" ? "登录" : "注册并登录"}
        </button>
        <button type="button" className="text-button" onClick={() => setMode?.(nextMode)}>
          {mode === "login" ? "没有账号？注册" : "已有账号？登录"}
        </button>
      </section>
    </div>
  );
}

export default AuthDialog;
