import React, { useState } from "react";

import { ChevronDown, ChevronRight } from "lucide-react";

export function AssetResourceGroup({ title, icon: Icon, count, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);

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
