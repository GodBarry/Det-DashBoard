import React from "react";

import { Download, Edit3, Eye, Globe2, MoreVertical, Share2 } from "lucide-react";

export function AssetActionButtons({ resource, onShare, onPublic, downloadHref = "" }) {
  return (
    <div className="asset-actions">
      <button title="查看"><Eye size={13} /></button>
      {downloadHref && <button title="下载资产" onClick={() => { const anchor = document.createElement("a"); anchor.href = downloadHref; anchor.click(); }}><Download size={13} /></button>}
      <button title="分享" disabled={!resource} onClick={() => onShare?.(resource)}><Share2 size={13} /></button>
      <button title="申请公开" disabled={!resource} onClick={() => onPublic?.(resource)}><Globe2 size={13} /></button>
      <button title="编辑"><Edit3 size={13} /></button>
      <button title="更多"><MoreVertical size={13} /></button>
    </div>
  );
}
