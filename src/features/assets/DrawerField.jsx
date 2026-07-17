import React from "react";

export function DrawerField({ label, tall = false, children }) {
  return <label className={`drawer-field ${tall ? "tall" : ""}`}><span>{label}</span>{children}</label>;
}
