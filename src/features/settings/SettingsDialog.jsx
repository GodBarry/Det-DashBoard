import { useState } from "react";
import { X } from "lucide-react";

export const SETTINGS_FIELDS = [
  ["postgres", "Postgres", "连接串或 host:port / db"],
  ["dataStorage", "数据存储", "Windows 数据集根路径"],
  ["browseRoot", "导入浏览根路径", "打开目录选择器时的根路径"],
  ["minioStorage", "MinIO", "endpoint:port / bucket"],
  ["minioDataDir", "MinIO 数据目录", "E:\\projects\\DD-runtime\\minio 或实际数据路径"],
  ["pythonAssets", "Python 资产", "Miniforge / Python 环境路径"],
  ["algorithmAssets", "算法源码", "算法适配器和源码路径"],
  ["exportRoot", "导出目录", "报告与导出文件路径"],
];

export function createSettingsForm(config = {}) {
  const settings = config.settings || {};
  return {
    postgres: settings.postgres || config.postgres || "127.0.0.1:55432 / det_dashboard",
    dataStorage: settings.dataStorage || config.dataRootDisplay || config.dataRoot || "",
    browseRoot: settings.browseRoot || config.browseRootDisplay || config.browseRoot || "",
    minioStorage: settings.minioStorage || (config.minio ? `${config.minio.endPoint}:${config.minio.port} / ${config.minio.bucket}` : "127.0.0.1:9000 / zbh-datasets"),
    minioDataDir: settings.minioDataDir || config.minio?.dataDir || "E:\\projects\\DD-runtime\\minio",
    pythonAssets: settings.pythonAssets || "D:\\Program Files\\miniforge3",
    algorithmAssets: settings.algorithmAssets || "E:\\projects\\DD-runtime\\minio\\zbh-datasets\\code-assets\\algorithms",
    exportRoot: settings.exportRoot || config.exportRoot || "exports",
  };
}

/**
 * Controlled settings dialog. onSave receives the complete settings object.
 */
export function SettingsDialog({
  config,
  onClose,
  onSave,
  onSaved,
  onError,
  fields = SETTINGS_FIELDS,
}) {
  const [form, setForm] = useState(() => createSettingsForm(config));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (busy) return;
    if (typeof onSave !== "function") {
      const cause = new Error("设置保存服务未配置");
      setError(cause.message);
      onError?.(cause);
      return;
    }

    setBusy(true);
    setError("");
    try {
      const result = await onSave(form);
      onSaved?.(result, form);
      onClose?.();
    } catch (cause) {
      setError(cause?.message || "保存设置失败");
      onError?.(cause);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-overlay settings-overlay">
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-dialog-title">
        <button type="button" className="auth-close" aria-label="关闭" onClick={onClose}>
          <X size={16} />
        </button>
        <h2 id="settings-dialog-title">系统设置</h2>
        <p>配置 Postgres、数据存储、MinIO、Python 资产与算法源码路径</p>
        <div className="settings-list">
          {fields.map(([key, label, placeholder]) => (
            <label key={key}>
              {label}
              <input
                value={form[key] ?? ""}
                placeholder={placeholder}
                onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
              />
            </label>
          ))}
        </div>
        {error && <p className="error-msg" role="alert">{error}</p>}
        <div className="settings-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="button" className="primary" disabled={busy} onClick={save}>
            {busy ? "保存中..." : "保存设置"}
          </button>
        </div>
      </section>
    </div>
  );
}

export default SettingsDialog;
