import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight, Folder, FolderOpen, Plus, X } from "lucide-react";

function pathFor(id, byId) {
  const rows = [];
  const seen = new Set();
  let cursor = byId.get(id);
  while (cursor && !seen.has(cursor.id)) { rows.unshift(cursor); seen.add(cursor.id); cursor = cursor.parent_id ? byId.get(cursor.parent_id) : null; }
  return rows;
}

export function CascadingProjectPicker({ projects = [], value = "", values = [], multiple = false, onChange, ariaLabel = "选择数据集", storageKey = "dataset-picker" }) {
  const selectedIds = multiple ? values : [value].filter(Boolean);
  const [open, setOpen] = useState(false);
  const [popoverLayout, setPopoverLayout] = useState(null);
  const pickerRef = useRef(null);
  const popoverRef = useRef(null);
  const [expanded, setExpanded] = useState(() => { try { return new Set(JSON.parse(localStorage.getItem(`det-dashboard.${storageKey}.expanded`) || "[]")); } catch { return new Set(); } });
  const byId = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const children = useMemo(() => { const map = new Map(); projects.forEach((project) => { const key = project.parent_id || "root"; if (!map.has(key)) map.set(key, []); map.get(key).push(project); }); return map; }, [projects]);
  const visible = [];
  const append = (parent = "root", depth = 0) => (children.get(parent) || []).forEach((project) => { const hasChildren = (children.get(project.id) || []).length > 0; visible.push({ ...project, depth, hasChildren }); if (hasChildren && expanded.has(project.id)) append(project.id, depth + 1); });
  append();
  const updatePopoverLayout = useCallback(() => {
    const rect = pickerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportGap = 12;
    const popoverGap = 4;
    const spaceBelow = window.innerHeight - rect.bottom - viewportGap - popoverGap;
    const spaceAbove = rect.top - viewportGap - popoverGap;
    const placeAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
    const availableHeight = Math.max(140, placeAbove ? spaceAbove : spaceBelow);
    const width = Math.min(Math.max(rect.width, 320), window.innerWidth - viewportGap * 2);
    const left = Math.min(Math.max(rect.left, viewportGap), window.innerWidth - width - viewportGap);
    setPopoverLayout({
      left,
      top: placeAbove ? Math.max(viewportGap, rect.top - Math.min(420, availableHeight) - popoverGap) : rect.bottom + popoverGap,
      width,
      maxHeight: Math.min(420, availableHeight),
      placement: placeAbove ? "top" : "bottom",
    });
  }, []);
  useLayoutEffect(() => {
    if (!open) return undefined;
    updatePopoverLayout();
    window.addEventListener("resize", updatePopoverLayout);
    window.addEventListener("scroll", updatePopoverLayout, true);
    return () => {
      window.removeEventListener("resize", updatePopoverLayout);
      window.removeEventListener("scroll", updatePopoverLayout, true);
    };
  }, [open, updatePopoverLayout]);
  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => {
      if (!pickerRef.current?.contains(event.target) && !popoverRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);
  const toggleExpanded = (id) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); localStorage.setItem(`det-dashboard.${storageKey}.expanded`, JSON.stringify([...next])); return next; });
  const select = (id) => { if (multiple) onChange?.(selectedIds.includes(id) ? selectedIds : [...selectedIds, id]); else onChange?.(id); setOpen(false); };
  const remove = (id) => { if (multiple) onChange?.(selectedIds.filter((item) => item !== id)); else onChange?.(""); };
  const shellTheme = typeof document !== "undefined" && document.querySelector(".app-shell")?.classList.contains("dark") ? "dark" : "light";
  const popover = open && popoverLayout ? <div
    ref={popoverRef}
    className={`tree-project-popover tree-project-popover-portal theme-${shellTheme}`}
    data-placement={popoverLayout.placement}
    style={{ left: popoverLayout.left, top: popoverLayout.top, width: popoverLayout.width, maxHeight: popoverLayout.maxHeight }}
  >{visible.map((project) => <div className={`tree-project-option ${selectedIds.includes(project.id) ? "selected" : ""}`} style={{ "--tree-depth": project.depth }} key={project.id}><button className="tree-project-toggle" type="button" disabled={!project.hasChildren} onClick={() => project.hasChildren && toggleExpanded(project.id)}>{project.hasChildren ? (expanded.has(project.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span />}</button><button className="tree-project-name" type="button" onClick={() => select(project.id)}><Folder size={14} /><span title={pathFor(project.id, byId).map((item) => item.name).join(" > ")}>{project.name}</span><em>{Number(project.image_count || 0)}</em>{selectedIds.includes(project.id) && <Check size={13} />}</button></div>)}{!visible.length && <div className="muted">暂无数据集项目</div>}</div> : null;
  return <div ref={pickerRef} className="tree-project-picker" aria-label={ariaLabel}>
    {selectedIds.map((id) => <div className="tree-project-selection" key={id}><FolderOpen size={14} /><span title={pathFor(id, byId).map((item) => item.name).join(" > ")}>{pathFor(id, byId).map((item) => item.name).join(" > ")}</span><button type="button" title="取消选择" onClick={() => remove(id)}><X size={13} /></button></div>)}
    {(multiple || !selectedIds.length) && <button className="tree-project-empty" type="button" onClick={() => setOpen((current) => !current)}><Plus size={14} /><span>{selectedIds.length ? "继续添加数据集" : "添加选择数据集"}</span><ChevronDown size={14} /></button>}
    {popover && createPortal(popover, document.body)}
  </div>;
}
