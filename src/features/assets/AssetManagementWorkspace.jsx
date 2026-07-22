import React, { useState } from "react";

import {
  Boxes,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cpu,
  Database,
  Download,
  Edit3,
  Eye,
  FolderOpen,
  Globe2,
  RefreshCw,
  Search,
  Share2,
  Upload,
} from "lucide-react";

import { AssetActionButtons } from "./AssetActionButtons.jsx";
import { AssetDrawer } from "./AssetDrawer.jsx";
import { AssetModelFamilyTree } from "./AssetModelFamilyTree.jsx";
import { AssetResourceGroup } from "./AssetResourceGroup.jsx";

export function AssetManagementWorkspace({

projects,

mlModels,

modelVersions,

algorithmAssets,

trainingTemplates,

pythonEnvs,

assetLinks,

modelForm,

setModelForm,

versionForm,

setVersionForm,

envForm,

setEnvForm,

createModel,

createModelVersion,

createPythonEnv,

renameModelVersion,

drawerMode,

setDrawerMode,

assetScope,

setAssetScope,

currentUser,

userPermissions,

refreshAssets,


ScopeTabs,

ShareDialog,

PublicRequestDialog,

formatDateTime,

modelFamilyLabel,

envTooltip,
}) {

const algorithms = algorithmAssets.length ? algorithmAssets : trainingTemplates;
const [selectedExportAsset, setSelectedExportAsset] = useState(null);
const [exportDialog, setExportDialog] = useState(null);
const [shareResource, setShareResource] = useState(null);
const [publicResource, setPublicResource] = useState(null);
const openAssetExport = (asset) => {
  if (!asset?.href) return;
  setSelectedExportAsset(asset);
  setExportDialog({ ...asset, format: asset.type === "Python 环境" ? "tar.gz" : (asset.originalFormat || "original") });
};
const exportSelectedAsset = async () => {
  if (!exportDialog?.href) return;
  const separator = exportDialog.href.includes("?") ? "&" : "?";
  try {
    const response = await fetch(`${exportDialog.href}${separator}format=${encodeURIComponent(exportDialog.format || "original")}`, { credentials: "include" });
    if (!response.ok) throw new Error(await response.text() || `导出失败（${response.status}）`);
    const blob = await response.blob();
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = exportDialog.name || "asset-export";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(anchor.href);
    setExportDialog(null);
  } catch (error) {
    window.alert(error.message || "导出失败");
  }
};

const familyRows = Array.from(new Set(mlModels.map((model) => modelFamilyLabel(model.name)))).map((family) => {

const models = mlModels.filter((model) => modelFamilyLabel(model.name) === family);

const versions = modelVersions.filter((version) => models.some((model) => model.id === version.model_id));

return { family, models, versions };

});

const exportDialogView = exportDialog ? <div className="overlay asset-export-dialog-overlay" onClick={() => setExportDialog(null)}><section className="asset-export-dialog" onClick={(event) => event.stopPropagation()}><div className="section-title-row"><div><h2>导出资产</h2><p className="muted">{exportDialog.name}</p></div><button type="button" onClick={() => setExportDialog(null)}>×</button></div><label>导出格式<select value={exportDialog.format} onChange={(event) => setExportDialog({ ...exportDialog, format: event.target.value })}>{(exportDialog.type === "Python 环境" ? ["tar", "tar.gz"] : ["original", "pt", "pth", "onnx"]).map((format) => <option key={format} value={format}>{format === "original" ? "原始文件" : format}</option>)}</select></label><p className="muted asset-export-note">模型格式转换由算法适配器提供；没有对应转换器时将提示并保留原始文件。</p><div className="dialog-actions"><button type="button" onClick={() => setExportDialog(null)}>取消</button><button type="button" className="primary" onClick={exportSelectedAsset}><Download size={14} />开始导出</button></div></section></div> : null;

const stats = [

["算法适配", algorithms.length, Boxes],

["模型", familyRows.length || mlModels.length, Brain],

["模型版本", modelVersions.length, Database],

["Python 环境", pythonEnvs.length, Cpu],

];

const recentItems = [

modelVersions[0] ? ["登记权重", modelVersions[0].version_name, formatDateTime(modelVersions[0].created_at), modelVersions[0].created_by_name || "--", Upload] : null,

assetLinks[0] ? ["推理验证通过", assetLinks[0].algorithm_name || assetLinks[0].model_name || "已关联资产", formatDateTime(assetLinks[0].last_success_at), assetLinks[0].created_by_name || "--", CheckCircle2] : null,

pythonEnvs[0] ? ["环境检测完成", pythonEnvs[0].name, formatDateTime(pythonEnvs[0].created_at), pythonEnvs[0].created_by_name || "--", Cpu] : null,

algorithms[0] ? ["导入算法适配", algorithms[0].name, formatDateTime(algorithms[0].created_at), algorithms[0].created_by_name || "--", Boxes] : null,

].filter(Boolean);

return (

<div className={`asset-workspace ${drawerMode ? "drawer-open" : ""}`}>
{exportDialogView}

<aside className="asset-sidebar">

<h2>资产目录</h2>

<div className="asset-sidebar-scope">

<ScopeTabs value={assetScope} onChange={setAssetScope} />

</div>

<AssetResourceGroup title="算法适配" icon={Boxes} count={algorithms.length} defaultOpen={false}>

{algorithms.map((algorithm) => (

<button key={algorithm.id || algorithm.name}><Boxes size={14} /><span>{algorithm.name}</span><em>1</em></button>

))}

</AssetResourceGroup>

<AssetModelFamilyTree families={familyRows} onSelect={openAssetExport} />

<AssetResourceGroup title="预训练模型" icon={Download} count={modelVersions.filter((version) => version.stage === "pretrained").length} defaultOpen={false}>

{modelVersions.filter((version) => version.stage === "pretrained").map((version) => (

<button className={selectedExportAsset?.key === `model-${version.id}` ? "active" : ""} key={version.id} onClick={() => openAssetExport({ key: `model-${version.id}`, type: "模型权重", name: `${version.model_name} / ${version.version_name}`, href: `/api/ml/model-versions/${encodeURIComponent(version.id)}/download` })} onContextMenu={(event) => { event.preventDefault(); openAssetExport({ key: `model-${version.id}`, type: "模型权重", name: `${version.model_name} / ${version.version_name}`, href: `/api/ml/model-versions/${encodeURIComponent(version.id)}/download` }); }}><Brain size={14} /><span>{version.model_name} / {version.version_name}</span><Download size={13} /></button>

))}

</AssetResourceGroup>

<AssetResourceGroup title="Python 环境" icon={Cpu} count={pythonEnvs.length} defaultOpen>

{pythonEnvs.map((env) => (

<button className={selectedExportAsset?.key === `env-${env.id}` ? "active" : ""} key={env.id} onClick={() => openAssetExport({ key: `env-${env.id}`, type: "Python 环境", name: env.name, href: env.source_type === "conda_pack" && env.artifact_key ? `/api/ml/python-envs/${encodeURIComponent(env.id)}/download` : "" })} onContextMenu={(event) => { event.preventDefault(); if (env.artifact_key) openAssetExport({ key: `env-${env.id}`, type: "Python 环境", name: env.name, href: `/api/ml/python-envs/${encodeURIComponent(env.id)}/download` }); }} title={env.artifact_key ? "打开导出格式" : "此环境没有可导出的 conda-pack 资产"}><Cpu size={14} /><span>{env.name}</span><em>{env.artifact_key ? env.status : "不可导出"}</em></button>

))}

</AssetResourceGroup>

{selectedExportAsset && <div className="asset-export-selection"><div><span>{selectedExportAsset.type}</span><b title={selectedExportAsset.name}>{selectedExportAsset.name}</b></div><button type="button" disabled={!selectedExportAsset.href} onClick={exportSelectedAsset} title={selectedExportAsset.href ? `导出${selectedExportAsset.name}` : "该资产没有可下载归档"}><Download size={15} />{selectedExportAsset.href ? "导出" : "无归档"}</button></div>}

<div className="resource-usage asset-usage">

<div><span>存储使用</span><b>68%</b></div>

<progress value="68" max="100" />

<em>20 / 29 TB</em>

</div>

</aside>

<main className="asset-main">

<div className="asset-toolbar">

<div className="workspace-path-row">

<FolderOpen size={16} />

<button>{"\u8d44\u4ea7"}</button>

<ChevronRight size={14} />

<button>模型</button>

<ChevronRight size={14} />

<button>YOLOv8</button>

</div>

<div className="workspace-commandbar asset-commandbar">

{(currentUser?.role === "admin" || userPermissions.includes("assets.register")) && <>
<button onClick={() => setDrawerMode("cluster")}><span>+</span>登记模型簇</button>

<button onClick={() => { setVersionForm({ ...versionForm, stage: "pretrained" }); setDrawerMode("pretrained"); }}><Download size={15} />导入预训练模型</button>

<button onClick={() => { setVersionForm({ ...versionForm, stage: "candidate" }); setDrawerMode("version"); }}><span>+</span>登记模型库模型</button>

<button onClick={() => setDrawerMode("algorithm")}><span>+</span>导入算法适配</button>

<button onClick={() => setDrawerMode("env")}><span>+</span>登记Python 环境</button>
</>}

<button onClick={() => refreshAssets?.()}><RefreshCw size={15} />刷新</button>

</div>

</div>

<div className="asset-filterbar">

<label className="search-control"><Search size={15} /><input placeholder="搜索资产" /></label>

<select><option>类型：全</option></select>

<select><option>状态：全部</option></select>

<select><option>框架：全</option></select>

</div>

<section className="asset-overview">

<h2>资产概览</h2>

<div className="asset-overview-grid">

{stats.map(([label, value, Icon]) => (

<article key={label}>

<Icon size={24} />

<span>{label}</span>

<b>{value}</b>

</article>

))}

</div>

</section>

<section className="asset-section">

<h2>模型簇与版本</h2>

<div className="asset-table model-asset-table">

<div className="asset-table-head"><span>资产名称</span><span>算法名称</span><span>训练数据</span><span>生成时间</span><span>状态</span><span>MinIO路径</span><span>操作</span></div>

{familyRows.map((family) => (

<React.Fragment key={family.family}>

<div className="asset-table-row family-row">

<b><ChevronDown size={13} /><FolderOpen size={15} />{family.family}</b>

<span>{family.models[0]?.framework || "Ultralytics YOLO"}</span><span>--</span><span>--</span><em>正常</em><span>minio://models/{family.family.toLowerCase()}/</span><AssetActionButtons resource={family.models[0] ? { ...family.models[0], resourceType: "model" } : null} onShare={setShareResource} onPublic={setPublicResource} />

</div>

{family.versions.map((version) => (

<div className="asset-table-row child-row" key={version.id}>

<b><span className="tree-spacer" /><Brain size={14} />{version.version_name}</b>

<span>{version.model_name || family.family}</span><span>{version.dataset_project_name || "未绑定数据集"}</span><span>{formatDateTime(version.created_at)}</span><em>正常</em><span>{version.artifact_root || `minio://models/${family.family.toLowerCase()}/`}</span>

<div className="asset-actions"><button title="查看"><Eye size={13} /></button><button title="下载模型" onClick={() => openAssetExport({ key: `model-${version.id}`, type: "模型权重", name: `${version.model_name || family.family} / ${version.version_name}`, href: `/api/ml/model-versions/${encodeURIComponent(version.id)}/download` })}><Download size={13} /></button><button title="分享" onClick={() => setShareResource({ ...version, name: version.version_name, resourceType: "model_revision" })}><Share2 size={13} /></button><button title="申请公开" onClick={() => setPublicResource({ id: version.model_id, name: version.model_name, resourceType: "model" })}><Globe2 size={13} /></button><button title="重命名" onClick={() => renameModelVersion(version)}><Edit3 size={13} /></button></div>

</div>

))}

</React.Fragment>

))}

</div>

</section>

<section className="asset-section">

<h2>运行环境资产</h2>

<div className="asset-table env-asset-table">

<div className="asset-table-head"><span>Python 环境名称</span><span>Python版本</span><span>Torch版本</span><span>CUDA/CPU</span><span>状态</span><span>创建时间</span><span>资产包路径</span><span>操作</span></div>

{pythonEnvs.map((env) => (

<div className="asset-table-row" key={env.id} title={envTooltip(env)}>

<b>{env.name}</b><span>{String(env.python_version || "3.12").replace(/^Python\s*/i, "")}</span><span>{env.torch_version || "未检"}</span><span>{env.cuda_available ? `CUDA ${env.cuda_version || ""}` : "CPU"}</span><em>可用</em><span>{formatDateTime(env.created_at)}</span><span>{env.source_type === "conda_pack" ? env.artifact_key : env.python_path}</span><AssetActionButtons resource={{ ...env, resourceType: "runtime_env" }} onShare={setShareResource} onPublic={setPublicResource} downloadHref={env.artifact_key ? `/api/ml/python-envs/${encodeURIComponent(env.id)}/download` : ""} onDownload={() => openAssetExport({ key: `env-${env.id}`, type: "Python 环境", name: env.name, href: `/api/ml/python-envs/${encodeURIComponent(env.id)}/download` })} />

</div>

))}

</div>

</section>

<section className="asset-section">

<h2>算法适配</h2>

<div className="asset-table adapter-asset-table">

<div className="asset-table-head"><span>适配器名</span><span>框架</span><span>任务类型</span><span>版本</span><span>MinIO代码前缀</span><span>状态</span><span>操作</span></div>

{algorithms.map((algorithm) => (

<div className="asset-table-row" key={algorithm.id || algorithm.name}>

<b>{algorithm.name}</b><span>{algorithm.framework || "Custom"}</span><span>{algorithm.task_type || "目标检测"}</span><span>{algorithm.version || "builtin"}</span><span>{algorithm.minio_prefix || algorithm.manifest_key || `minio://adapters/${algorithm.algorithm_key || algorithm.template_key || "custom"}/`}</span><em>可用</em><AssetActionButtons resource={{ ...algorithm, resourceType: "algorithm" }} onShare={setShareResource} onPublic={setPublicResource} />

</div>

))}

</div>

</section>

</main>

<aside className="asset-inspector">

<div className="inspector-title"><h2>资产统计</h2><button><RefreshCw size={14} /></button></div>

<div className="asset-stat-grid">

<div><span>总资产</span><b>{algorithms.length + familyRows.length + modelVersions.length + pythonEnvs.length}</b><Boxes size={24} /></div>

<div><span>MinIO对象</span><b>{modelVersions.length + pythonEnvs.length + algorithms.length}</b><Database size={24} /></div>

<div><span>预训练权重</span><b>{modelVersions.filter((version) => version.stage === "pretrained").length}</b><Brain size={24} /></div>

<div><span>可运行环境</span><b>{pythonEnvs.filter((env) => env.status === "ready").length || pythonEnvs.length}</b><Cpu size={24} /></div>

</div>

<section className="activity-panel">

<div className="panel-title"><h3>最近活动</h3><button>查看全部</button></div>

{recentItems.map(([title, detail, time, user, Icon]) => (

<article className="activity-row" key={`${title}-${detail}`}>

<Icon size={15} />

<div><b>{title}</b><span>{detail}</span></div>

<em>{time}<br />{user}</em>

</article>

))}

{!recentItems.length && <p className="resource-empty">暂无活动</p>}

</section>

</aside>

{drawerMode && (

<AssetDrawer

mode={drawerMode}

setMode={setDrawerMode}

onClose={() => setDrawerMode(null)}

projects={projects}

mlModels={mlModels}

modelForm={modelForm}

setModelForm={setModelForm}

versionForm={versionForm}

setVersionForm={setVersionForm}

envForm={envForm}

setEnvForm={setEnvForm}

createModel={createModel}

createModelVersion={createModelVersion}

createPythonEnv={createPythonEnv}

/>

)}

<ShareDialog open={Boolean(shareResource)} resource={shareResource} onClose={() => setShareResource(null)} />

<PublicRequestDialog open={Boolean(publicResource)} resource={publicResource} onClose={() => setPublicResource(null)} />

</div>

);

}
