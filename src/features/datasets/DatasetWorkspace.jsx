import React, { useRef } from "react";
import {
  ArrowLeft, CheckCircle, CheckCircle2, ChevronDown, ChevronRight, ClipboardList, Copy, Database, Download, Edit3, Eye,
  Folder, FolderOpen, FolderPlus, Globe2, Grid, Image as ImageIcon, Import, List, MoreVertical, Move,
  RefreshCw, RotateCcw, Search, Share2, SlidersHorizontal, Tags, Trash2, Upload, Video, X,
} from "lucide-react";
import {
  EditableProjectName, HomeInspector, HomeSidebar, WorkspaceFolders, WorkspaceSidebar,
} from "./DatasetTreePanels.jsx";
import { AnnotationOverlay, ImageViewer, labelColor } from "./ImageViewer.jsx";
import { AnnotationTaskPanel, PublicRequestDialog, ScopeTabs, ShareDialog } from "../../multi-user-ui.jsx";
import { formatCount } from "../../shared/presentation.js";
import { AuthenticatedImage } from "../../components/AuthenticatedImage.jsx";

export function DatasetWorkspace({ mode, viewModel }) {
  const {
    projects,
    currentFolder,
    currentFolderId,
    setCurrentFolderId,
    homeExpandedIds,
    setHomeExpandedIds,
    openProject,
    openHomeFolder,
    createProject,
    homeStats,
    breadcrumbs,
    datasetScope,
    setDatasetScope,
    homeSection,
    setHomeSection,
    currentUser,
    importDataFromHome,
    setError,
    error,
    visibleProjects,
    editingProjectId,
    editingProjectName,
    setEditingProjectName,
    startRenameProject,
    commitRenameProject,
    cancelRenameProject,
    projectLastImportAt,
    setProjectShareResource,
    setProjectPublicResource,
    deleteProject,
    trashProjects,
    restoreProject,
    restoreAllProjects,
    emptyProjectTrash,
    deleteProjectPermanently,
    projectShareResource,
    projectPublicResource,
    collaborationViewer,
    setCollaborationViewer,
    hasCurrentImages,
    workspaceRoot,
    activeProject,
    summary,
    activeBreadcrumbs,
    goHome,
    importData,
    exportProject,
    openWorkspaceTrash,
    exportFormat,
    setExportFormat,
    filters,
    setFilters,
    setPage,
    imports,
    latestImport,
    jobs,
    cancelLatestImport,
    activeChildProjects,
    trashImports,
    deleteImport,
    restoreImport,
    emptyImportTrash,
    items,
    selected,
    setSelected,
    page,
    viewerIndex,
    setViewerIndex,
    checkedIds,
    setCheckedIds,
    lastCheckedId,
    setLastCheckedId,
    deleteCheckedImages,
    showImportDialog,
    setShowImportDialog,
    parsedImportPaths,
    importPath,
    setImportPath,
    browseFolder,
    browseBusy,
    confirmImport,
    dirPicker,
    setDirPicker,
    dirPickerBusy,
    openDataRootPicker,
    chooseDir,
    showBaselineDialog,
    setShowBaselineDialog,
    baselineName,
    setBaselineName,
    baselineSources,
    toggleBaselineSource,
    baselineParams,
    setBaselineParams,
    baselineBusy,
    previewBaseline,
    baselinePreview,
    applyBaseline,
    baselineConflicts,
    activeConflictId,
    setActiveConflictId,
    selectedConflictIds,
    toggleConflict,
    resolveSelectedConflicts,
    setItems
  } = viewModel;

  if (mode === "home") {
    return (
      <>
<main className="home-workspace">

<HomeSidebar

projects={projects}

currentFolder={currentFolder}

currentFolderId={currentFolderId}

setCurrentFolderId={setCurrentFolderId}

expandedIds={homeExpandedIds}

setExpandedIds={setHomeExpandedIds}

openProject={openProject}

openHomeFolder={openHomeFolder}

createProject={createProject}

stats={homeStats}

/>

<section className="home-browser">

<div className="home-toolbar">

<div className="workspace-path-row">

<FolderOpen size={16} />

<button onClick={() => setCurrentFolderId(null)}>项目</button>

{!breadcrumbs.length && (

<>

<ChevronRight size={14} />

<button onClick={() => setCurrentFolderId(null)}>全部项目</button>

</>

)}

{breadcrumbs.map((project) => (

<React.Fragment key={project.id}>

<ChevronRight size={14} />

<button onClick={() => setCurrentFolderId(project.id)}>{project.name}</button>

</React.Fragment>

))}

</div>

<div className="workspace-commandbar home-commandbar">

<ScopeTabs value={datasetScope} onChange={(scope) => { setDatasetScope(scope); setCurrentFolderId(null); }} />

<button className={homeSection === "annotation" ? "active" : ""} onClick={() => setHomeSection(homeSection === "annotation" ? "projects" : "annotation")}><ClipboardList size={16} />{"协同标注"}</button>

{currentFolder && <button onClick={() => setCurrentFolderId(currentFolder.parent_id || null)}><ArrowLeft size={16} />返回</button>}

<button onClick={createProject}><FolderPlus size={16} />新建项目</button>

<button onClick={createProject}><FolderPlus size={16} />新建文件</button>

<button onClick={importDataFromHome}><Import size={16} />导入数据</button>

<button onClick={() => setError("请先进入具体项目后再导出数据集")}><Upload size={16} />导出数据</button>

<button onClick={() => document.querySelector(".home-trash-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" })}><Trash2 size={16} />回收</button>

</div>

</div>

{error && <div className="error-msg home-error-msg">{error}</div>}

{homeSection === "projects" ? <>

<div className="home-filterbar">

<label className="search-control"><Search size={15} /><input readOnly placeholder="搜索项目名称" /></label>

<select><option>视角：全</option></select>

<select><option>场景：全</option></select>

<select><option>标签：全</option></select>

<button className="more-filter-button">更多筛选<SlidersHorizontal size={14} /></button>

<div className="view-switch">

<button className="active" title="网格视图"><Grid size={16} /></button>

<button title="列表视图"><List size={16} /></button>

</div>

<span>{visibleProjects.length} 个文件夹</span>

</div>

<div className="project-grid home-project-grid">

{visibleProjects.map((project) => (

<article

className="project-folder"

key={project.id}

tabIndex={0}

aria-label={`文件夹 ${project.name}，单击打开`}

onClick={() => openHomeFolder(project)}

onDoubleClick={() => openProject(project)}

onKeyDown={(event) => { if (event.key === "Enter") openProject(project); }}

>

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

{(currentUser?.role === "admin" || project.owner_user_id === currentUser?.id) && <div className="project-actions">

<button title={"分享项目"} onClick={(event) => { event.stopPropagation(); setProjectShareResource({ ...project, resourceType: "project" }); }}><Share2 size={16} /></button>

<button title={"申请公开"} onClick={(event) => { event.stopPropagation(); setProjectPublicResource({ ...project, resourceType: "project" }); }}><Globe2 size={16} /></button>

<button title="重命名" onClick={(event) => { event.stopPropagation(); startRenameProject(project); }}><Edit3 size={16} /></button>

<button title="删除项目" aria-label={`删除 ${project.name}`} onDoubleClick={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); deleteProject(project.id); }}><Trash2 size={16} /></button>

</div>}

</article>

))}

{!visibleProjects.length && <div className="empty-state folder-empty">空文件夹</div>}

</div>

</> : <AnnotationTaskPanel projects={projects} currentUser={currentUser} onOpenItem={(item, context) => setCollaborationViewer({ item, context })} />}

</section>

<HomeInspector

stats={homeStats}

trashProjects={trashProjects}

restoreProject={restoreProject}

restoreAllProjects={restoreAllProjects}

emptyProjectTrash={emptyProjectTrash}

deleteProjectPermanently={deleteProjectPermanently}

/>

</main>

<ShareDialog open={Boolean(projectShareResource)} resource={projectShareResource} onClose={() => setProjectShareResource(null)} />

<PublicRequestDialog open={Boolean(projectPublicResource)} resource={projectPublicResource} onClose={() => setProjectPublicResource(null)} />

{collaborationViewer && <ImageViewer items={[collaborationViewer.item]} index={0} setIndex={() => {}} onClose={() => setCollaborationViewer(null)} readOnly={collaborationViewer.context?.readOnly} saveAnnotations={collaborationViewer.context?.save} onSaved={() => setCollaborationViewer(null)} />}

      </>
    );
  }

  return (
    <>
<div className={hasCurrentImages ? "workspace-layout" : "workspace-folder-layout"}>

<WorkspaceSidebar

root={workspaceRoot}

activeProject={activeProject}

projects={projects}

openProject={openProject}

createProject={createProject}

summary={summary}

expandedIds={homeExpandedIds}

setExpandedIds={setHomeExpandedIds}

/>

<main className="preview-area">

<div className="home-toolbar workspace-inline-toolbar">

<div className="workspace-path-row">

<button className="icon-only ghost" title="返回项目" onClick={goHome}><ArrowLeft size={16} /></button>

<FolderOpen size={16} />

<button onClick={goHome}>项目</button>

{activeBreadcrumbs.map((project) => (

<React.Fragment key={project.id}>

<ChevronRight size={14} />

<button onClick={() => openProject(project)}>{project.name}</button>

</React.Fragment>

))}

</div>

<div className="workspace-commandbar home-commandbar">

<button onClick={goHome}><ArrowLeft size={16} />返回</button>

<button onClick={createProject}><FolderPlus size={16} />新建文件</button>

<button onClick={importData}><Import size={16} />导入数据</button>

<button onClick={exportProject}><Upload size={16} />导出数据</button>

<button onClick={openWorkspaceTrash}><Trash2 size={16} />回收</button>

<label className="export-format">导出格式

<select value={exportFormat} onChange={(event) => setExportFormat(event.target.value)}>

<option value="labelme">LabelMe</option>

<option value="coco">COCO</option>

<option value="yolo">YOLO</option>

</select>

</label>

</div>

</div>

{hasCurrentImages && <FilterPanel summary={summary} filters={filters} setFilters={(next) => { setFilters(next); setPage(1); }} imports={imports} />}

<ProgressStrip latestImport={latestImport} jobs={jobs} error={error} onCloseError={() => setError(null)} onCancelImport={cancelLatestImport} />

<WorkspaceFolders

projects={activeChildProjects}

openProject={openProject}

deleteProject={deleteProject}

editingProjectId={editingProjectId}

editingProjectName={editingProjectName}

setEditingProjectName={setEditingProjectName}

startRenameProject={startRenameProject}

commitRenameProject={commitRenameProject}

cancelRenameProject={cancelRenameProject}

projectLastImportAt={projectLastImportAt}

/>

{hasCurrentImages ? (

<>

<ImportRecords imports={imports} trashImports={trashImports} deleteImport={deleteImport} restoreImport={restoreImport} emptyImportTrash={emptyImportTrash} />

<ImageGrid

items={items}

selected={selected}

setSelected={setSelected}

page={page}

setPage={setPage}

openViewer={(item) => setViewerIndex(items.findIndex((x) => x.id === item.id))}

checkedIds={checkedIds}

setCheckedIds={setCheckedIds}

lastCheckedId={lastCheckedId}

setLastCheckedId={setLastCheckedId}

deleteCheckedImages={deleteCheckedImages}

/>

</>

) : (

!activeChildProjects.length && !latestImport && <div className="empty-state folder-empty">空文件夹</div>

)}

</main>

<Inspector item={hasCurrentImages ? selected : null} summary={summary} />

</div>

{showImportDialog && (

<div className="overlay" onClick={() => setShowImportDialog(false)}>

<div className="import-dialog" onClick={(e) => e.stopPropagation()}>

<div className="import-dialog-head">

<div className="dialog-title">

<span className="dialog-title-icon"><Import size={18} /></span>

<div>

<h2>导入数据</h2>

<p>{activeProject?.name || "当前项目"} · 本地文件夹导入到服务器端资产</p>

</div>

</div>

<button className="icon-button" onClick={() => { setShowImportDialog(false); setError(null); }} aria-label="关闭导入数据">

<X size={16} />

</button>

</div>

<div className="import-dialog-body">

<div className="import-dialog-grid">

<section className="import-path-panel">

<div className="import-field-head">

<div>

<label htmlFor="dataset-import-path">路径队列</label>

<p>可多次浏览添加，或用分号分隔多个本地路径</p>

</div>

<span>{parsedImportPaths.length} 个路</span>

</div>

<div className="import-path-row">

<textarea

id="dataset-import-path"

value={importPath}

onChange={(e) => setImportPath(e.target.value)}

placeholder="F:\\ZBH\\统计用\\山地; F:\\ZBH\\统计用\\草地"

rows={4}

/>

<div className="import-path-tools">

<button className="primary" onClick={browseFolder} disabled={browseBusy}><FolderOpen size={14} />{browseBusy ? "打开" : "浏览"}</button>

<button onClick={() => setImportPath("")} disabled={!importPath.trim()}>清空</button>

</div>

</div>

<div className="import-path-list">

{parsedImportPaths.length ? parsedImportPaths.map((pathValue) => (

<span key={pathValue} title={pathValue}>{pathValue}</span>

)) : <em>等待选择本地文件</em>}

</div>

</section>

<aside className="import-profile-panel">

<div className="import-profile-block">

<span>目标位置</span>

<b>{activeProject?.name || "当前项目"}</b>

</div>

<div className="import-profile-block">

<span>扫描方式</span>

<b>递归扫描</b>

</div>

<div className="import-profile-list">

<div><CheckCircle2 size={14} />图片 / 视频资产入库</div>

<div><CheckCircle2 size={14} />同名 JSON 自动匹配</div>

<div><CheckCircle2 size={14} />导入记录可回</div>

</div>

</aside>

</div>

{error && <div className="error-msg">{error}</div>}

</div>

<div className="dialog-actions">

<button onClick={() => { setShowImportDialog(false); setError(null); }}>取消</button>

<button className="primary" onClick={confirmImport}>开始导入</button>

</div>

</div>

</div>

)}

{dirPicker && (

<div className="overlay" onClick={() => setDirPicker(null)}>

<div className="dir-dialog" onClick={(e) => e.stopPropagation()}>

<div className="section-title-row">

<h2>选择数据文件</h2>

<button onClick={() => setDirPicker(null)}><X size={14} /></button>

</div>

<div className="dir-current">{dirPicker.current}</div>

<div className="dir-actions">

<button onClick={() => openDataRootPicker(dirPicker.parent)} disabled={!dirPicker.parent || dirPickerBusy}><ArrowLeft size={14} />上一</button>

<button className="primary" onClick={() => chooseDir(dirPicker.current)} disabled={dirPickerBusy || dirPicker.current === "__drives__"}><FolderOpen size={14} />选择当前文件夹</button>

</div>

{error && <div className="error-msg">{error}</div>}

<div className="dir-list">

{dirPicker.dirs.map((dir) => (

<button key={dir.path} onClick={() => openDataRootPicker(dir.path)} disabled={dirPickerBusy}>

<Folder size={15} />

<span>{dir.name}</span>

</button>

))}

{!dirPicker.dirs.length && <div className="muted">当前目录下没有子文件</div>}

</div>

</div>

</div>

)}

{showBaselineDialog && (

<div className="overlay" onClick={() => setShowBaselineDialog(false)}>

<div className="baseline-dialog" onClick={(e) => e.stopPropagation()}>

<div className="section-title-row">

<h2>生成基准数据</h2>

<button onClick={() => setShowBaselineDialog(false)}><X size={14} /></button>

</div>

<label>基准项目名称<input value={baselineName} onChange={(e) => setBaselineName(e.target.value)} /></label>

<div className="baseline-layout">

<section>

<h3>来源项目</h3>

<div className="baseline-source-list">

{projects.map((project) => (

<label key={project.id} className="check-row">

<input type="checkbox" checked={baselineSources.includes(project.id)} onChange={() => toggleBaselineSource(project.id)} />

<span>{project.name} · {project.image_count || 0} </span>

</label>

))}

</div>

</section>

<section>

<h3>批量规则参数</h3>

<label>一致 IoU 阈值<input type="number" step="0.01" min="0" max="1" value={baselineParams.iouSame} onChange={(e) => setBaselineParams({ ...baselineParams, iouSame: Number(e.target.value) })} /></label>

<label>轻微冲突 IoU 阈值<input type="number" step="0.01" min="0" max="1" value={baselineParams.iouLight} onChange={(e) => setBaselineParams({ ...baselineParams, iouLight: Number(e.target.value) })} /></label>

<p className="muted">来源优先级按勾选顺序处理；当前第一版按来源优先级保留冲突标注，并打印冲突统计</p>

</section>

</div>

<div className="dialog-actions">

<button disabled={baselineBusy} onClick={previewBaseline}>预分</button>

<button className="primary" disabled={baselineBusy || !baselinePreview} onClick={applyBaseline}>应用并生成基准项</button>

</div>

{baselinePreview && (

<section className="baseline-report">

<h3>合并情况</h3>

<div className="baseline-stats">

<span>来源项目 <b>{baselinePreview.summary.source_projects}</b></span>

<span>来源图片 <b>{baselinePreview.summary.source_images}</b></span>

<span>去重后图像<b>{baselinePreview.summary.unique_images}</b></span>

<span>自动一致<b>{baselinePreview.summary.auto_resolved}</b></span>

<span>冲突图片 <b>{baselinePreview.summary.conflicts}</b></span>

<span>预计保留标注 <b>{baselinePreview.summary.annotations_kept}</b></span>

</div>

<pre>{JSON.stringify(baselinePreview.summary.by_type || {}, null, 2)}</pre>

<div className="merge-log">

{(baselinePreview.logs || []).slice(0, 80).map((line, index) => <p key={index}>{line}</p>)}

</div>

<ConflictReview

conflicts={baselineConflicts}

activeId={activeConflictId}

setActiveId={setActiveConflictId}

selectedIds={selectedConflictIds}

toggleSelected={toggleConflict}

resolveSelected={resolveSelectedConflicts}

/>

</section>

)}

{error && <div className="error-msg">{error}</div>}

</div>

</div>

)}

{viewerIndex != null && items[viewerIndex] && (

<ImageViewer

items={items}

index={viewerIndex}

setIndex={setViewerIndex}

onClose={() => setViewerIndex(null)}

onSaved={(imageId, annotations) => {

setItems((rows) => rows.map((row) => row.id === imageId ? { ...row, annotations, annotation_count: annotations.length } : row));

setSelected((row) => row?.id === imageId ? { ...row, annotations, annotation_count: annotations.length } : row);

}}

/>

)}

    </>
  );
}

function optionList(values) {

return Array.from(new Set((values || []).filter(Boolean)));

}

function FilterPanel({ summary, filters, setFilters, imports }) {

const set = (key, value) => setFilters({ ...filters, [key]: value });

const toggle = (key, value) => {

const current = filters[key] || [];

set(key, current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);

};

const clear = () => setFilters({ q: "", scenes: [], views: [], modalities: [], labels: [], importBatchIds: [] });

return (

<aside className="filter-panel">

<h2>筛选条</h2>

<label className="search-control"><Search size={15} /><input value={filters.q} onChange={(e) => set("q", e.target.value)} placeholder="搜索文件" /></label>

<MultiFilter title="视角" values={optionList(summary?.views)} selected={filters.views} onToggle={(value) => toggle("views", value)} />

<MultiFilter title="场景" values={optionList(summary?.scenes)} selected={filters.scenes} onToggle={(value) => toggle("scenes", value)} />

<MultiFilter title="模态" values={[["infrared", "IR"], ["visible", "RGB"]]} selected={filters.modalities} onToggle={(value) => toggle("modalities", value)} />

<MultiFilter title="标签" values={optionList(summary?.labels)} selected={filters.labels} onToggle={(value) => toggle("labels", value)} />

<details className="filter-dropdown more-filter">

<summary>更多筛选<SlidersHorizontal size={14} /></summary>

<div className="filter-menu">

<MultiFilter title="导入批次" values={imports.map((x) => [x.id, new Date(x.created_at).toLocaleString()])} selected={filters.importBatchIds} onToggle={(value) => toggle("importBatchIds", value)} />

<button className="clear-filters" onClick={clear}>清空筛</button>

</div>

</details>

<div className="view-switch">

<button className="active" title="网格视图"><Grid size={16} /></button>

<button title="列表视图"><List size={16} /></button>

</div>

</aside>

);

}

function MultiFilter({ title, values, selected = [], onToggle }) {

const detailsRef = useRef(null);

const normalized = values.map((item) => Array.isArray(item) ? item : [item, item]);

const label = selected.length ? `${selected.length} 已选` : "全部";

const toggleValue = (value) => {

onToggle(value);

window.setTimeout(() => detailsRef.current?.removeAttribute("open"), 0);

};

return (

<details className="filter-group filter-dropdown" ref={detailsRef}>

<summary><span>{title}</span><b>{label}</b><ChevronDown size={14} /></summary>

<div className="check-list filter-menu">

{normalized.map(([value, label]) => (

<label className="check-row" key={value}>

<input type="checkbox" checked={selected.includes(value)} onChange={() => toggleValue(value)} />

<span>{label}</span>

</label>

))}

{!normalized.length && <div className="muted">暂无选项</div>}

</div>

</details>

);

}
function ProgressStrip({ latestImport, jobs, error, onCloseError, onCancelImport }) {

const runningStatuses = new Set(["pending", "scanning", "running", "cancel_requested", "preparing"]);

const visibleImport = latestImport && runningStatuses.has(latestImport.status) ? latestImport : null;

const latestExport = jobs.find((job) => job.type === "export" && runningStatuses.has(job.status));

const canCancelImport = visibleImport && ["scanning", "running", "cancel_requested"].includes(visibleImport.status);

return (

<div className="progress-stack">

{error && (

<div className="error-banner">

<span>{error}</span>

<button onClick={onCloseError}>&times;</button>

</div>

)}

{visibleImport && <ProgressBar title="导入进度" message={visibleImport.message || visibleImport.status} progress={visibleImport.progress || 0} onCancel={canCancelImport ? onCancelImport : null} />}

{latestExport && <ProgressBar title="导出进度" message={latestExport.message || latestExport.status} progress={latestExport.progress || 0} />}

</div>

);

}

function ProgressBar({ title, message, progress, onCancel }) {

return (

<div className="progress-card">

<div><span>{title}</span><b>{message}</b></div>

<progress value={progress} max="100" />

<em>{progress}%</em>

{onCancel && <button className="cancel-progress" onClick={onCancel}>取消</button>}

</div>

);

}

function ImageGrid({ items, selected, setSelected, page, setPage, openViewer, checkedIds, setCheckedIds, lastCheckedId, setLastCheckedId, deleteCheckedImages }) {

const allChecked = items.length > 0 && items.every((item) => checkedIds.includes(item.id));

const toggleItem = (event, id) => {

event.stopPropagation();

const pageIds = items.map((item) => item.id);

const currentIndex = pageIds.indexOf(id);

const previousIndex = pageIds.indexOf(lastCheckedId);

const shouldCheck = !checkedIds.includes(id);

setCheckedIds((ids) => {

if (event.shiftKey && previousIndex >= 0 && currentIndex >= 0) {

const [start, end] = previousIndex < currentIndex ? [previousIndex, currentIndex] : [currentIndex, previousIndex];

const range = pageIds.slice(start, end + 1);

return shouldCheck ? Array.from(new Set([...ids, ...range])) : ids.filter((item) => !range.includes(item));

}

return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];

});

setLastCheckedId(id);

};

const togglePage = () => setCheckedIds((ids) => {

const pageIds = items.map((item) => item.id);

if (pageIds.every((id) => ids.includes(id))) return ids.filter((id) => !pageIds.includes(id));

return Array.from(new Set([...ids, ...pageIds]));

});

return (

<section className="preview-panel">

<div className="preview-head">

<div><h2>数据预览</h2><p>当前筛选结果 · 双击缩略图打开大图</p></div>

<div className="bulk-actions">

<label><input type="checkbox" checked={allChecked} onChange={togglePage} />本页全</label>

<span>{checkedIds.length} 已</span>

</div>

</div>

<div className="asset-grid">

{items.map((item) => (

<button className={`asset-card ${selected?.id === item.id ? "active" : ""}`} key={item.id} onClick={() => setSelected(item)} onDoubleClick={() => openViewer(item)}>

{checkedIds.includes(item.id) ? <span className="selected-mark"><CheckCircle size={18} /></span> : <span className="select-box"><input type="checkbox" checked={false} onClick={(event) => toggleItem(event, item.id)} onChange={() => {}} /></span>}

<div className="thumb-wrap" style={{ aspectRatio: `${Number(item.image_width || 16)} / ${Number(item.image_height || 9)}` }}>

<AuthenticatedImage src={`/api/project-images/${item.id}/thumb`} loading="lazy" />

<AnnotationOverlay item={item} compact />

<span className="thumb-tags"><em>{item.view || "视角"}</em><em>{item.modality === "infrared" ? "IR" : "RGB"}</em></span>



<b className="thumb-name">{item.display_name}</b>

</div>

</button>

))}

{!items.length && <div className="empty-state">该级文件夹无数据</div>}

</div>

<div className="dataset-bottom-bar">

<label><input type="checkbox" checked={allChecked} onChange={togglePage} />已选择 {checkedIds.length} </label>

<button disabled={!selected} onClick={() => selected && openViewer(selected)}><Eye size={14} />查看标签</button>

<button disabled={!checkedIds.length} onClick={() => window.alert("下载功能待接入后端批量导出接")}><Download size={14} />下载</button>

<button disabled={!checkedIds.length} onClick={() => window.alert("移动功能待接入项目内文件移动接口")}><Move size={14} />移动</button>

<button disabled={!checkedIds.length} onClick={() => window.alert("复制功能待接入项目内文件复制接口")}><Copy size={14} />复制</button>

<button disabled={!checkedIds.length} onClick={deleteCheckedImages}>删除</button>

<div className="pager">

<span>共 {formatCount(items.length)} 项</span>

<button disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronRight className="prev-icon" size={15} /></button>

<b>{page}</b>

<span>/ {Math.max(page, page + (items.length ? 1 : 0))}</span>

<button onClick={() => setPage(page + 1)}><ChevronRight size={15} /></button>

<select defaultValue="48">

<option value="48">48 项</option>

<option value="100">100 项</option>

</select>

</div>

</div>

</section>

);

}

function ImportRecords({ imports, trashImports, deleteImport, restoreImport, emptyImportTrash }) {

return (

<section className="records-panel">

<h2>导入记录</h2>

{imports.map((item) => (

<div className="record-row" key={item.id}>

<div><b>{pathName(item.source_path)}</b><span>{item.message} · {new Date(item.created_at).toLocaleString()}</span></div>

<button onClick={() => deleteImport(item.id)}><Trash2 size={14} />删除本次导入</button>

</div>

))}

{!imports.length && <div className="muted">暂无导入记录</div>}

<div className="section-title-row">

<h3>导入回收</h3>

<button disabled={!trashImports.length} onClick={emptyImportTrash}>清空回收</button>

</div>

{trashImports.map((item) => (

<div className="record-row deleted" key={item.id}>

<div><b>{pathName(item.source_path)}</b><span>{item.message}</span></div>

<button onClick={() => restoreImport(item.id)}><RotateCcw size={14} />恢复</button>

</div>

))}

{!trashImports.length && <div className="muted">导入回收站为空</div>}

</section>

);

}

function pathName(value = "") {

return value.split(/[\\/]/).filter(Boolean).pop() || value;

}

function ConflictReview({ conflicts, activeId, setActiveId, selectedIds, toggleSelected, resolveSelected }) {

if (!conflicts.length) {

return <div className="conflict-empty">当前预分析没有发现标注冲突</div>;

}

const active = conflicts.find((item) => item.id === activeId) || conflicts[0];

const preview = active?.preview_json || {};

const sources = preview.sources || [];

return (

<div className="conflict-review">

<aside className="conflict-list">

<div className="section-title-row">

<h3>冲突图片</h3>

<span>{selectedIds.length} 已</span>

</div>

{conflicts.map((item, index) => (

<button key={item.id} className={`conflict-item ${active?.id === item.id ? "active" : ""}`} onClick={() => setActiveId(item.id)}>

<input type="checkbox" checked={selectedIds.includes(item.id)} onClick={(event) => { event.stopPropagation(); toggleSelected(item.id); }} onChange={() => {}} />

<b>冲突 {index + 1}</b>

<span>{item.conflict_type} · {item.severity} · {item.status}</span>

</button>

))}

</aside>

<main className="conflict-stage">

{sources[0]?.image_id ? (

<AuthenticatedImage src={`/api/project-images/${sources[0].image_id}/full`} />

) : (

<div className="empty-state">没有可预览图</div>

)}

<div className="merge-log compact">

{(preview.log || []).map((line, index) => <p key={index}>{line}</p>)}

</div>

</main>

<aside className="conflict-side">

<h3>来源对比</h3>

{sources.map((source) => (

<div className="source-row" key={source.project_id}>

<div>

<b>{source.project_name}</b>

<span>{source.annotations} 标注</span>

</div>

<button onClick={() => resolveSelected(`source_project:${source.project_id}`)}>保留该来</button>

</div>

))}

<button onClick={() => resolveSelected("pending")}>标记待复</button>

</aside>

</div>

);

}

function Inspector({ item, summary }) {

const topLabels = optionList(summary?.labels).slice(0, 6);

if (!item) {

return (

<aside className="inspector-panel">

<div className="inspector-title"><h2>数据集统计</h2><button title="刷新"><RefreshCw size={14} /></button></div>

<InspectorStats summary={summary} labels={topLabels} />

<p className="muted">选择一张图片查看详情</p>

</aside>

);

}

const annotations = item.annotations || [];

const grouped = annotations.reduce((acc, ann) => {

acc[ann.label] = (acc[ann.label] || 0) + 1;

return acc;

}, {});

return (

<aside className="inspector-panel">

<div className="inspector-title"><h2>数据集统计</h2><button title="刷新"><RefreshCw size={14} /></button></div>

<InspectorStats summary={summary} labels={topLabels} />

<section className="image-info-panel">

<h3>图像信息 <span>({item.display_name})</span></h3>

<div className="kv path-kv"><span>绝对路径</span><b>{item.absolute_path || item.source_path || "未记"}</b></div>

<div className="kv"><span>文件</span><b>{item.display_name}</b></div>

<div className="kv"><span>尺寸</span><b>{item.image_width || "--"} × {item.image_height || "--"}</b></div>

<div className="kv"><span>场景</span><b>{item.scene || "--"}</b></div>

<div className="kv"><span>视角</span><b>{item.view || "--"}</b></div>

<div className="kv"><span>模态</span><b>{item.modality === "infrared" ? "IR" : "RGB"}</b></div>

<div className="kv"><span>坐标</span><b>WGS84</b></div>

</section>

<section className="annotation-list">

<h3>标签（{annotations.length}</h3>

<div className="annotation-table-head"><span>类别</span><span>数量</span><span>操作</span></div>

{Object.entries(grouped).map(([label, count]) => (

<div className="annotation-table-row" key={label}>

<span><i style={{ background: labelColor(label) }} />{label}</span>

<b>{count}</b>

<em><Eye size={14} /><MoreVertical size={14} /></em>

</div>

))}

{!annotations.length && <p className="muted">当前筛选下没有标注框</p>}

</section>

</aside>

);

}

function InspectorStats({ summary, labels }) {

const imageCount = Number(summary?.image_count || 0);

const labeledImageCount = Number(summary?.labeled_image_count || 0);

const annotationCount = Number(summary?.annotation_count || 0);

const labelRows = Array.isArray(summary?.label_counts)
  ? summary.label_counts.map((item) => ({ label: item.label, count: Number(item.count || 0) })).filter((item) => item.label)
  : labels.map((label) => ({ label, count: 0 }));

const labelCount = labelRows.length || optionList(summary?.labels).length;

const maxLabelCount = Math.max(1, ...labelRows.map((item) => item.count));

return (

<>

<section className="inspector-stats">

<div><ImageIcon size={15} /><span>图像数量</span><b>{formatCount(imageCount)}</b></div>

<div><CheckCircle size={15} /><span>已标注图</span><b>{formatCount(labeledImageCount)}</b></div>

<div><Tags size={15} /><span>标注框总数</span><b>{formatCount(annotationCount)}</b></div>

<div><Database size={15} /><span>类别</span><b>{formatCount(labelCount)}</b></div>

</section>

<section className="class-bars">

<h3>类别分布（标注框）</h3>

{labelRows.slice(0, 6).map((item) => (

<p key={item.label}>

<span><i style={{ background: labelColor(item.label) }} />{item.label}</span>

<strong><em style={{ width: `${Math.max(8, Math.round((item.count / maxLabelCount) * 100))}%`, background: labelColor(item.label) }} /></strong>

<b>{formatCount(item.count)}</b>

</p>

))}

{!labelRows.length && <small className="muted">暂无类别统计</small>}

</section>

</>

);

}
