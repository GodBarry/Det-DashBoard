import React from "react";
import { Copy, FolderOpen } from "lucide-react";

export function DrawerInputWithIcon({ copyIcon = false, onIconClick, iconTitle, ...inputProps }) {
  const Icon = copyIcon ? Copy : FolderOpen;

  return (
    <span className="drawer-input-with-icon">
      <input {...inputProps} />
      <button type="button" onClick={onIconClick} aria-label={iconTitle || (copyIcon ? "复制路径" : "选择路径")}><Icon size={15} /></button>
    </span>
  );
}
