import React, { useEffect, useState } from "react";

import { Brain, ChevronDown, ChevronRight, Database, Download, Folder, FolderOpen } from "lucide-react";

export function AssetModelFamilyTree({ families, onSelect }) {
  const [modelGroupOpen, setModelGroupOpen] = useState(true);
  const [expandedFamilies, setExpandedFamilies] = useState(() => new Set(families.map((family) => family.family)));
  const [expandedVersions, setExpandedVersions] = useState(() => new Set());
  const [contextMenu, setContextMenu] = useState(null);

  useEffect(() => {
    if (!contextMenu) return undefined;

    const close = () => setContextMenu(null);
    const closeOnEscape = (event) => { if (event.key === "Escape") close(); };
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  const toggleFamily = (familyName) => {
    setExpandedFamilies((current) => {
      const next = new Set(current);
      if (next.has(familyName)) next.delete(familyName);
      else next.add(familyName);
      return next;
    });
  };

  const toggleVersion = (versionId) => {
    setExpandedVersions((current) => {
      const next = new Set(current);
      if (next.has(versionId)) next.delete(versionId);
      else next.add(versionId);
      return next;
    });
  };

  const openContextMenu = (event, node) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ ...node, x: Math.min(event.clientX, window.innerWidth - 220), y: Math.min(event.clientY, window.innerHeight - 120) });
  };

  const downloadVersion = (version, artifact = null) => {
    if (!version?.id) return;

    const query = artifact?.id ? `?artifactId=${encodeURIComponent(artifact.id)}` : "";
    const anchor = document.createElement("a");
    anchor.href = `/api/ml/model-versions/${encodeURIComponent(version.id)}/download${query}`;
    anchor.download = "";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setContextMenu(null);
  };

  return (
    <>
      <section className="asset-tree-group asset-model-tree">
        <button className="asset-tree-head" type="button" onClick={() => setModelGroupOpen((open) => !open)}>
          {modelGroupOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Database size={15} />
          <b>模型</b>
          <em>{families.length}</em>
        </button>
        {modelGroupOpen && <div className="asset-tree-children">
          {families.map((family) => {
            const open = expandedFamilies.has(family.family);
            return (
              <div className="asset-family-node" key={family.family}>
                <button className="asset-family-row" title="左键选择模型簇，右键下载最新模型" onClick={() => { toggleFamily(family.family); const latest = family.versions[0]; if (latest) onSelect?.({ key: `model-${latest.id}`, type: "模型簇最新权重", name: family.family, href: `/api/ml/model-versions/${encodeURIComponent(latest.id)}/download` }); }} onContextMenu={(event) => openContextMenu(event, { type: "family", family, version: family.versions[0] || null })}>
                  <span className="tree-toggle">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
                  {open ? <FolderOpen size={14} /> : <Folder size={14} />}
                  <span>{family.family}</span>
                  <em>{family.versions.length}</em>
                </button>
                {open && family.versions.map((version) => {
                  const artifacts = Array.isArray(version.artifacts) ? version.artifacts : [];
                  const versionOpen = expandedVersions.has(version.id);
                  return (
                    <React.Fragment key={version.id}>
                      <button className="depth-1 asset-version-row" title={`${version.training_job_id ? "训练任务产物" : "预训练版本"} · 右键下载模型权重`} onClick={() => { onSelect?.({ key: `model-${version.id}`, type: "模型权重", name: `${version.model_name || "模型"} / ${version.version_name}`, href: `/api/ml/model-versions/${encodeURIComponent(version.id)}/download` }); if (artifacts.length) toggleVersion(version.id); }} onContextMenu={(event) => openContextMenu(event, { type: "version", version })}>
                        {artifacts.length ? (versionOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <Brain size={13} />}<span>{version.version_name}<small>{version.training_job_id ? "训练任务" : "预训练"}</small></span><em>{artifacts.length} 文件</em>
                      </button>
                      {versionOpen && artifacts.map((artifact) => (
                        <button className="depth-2 asset-artifact-row" key={artifact.id} title="右键下载此文件" onClick={() => onSelect?.({ key: `artifact-${artifact.id}`, type: "模型文件", name: artifact.metadata_json?.relativePath || artifact.name || artifact.path?.split("/").pop() || "模型权重", href: `/api/ml/model-versions/${encodeURIComponent(version.id)}/download?artifactId=${encodeURIComponent(artifact.id)}` })} onContextMenu={(event) => openContextMenu(event, { type: "artifact", version, artifact })}>
                          <Download size={12} /><span>{artifact.metadata_json?.relativePath || artifact.name || artifact.path?.split("/").pop() || "模型权重"}</span><em>{Number(artifact.size || 0) >= 1048576 ? `${(Number(artifact.size) / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(Number(artifact.size || 0) / 1024))} KB`}</em>
                        </button>
                      ))}
                    </React.Fragment>
                  );
                })}
              </div>
            );
          })}
          {!families.length && <p className="resource-empty">暂无模型</p>}
        </div>}
      </section>
      {contextMenu && (
        <div className="model-tree-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu" onClick={(event) => event.stopPropagation()}>
          <strong>{contextMenu.type === "family" ? contextMenu.family.family : contextMenu.artifact?.metadata_json?.relativePath || contextMenu.version?.version_name}</strong>
          <button role="menuitem" disabled={!contextMenu.version?.id} onClick={() => downloadVersion(contextMenu.version, contextMenu.artifact)}><Download size={14} /><span>{contextMenu.type === "artifact" ? "下载此权重文件" : "下载模型权重"}</span></button>
          {!contextMenu.version?.id && <small>该模型簇暂无可下载权重</small>}
        </div>
      )}
    </>
  );
}
