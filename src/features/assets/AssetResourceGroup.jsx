import React, { useState } from "react";

import { ChevronDown, ChevronRight } from "lucide-react";

export function AssetResourceGroup({ title, icon: Icon, count, defaultOpen = false, children }) {
  const storageKey = `det-dashboard.asset-group.${title}`;
  const [open, setOpenState] = useState(() => { const stored = localStorage.getItem(storageKey); return stored == null ? defaultOpen : stored === "1"; });
  const setOpen = (next) => { localStorage.setItem(storageKey, next ? "1" : "0"); setOpenState(next); };

  return (
    <section className="asset-tree-group">
      <button className="asset-tree-head" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Icon size={15} />
        <b>{title}</b>
        <em>{count}</em>
      </button>
      {open && <div className="asset-tree-children">{children}</div>}
    </section>
  );
}
