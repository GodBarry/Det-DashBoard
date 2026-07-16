import { useCallback, useState } from "react";

export function useSettingsOverlayController() {
  const [showSettings, setShowSettings] = useState(false);

  const openSettings = useCallback(() => setShowSettings(true), []);
  const closeSettings = useCallback(() => setShowSettings(false), []);

  return {
    closeSettings,
    openSettings,
    showSettings,
  };
}
