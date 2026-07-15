import { useState } from "react";
import {
  Bell,
  Boxes,
  Brain,
  ChevronDown,
  Cpu,
  FolderOpen,
  HelpCircle,
  Play,
  Search,
  Settings,
  Sun,
} from "lucide-react";

const NAV_ITEMS = [
  { id: "home", label: "数据", icon: FolderOpen },
  { id: "models", label: "资产", icon: Brain },
  { id: "training", label: "训练", icon: Play },
  { id: "inference", label: "推理", icon: Cpu },
  { id: "evaluation", label: "评估", icon: Search },
];

/**
 * Application-level navigation extracted from App.jsx.
 * Navigation and session actions are injected so the component owns only menu UI state.
 */
export function MainNav({
  view,
  goHome,
  openPlatform,
  theme,
  setTheme,
  user,
  onLogin,
  onLogout,
  onSettings,
  onHelp,
  onNotifications,
}) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const navigate = (destination) => {
    if (destination === "home") goHome?.();
    else openPlatform?.(destination);
  };

  const toggleTheme = () => setTheme?.(theme === "dark" ? "light" : "dark");

  return (
    <nav className="main-nav" aria-label="主导航">
      <div className="brand-mark">
        <Boxes size={18} />
        <span>Det Dashboard</span>
      </div>

      <div className="nav-tabs">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={view === id ? "active" : ""}
            aria-current={view === id ? "page" : undefined}
            onClick={() => navigate(id)}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      <div className="nav-tools">
        <button type="button" title="帮助" aria-label="帮助" onClick={onHelp}>
          <HelpCircle size={16} />
        </button>
        <button type="button" title="通知" aria-label="通知" onClick={onNotifications}>
          <Bell size={16} />
        </button>
        <button type="button" title="设置" aria-label="设置" onClick={onSettings}>
          <Settings size={16} />
        </button>
        <button
          type="button"
          className="theme-toggle"
          aria-label="切换明暗模式"
          title="切换明暗模式"
          onClick={toggleTheme}
        >
          <Sun size={16} />
        </button>

        <div className="user-menu-wrap">
          <button
            type="button"
            className="user-chip"
            aria-haspopup={user ? "menu" : undefined}
            aria-expanded={user ? userMenuOpen : undefined}
            onClick={() => (user ? setUserMenuOpen((value) => !value) : onLogin?.())}
          >
            <i>{(user?.username || "?").slice(0, 1).toUpperCase()}</i>
            {user?.displayName || user?.username || "未登"}
            <ChevronDown size={13} />
          </button>

          {userMenuOpen && user && (
            <div className="user-menu" role="menu">
              <span>{user.username}</span>
              {user.role === "admin" && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setUserMenuOpen(false);
                    openPlatform?.("admin");
                  }}
                >
                  管理员中心
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setUserMenuOpen(false);
                  onLogout?.();
                }}
              >
                退出登录
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}

export default MainNav;
