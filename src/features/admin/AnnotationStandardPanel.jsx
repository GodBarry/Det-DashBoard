import React, { useEffect, useMemo, useState } from "react";
import { BookOpen, Check, ChevronDown, ChevronRight, Image, Save } from "lucide-react";

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.message || `请求失败 (${response.status})`);
  return payload;
}

function buildTree(rows) {
  const children = new Map();
  rows.forEach((row) => {
    const key = row.parent_id || "root";
    children.set(key, [...(children.get(key) || []), row]);
  });
  return children;
}

function CategoryTree({ rows, selectedId, onSelect }) {
  const tree = useMemo(() => buildTree(rows), [rows]);
  const [expanded, setExpanded] = useState(() => new Set(rows.map((row) => row.parent_id).filter(Boolean)));

  const renderLevel = (parentId = "root", depth = 0) => (tree.get(parentId) || []).map((row) => {
    const nested = tree.get(row.id) || [];
    const open = expanded.has(row.id);
    return (
      <React.Fragment key={row.id}>
        <div className={`standard-tree-row${selectedId === row.id ? " active" : ""}`} style={{ paddingLeft: 10 + depth * 18 }}>
          <button
            type="button"
            className="standard-tree-toggle"
            disabled={!nested.length}
            aria-label={open ? `折叠 ${row.name_zh}` : `展开 ${row.name_zh}`}
            onClick={() => setExpanded((current) => {
              const next = new Set(current);
              if (next.has(row.id)) next.delete(row.id); else next.add(row.id);
              return next;
            })}
          >
            {nested.length ? (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span />}
          </button>
          <button type="button" className="standard-tree-name" onClick={() => onSelect(row.id)}>
            <span>{row.name_zh}</span><small>{row.name_en || row.code}</small>
          </button>
        </div>
        {open ? renderLevel(row.id, depth + 1) : null}
      </React.Fragment>
    );
  });

  return <div className="standard-tree">{renderLevel()}</div>;
}

const DEFINITION_FIELDS = [
  ["purpose", "作战用途"], ["firepower", "火力特点"], ["appearance", "外形特点"],
  ["role", "作战角色"], ["dimensions", "尺寸参考"], ["examples", "经典车型"],
];

export function AnnotationStandardPanel() {
  const [payload, setPayload] = useState({ version: null, categories: [], examples: [] });
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState(null);
  const [principles, setPrinciples] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    setBusy(true);
    setError("");
    try {
      const next = await requestJson("/api/annotation-standard");
      setPayload(next);
      setPrinciples(next.version?.principles_json || []);
      setSelectedId((current) => current || next.categories?.find((row) => row.code === "tank")?.id || next.categories?.[0]?.id || "");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { load(); }, []);
  const selected = payload.categories.find((row) => row.id === selectedId) || null;
  useEffect(() => {
    if (!selected) return setForm(null);
    setForm({ nameZh: selected.name_zh, nameEn: selected.name_en, definition: selected.definition_json || {}, rules: selected.rules_json || {} });
  }, [selectedId, selected]);

  const saveCategory = async () => {
    if (!selected || !form) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await requestJson(`/api/admin/annotation-standard/categories/${selected.id}`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(form),
      });
      setPayload((current) => ({ ...current, categories: current.categories.map((row) => row.id === selected.id ? result.category : row) }));
      setMessage(`已保存“${form.nameZh}”的规范定义`);
    } catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  };

  const savePrinciples = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await requestJson("/api/admin/annotation-standard/principles", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ versionId: payload.version.id, principles }),
      });
      setPayload((current) => ({ ...current, version: result.version }));
      setMessage("通用标注原则已保存");
    } catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  };

  const categoryExamples = payload.examples.filter((example) => example.category_id === selectedId);
  return (
    <section className="annotation-standard-panel" aria-label="标注规范管理">
      <header className="standard-summary">
        <div><h3>典型目标标注规范</h3><p>维护公共类别层级、识别定义和标注示范。当前尚未接入数据导入流程。</p></div>
        <span className="standard-version"><Check size={14} />{payload.version?.version || "--"} · {payload.version?.status === "published" ? "已发布" : "草稿"}</span>
      </header>
      {error ? <div className="standard-feedback error">{error}</div> : null}
      {message ? <div className="standard-feedback success">{message}</div> : null}
      <div className="standard-layout">
        <aside className="standard-column standard-catalog">
          <div className="standard-column-title"><BookOpen size={16} /><span>类别体系</span><b>{payload.categories.length}</b></div>
          {busy && !payload.version ? <div className="standard-empty">正在加载规范</div> : <CategoryTree rows={payload.categories} selectedId={selectedId} onSelect={setSelectedId} />}
        </aside>
        <main className="standard-column standard-editor">
          <div className="standard-column-title"><span>类别定义</span>{selected ? <code>{selected.code}</code> : null}</div>
          {form ? <>
            <div className="standard-name-grid">
              <label><span>中文名称</span><input value={form.nameZh} onChange={(event) => setForm({ ...form, nameZh: event.target.value })} /></label>
              <label><span>英文名称</span><input value={form.nameEn} onChange={(event) => setForm({ ...form, nameEn: event.target.value })} /></label>
            </div>
            <div className="standard-definition-grid">
              {DEFINITION_FIELDS.map(([key, label]) => <label key={key}><span>{label}</span><textarea value={form.definition[key] || ""} onChange={(event) => setForm({ ...form, definition: { ...form.definition, [key]: event.target.value } })} /></label>)}
            </div>
            <button className="standard-primary" type="button" disabled={busy} onClick={saveCategory}><Save size={15} />保存类别定义</button>
          </> : <div className="standard-empty">请从左侧选择一个类别</div>}
        </main>
        <aside className="standard-column standard-guidance">
          <div className="standard-column-title"><Image size={16} /><span>规范与图例</span></div>
          <section className="standard-principles">
            <h4>通用标注原则</h4>
            {principles.map((rule, index) => <label key={rule.key || index}>
              <input value={rule.title} onChange={(event) => setPrinciples((rows) => rows.map((item, rowIndex) => rowIndex === index ? { ...item, title: event.target.value } : item))} />
              <textarea value={rule.content} onChange={(event) => setPrinciples((rows) => rows.map((item, rowIndex) => rowIndex === index ? { ...item, content: event.target.value } : item))} />
            </label>)}
            <button type="button" className="standard-secondary" disabled={busy || !payload.version} onClick={savePrinciples}><Save size={14} />保存通用原则</button>
          </section>
          <section className="standard-examples">
            <h4>类别图例 <b>{categoryExamples.length}</b></h4>
            {categoryExamples.length ? categoryExamples.map((example) => <article key={example.id}><strong>{example.title}</strong><small>{example.explanation}</small></article>) : <div className="standard-empty compact">暂无图例。图例对象与正确/错误类型的数据结构已建立，后续接入 MinIO 图片上传。</div>}
          </section>
        </aside>
      </div>
    </section>
  );
}

