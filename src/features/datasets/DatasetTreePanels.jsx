import { useMemo } from "react";
import {
  ChevronDown,
  ChevronRight,
  Edit3,
  Folder,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  RefreshCw,
  RotateCcw,
  Tags,
  Trash2,
  Video,
} from "lucide-react";

import { formatCount } from "../../shared/presentation.js";

export function HomeSidebar({ projects, currentFolder, currentFolderId, setCurrentFolderId, expandedIds, setExpandedIds, openProject, openHomeFolder, createProject, stats }) {

const childrenByParent = useMemo(() => {

const map = new Map();

for (const project of projects || []) {

const key = project.parent_id || "root";

if (!map.has(key)) map.set(key, []);

map.get(key).push(project);

}

for (const rows of map.values()) rows.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));

return map;

}, [projects]);

const rootRows = childrenByParent.get("root") || [];

return (

<aside className="workspace-sidebar home-sidebar">

<div className="sidebar-head">

<div>

<span>项目目录</span>

<b>{currentFolder?.name || "全部项目"}</b>

</div>

<button title="新建项目" onClick={createProject}><FolderPlus size={15} /></button>

</div>

<div className="tree-list">

{rootRows.map((project) => (

<HomeTreeNode

key={project.id}

project={project}

childrenByParent={childrenByParent}

currentFolderId={currentFolderId}

setCurrentFolderId={setCurrentFolderId}

expandedIds={expandedIds}

setExpandedIds={setExpandedIds}

openProject={openProject}

openHomeFolder={openHomeFolder}

depth={0}

/>

))}

</div>

<div className="storage-meter dataset-asset-meter">

<div><span>项目资产</span></div>

<progress value={Math.min(100, stats.images ? 14 : 0)} max="100" />

<em><b>{formatCount(stats.images)} 图像</b><b>{formatCount(stats.videos)} 视频</b></em>

</div>

</aside>

);

}

export function HomeTreeNode({ project, childrenByParent, currentFolderId, setCurrentFolderId, expandedIds, setExpandedIds, openProject, openHomeFolder, depth }) {

const children = childrenByParent.get(project.id) || [];

const active = currentFolderId === project.id;

const hasActiveDescendant = children.some((child) => child.id === currentFolderId || (childrenByParent.get(child.id) || []).some((grand) => grand.id === currentFolderId));

const open = expandedIds.has(project.id) || active || hasActiveDescendant;

const toggleOpen = (event) => {

event.stopPropagation();

if (!children.length) return;

setExpandedIds((current) => {

const next = new Set(current);

if (next.has(project.id)) next.delete(project.id);

else next.add(project.id);

return next;

});

};

return (

<div className="tree-node">

<button

className={active ? "active" : ""}

style={{ "--depth": depth }}

onClick={() => openHomeFolder(project)}

onDoubleClick={() => openProject(project)}

>

{children.length ? (

<span className="tree-toggle" role="button" tabIndex={-1} onClick={toggleOpen}>

{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}

</span>

) : <span className="tree-spacer" />}

{active ? <FolderOpen size={16} /> : <Folder size={16} />}

<span>{project.name}</span>

<em title="该项目及子目录中的图像数量">{formatCount(project.image_count || 0)} 图像</em>

</button>

{open && children.map((child) => (

<HomeTreeNode

key={child.id}

project={child}

childrenByParent={childrenByParent}

currentFolderId={currentFolderId}

setCurrentFolderId={setCurrentFolderId}

expandedIds={expandedIds}

setExpandedIds={setExpandedIds}

openProject={openProject}

openHomeFolder={openHomeFolder}

depth={depth + 1}

/>

))}

</div>

);

}

export function HomeInspector({ stats, trashProjects, restoreProject, restoreAllProjects, emptyProjectTrash, deleteProjectPermanently }) {

return (

<aside className="inspector-panel home-inspector">

<section className="home-inspector-block stats-block">

<div className="inspector-title">

<h2>{stats.title === "全部项目" ? "全部项目统计" : `${stats.title}统计`}</h2>

<button title="刷新统计"><RefreshCw size={14} /></button>

</div>

<div className="inspector-stats">

<div><FolderOpen size={18} /><span>顶层项目数</span><b>{formatCount(stats.projects)}</b></div>

<div><ImageIcon size={18} /><span>当前范围图像</span><b>{formatCount(stats.images)}</b></div>

<div><Video size={18} /><span>当前范围视频</span><b>{formatCount(stats.videos)}</b></div>

<div><Tags size={18} /><span>当前范围标注</span><b>{formatCount(stats.annotations)}</b></div>

</div>

</section>

<section className="home-inspector-block home-trash-panel">

<div className="section-title-row compact-title">

<h2>回收</h2>

<span>共 {formatCount(trashProjects.length)} 项</span>

<span className="trash-toolbar-actions">

<button title="全部恢复" disabled={!trashProjects.length} onClick={restoreAllProjects}><RotateCcw size={14} /></button>

<button className="danger-icon" title="全部清空" disabled={!trashProjects.length} onClick={emptyProjectTrash}><Trash2 size={14} /></button>

</span>

</div>

<div className="trash-list">

{trashProjects.map((project) => (

<div className="trash-row" key={project.id}>

<Folder size={19} />

<div>

<b>{project.name}</b>

<span>删除时间：{project.deleted_at ? new Date(project.deleted_at).toLocaleString() : "--"}</span>

</div>

<span className="trash-row-actions"><button title="恢复项目" onClick={() => restoreProject(project.id)}><RotateCcw size={14} /></button><button title="永久删除" onClick={() => deleteProjectPermanently?.(project.id)}><Trash2 size={14} /></button></span>

</div>

))}

{!trashProjects.length && <div className="muted">回收站为空</div>}

</div>

</section>

</aside>

);

}

export function WorkspaceSidebar({ root, activeProject, projects, openProject, createProject, summary, expandedIds, setExpandedIds }) {
  const childrenByParent = useMemo(() => {
    const map = new Map();
    for (const project of projects || []) {
      const key = project.parent_id || "root";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(project);
    }
    for (const rows of map.values()) rows.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
    return map;
  }, [projects]);
  const rootRows = childrenByParent.get("root") || [];
  return (
    <aside className="workspace-sidebar home-sidebar">
      <div className="sidebar-head">
        <div>
          <span>项目目录</span>
          <b>{activeProject?.name || root?.name || "全部项目"}</b>
        </div>
        <button title="新建文件" onClick={createProject}><FolderPlus size={15} /></button>
      </div>
      <div className="tree-list">
        {rootRows.map((project) => (
          <TreeNode
            key={project.id}
            project={project}
            childrenByParent={childrenByParent}
            activeProject={activeProject}
            openProject={openProject}
            expandedIds={expandedIds}
            setExpandedIds={setExpandedIds}
            depth={0}
          />
        ))}
        {!rootRows.length && <p className="muted">当前目录没有下级文件</p>}
      </div>
      <div className="storage-meter">
        <div><span>存储使用</span><b>{formatCount(summary?.image_count || 0)} 图像</b></div>
        <progress value={Math.min(100, Number(summary?.image_count || 0) ? 12.5 : 0)} max="100" />
        <em>{Number(summary?.image_count || 0) ? "12.5%" : "0%"}</em>
      </div>
    </aside>
  );
}
export function TreeNode({ project, childrenByParent, activeProject, openProject, expandedIds, setExpandedIds, depth }) {

const children = childrenByParent.get(project.id) || [];

const active = activeProject?.id === project.id;

const hasActiveDescendant = children.some((child) => child.id === activeProject?.id || (childrenByParent.get(child.id) || []).some((grand) => grand.id === activeProject?.id));

const open = expandedIds?.has(project.id) || active || hasActiveDescendant;

const toggleOpen = (event) => {

event.stopPropagation();

if (!children.length) return;

setExpandedIds((current) => {

const next = new Set(current);

if (next.has(project.id)) next.delete(project.id);

else next.add(project.id);

return next;

});

};

return (

<div className="tree-node">

<button className={active ? "active" : ""} style={{ "--depth": depth }} onClick={() => openProject(project)}>

{children.length ? (

<span className="tree-toggle" role="button" tabIndex={-1} onClick={toggleOpen}>

{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}

</span>

) : <span className="tree-spacer" />}

{active ? <FolderOpen size={16} /> : <Folder size={16} />}

<span>{project.name}</span>

<em>{formatCount((project.image_count || 0) + (project.child_count || 0))}</em>

</button>

{open && children.map((child) => (

<TreeNode

key={child.id}

project={child}

childrenByParent={childrenByParent}

activeProject={activeProject}

openProject={openProject}

expandedIds={expandedIds}

setExpandedIds={setExpandedIds}

depth={depth + 1}

/>

))}

</div>

);

}

export function EditableProjectName({

project,

editingProjectId,

editingProjectName,

setEditingProjectName,

startRenameProject,

commitRenameProject,

cancelRenameProject,

}) {

const isEditing = editingProjectId === project.id;

if (!isEditing) {

return <h3 onDoubleClick={(event) => { event.stopPropagation(); startRenameProject(project); }}>{project.name}</h3>;

}

return (

<input

className="inline-name-input"

value={editingProjectName}

autoFocus

onClick={(event) => event.stopPropagation()}

onDoubleClick={(event) => event.stopPropagation()}

onChange={(event) => setEditingProjectName(event.target.value)}

onBlur={() => commitRenameProject(project)}

onKeyDown={(event) => {

if (event.key === "Enter") {

event.preventDefault();

event.currentTarget.blur();

}

if (event.key === "Escape") {

event.preventDefault();

cancelRenameProject();

}

}}

/>

);

}

export function WorkspaceFolders({

projects,

openProject,

deleteProject,

editingProjectId,

editingProjectName,

setEditingProjectName,

startRenameProject,

commitRenameProject,

cancelRenameProject,

projectLastImportAt,

}) {

if (!projects.length) return null;

return (

<section className="workspace-folders">

<div className="section-title-row compact-title">

<h2>文件</h2>

<span className="muted">{projects.length} </span>

</div>

<div className="project-grid workspace-folder-grid">

{projects.map((project) => (

<article className="project-folder" key={project.id} tabIndex={0} onClick={() => openProject(project)} onKeyDown={(event) => { if (event.key === "Enter") openProject(project); }}>

<div className="project-folder-icon project-stat-icon" aria-hidden="true"><FolderOpen size={25} /><ImageIcon className="project-folder-badge" size={12} /></div>

<div className="project-folder-body">

<EditableProjectName

project={project}

editingProjectId={editingProjectId}

editingProjectName={editingProjectName}

setEditingProjectName={setEditingProjectName}

startRenameProject={startRenameProject}

commitRenameProject={commitRenameProject}

cancelRenameProject={cancelRenameProject}

/>

<p className="project-folder-metrics">

<span><ImageIcon size={13} />{formatCount(project.image_count || 0)}</span>

<span><Video size={13} />{formatCount(project.video_count || 0)}</span>

<span><Folder size={13} />{formatCount(project.child_count || 0)}</span>

</p>

<span>最后导入： {projectLastImportAt.get(project.id) ? new Date(projectLastImportAt.get(project.id)).toLocaleString() : "暂无导入"}</span>

</div>

<div className="project-actions">

<button title="重命名" onClick={(event) => { event.stopPropagation(); startRenameProject(project); }}><Edit3 size={16} /></button>

<button title="删除文件" onClick={(event) => { event.stopPropagation(); deleteProject(project.id); }}><Trash2 size={16} /></button>

</div>

</article>

))}

</div>

</section>

);

}
