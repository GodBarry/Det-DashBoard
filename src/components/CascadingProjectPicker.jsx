import { useMemo, useState } from "react";
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
  const [expanded, setExpanded] = useState(() => { try { return new Set(JSON.parse(localStorage.getItem(`det-dashboard.${storageKey}.expanded`) || "[]")); } catch { return new Set(); } });
  const byId = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const children = useMemo(() => { const map = new Map(); projects.forEach((project) => { const key = project.parent_id || "root"; if (!map.has(key)) map.set(key, []); map.get(key).push(project); }); return map; }, [projects]);
  const visible = [];
  const append = (parent = "root", depth = 0) => (children.get(parent) || []).forEach((project) => { const hasChildren = (children.get(project.id) || []).length > 0; visible.push({ ...project, depth, hasChildren }); if (hasChildren && expanded.has(project.id)) append(project.id, depth + 1); });
  append();
  const toggleExpanded = (id) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); localStorage.setItem(`det-dashboard.${storageKey}.expanded`, JSON.stringify([...next])); return next; });
  const select = (id) => { if (multiple) onChange?.(selectedIds.includes(id) ? selectedIds : [...selectedIds, id]); else onChange?.(id); setOpen(false); };
  const remove = (id) => { if (multiple) onChange?.(selectedIds.filter((item) => item !== id)); else onChange?.(""); };
  return <div className="tree-project-picker" aria-label={ariaLabel}>
    {selectedIds.map((id) => <div className="tree-project-selection" key={id}><FolderOpen size={14} /><span title={pathFor(id, byId).map((item) => item.name).join(" > ")}>{pathFor(id, byId).map((item) => item.name).join(" > ")}</span><button type="button" title="取消选择" onClick={() => remove(id)}><X size={13} /></button></div>)}
    {(multiple || !selectedIds.length) && <button className="tree-project-empty" type="button" onClick={() => setOpen((current) => !current)}><Plus size={14} /><span>{selectedIds.length ? "继续选择数据集" : "选择数据集"}</span><ChevronDown size={14} /></button>}
    {open && <div className="tree-project-popover">{visible.map((project) => <div className={`tree-project-option ${selectedIds.includes(project.id) ? "selected" : ""}`} style={{ "--tree-depth": project.depth }} key={project.id}><button className="tree-project-toggle" type="button" disabled={!project.hasChildren} onClick={() => project.hasChildren && toggleExpanded(project.id)}>{project.hasChildren ? (expanded.has(project.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span />}</button><button className="tree-project-name" type="button" onClick={() => select(project.id)}><Folder size={14} /><span>{project.name}</span><em>{Number(project.image_count || 0)}</em>{selectedIds.includes(project.id) && <Check size={13} />}</button></div>)}{!visible.length && <div className="muted">暂无数据集项目</div>}</div>}
  </div>;
}
