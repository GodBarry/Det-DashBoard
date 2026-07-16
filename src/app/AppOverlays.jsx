import { AuthDialog as AuthDialogView } from "../features/auth/AuthDialog.jsx";
import { submitAuth } from "../features/auth/useAuthSessionController.js";
import { SettingsDialog as SettingsDialogView } from "../features/settings/SettingsDialog.jsx";

export function AuthDialog(props) {
  return <AuthDialogView {...props} onSubmit={submitAuth} />;
}

export function SettingsDialog(props) {
  return (
    <SettingsDialogView
      {...props}
      onSave={async (settings) => {
        const response = await fetch("/api/settings", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ settings }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "保存设置失败");
        return data;
      }}
    />
  );
}
