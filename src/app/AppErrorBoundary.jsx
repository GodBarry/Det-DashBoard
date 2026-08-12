import React from "react";

const sessionKey = "det-dashboard-user";

function clearRecoverableBrowserState() {
  try {
    const keys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index));
    keys.filter((key) => key?.startsWith("det-dashboard") && key !== sessionKey)
      .forEach((key) => window.localStorage.removeItem(key));
    window.sessionStorage.clear();
  } catch {
    // Recovery must still reload when browser storage is unavailable.
  }
}

export class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Det-DashBoard UI failed to render", error, info);
  }

  recover = () => {
    clearRecoverableBrowserState();
    const url = new URL(window.location.href);
    url.searchParams.set("recovered", Date.now().toString(36));
    window.location.replace(url.toString());
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#f4f7fa", color: "#152333", fontFamily: "system-ui, sans-serif" }}>
        <section style={{ width: "min(560px, 100%)", padding: 28, border: "1px solid #d9e3ec", borderRadius: 10, background: "#fff", boxShadow: "0 12px 40px rgba(25, 48, 70, .12)" }}>
          <h1 style={{ margin: "0 0 12px", fontSize: 22 }}>页面资源已更新</h1>
          <p style={{ margin: "0 0 20px", lineHeight: 1.7, color: "#637486" }}>
            浏览器仍在使用升级前的页面状态。点击下方按钮清理旧界面缓存并重新加载；登录会话将保留。
          </p>
          <button type="button" onClick={this.recover} style={{ minHeight: 40, padding: "0 18px", border: 0, borderRadius: 6, background: "#0f9d97", color: "#fff", cursor: "pointer", fontWeight: 700 }}>
            恢复并重新加载
          </button>
        </section>
      </main>
    );
  }
}

export { clearRecoverableBrowserState };
