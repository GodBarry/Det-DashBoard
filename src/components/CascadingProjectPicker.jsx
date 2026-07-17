import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, FolderOpen, Plus, X } from "lucide-react";

function projectPath(projectId, byId) {
  const path = [];
  const seen = new Set();
  let cursor = byId.get(projectId);
  while (cursor && !seen.has(cursor.id)) {
    path.unshift(cursor);
    seen.add(cursor.id);
    cursor = cursor.parent_id ? byId.get(cursor.parent_id) : null;
  }
  return path;
}

export function CascadingProjectPicker({ projects = [], value = "", values = [], multiple = false, onChange, ariaLabel = "选择数据集" }) {
  const byId = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const children = useMemo(() => {
    const map = new Map();
    projects.forEach((project) => {
      const parent = project.parent_id || "root";
      if (!map.has(parent)) map.set(parent, []);
      map.get(parent).push(project);
    });
    return map;
  }, [projects]);
  const initialId = value || values[values.length - 1] || "";
  const [activePath, setActivePath] = useState(() => projectPath(initialId, byId));
  useEffect(() => {
    if (initialId) setActivePath(projectPath(initialId, byId));
  }, [initialId, byId]);
  const selectedIds = multiple ? values : [value].filter(Boolean);
  const columns = [];
  let parent = "root";
  for (let depth = 0; depth < Math.max(1, activePath.length + 1); depth += 1) {
    const options = children.get(parent) || [];
    if (!options.length) break;
    columns.push({ depth, parent, options, selected: activePath[depth]?.id || "" });
    parent = activePath[depth]?.id;
    if (!parent) break;
  }
  const choose = (depth, id) => {
    const nextPath = [...activePath.slice(0, depth), byId.get(id)].filter(Boolean);
    setActivePath(nextPath);
    if (!multiple && !(children.get(id) || []).length) onChange?.(id);
  };
  const toggleCurrent = () => {
    const id = activePath[activePath.length - 1]?.id;
    if (!id) return;
    onChange?.(selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]);
  };
  return (
    <div className="cascading-project-picker" aria-label={ariaLabel}>
      <div className="cascading-project-levels">
        {columns.map((column, index) => <div className="cascading-project-level" key={`${column.parent}-${column.depth}`}>
          {index > 0 && <ChevronRight size={14} />}
          <label className="path-select"><FolderOpen size={14} /><select value={column.selected} onChange={(event) => choose(column.depth, event.target.value)}><option value="">选择第 {column.depth + 1} 级</option>{column.options.map((project) => <option key={project.id} value={project.id}>{project.name} · {Number(project.image_count || 0)} 图像</option>)}</select></label>
        </div>)}
        {multiple && <button className="cascading-project-add" type="button" disabled={!activePath.length} onClick={toggleCurrent} title="添加或取消当前数据集">{selectedIds.includes(activePath[activePath.length - 1]?.id) ? <Check size={14} /> : <Plus size={14} />}</button>}
      </div>
      {multiple && selectedIds.length > 0 && <div className="cascading-project-tags">{selectedIds.map((id) => <button type="button" key={id} onClick={() => onChange?.(selectedIds.filter((item) => item !== id))} title="取消选择"><span>{projectPath(id, byId).map((item) => item.name).join(" / ")}</span><X size={12} /></button>)}</div>}
    </div>
  );
}
