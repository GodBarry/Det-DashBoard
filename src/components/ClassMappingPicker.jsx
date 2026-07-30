import { useMemo, useState } from "react";
import { ArrowRight, ChevronDown, ChevronRight, Plus, Tags, X } from "lucide-react";
import { normalizeClassMappings } from "./class-mapping-utils.js";

const clean = (value) => String(value || "").trim().toLowerCase();
const unique = (values) => Array.from(new Set((values || []).map(clean).filter(Boolean)));

export function ClassMappingPicker({ availableSources = [], mappings = null, configured = false, defaultTargets = [], onChange }) {
  const [expanded, setExpanded] = useState(false);
  const [selectedSources, setSelectedSources] = useState([]);
  const [targetDraft, setTargetDraft] = useState("");
  const rows = useMemo(() => configured ? normalizeClassMappings(mappings) : [], [configured, mappings]);
  const candidates = useMemo(() => unique(availableSources), [availableSources]);
  const usedSources = useMemo(() => new Set(rows.flatMap((row) => row.sources)), [rows]);
  const available = candidates.filter((source) => !usedSources.has(source));
  const emit = (next) => onChange?.({ configured: true, mappings: normalizeClassMappings(next) });
  const toggleSource = (source) => {
    setSelectedSources((current) => current.includes(source) ? current.filter((item) => item !== source) : [...current, source]);
    if (!selectedSources.length) setTargetDraft(source);
  };
  const addMapping = () => {
    const target = clean(targetDraft || selectedSources[0]);
    if (!target || !selectedSources.length) return;
    const existing = rows.find((row) => row.target === target);
    emit(existing
      ? rows.map((row) => row.target === target ? { ...row, sources: unique([...row.sources, ...selectedSources]) } : row)
      : [...rows, { target, sources: selectedSources }]);
    setSelectedSources([]);
    setTargetDraft("");
  };
  const addIdentity = (source) => emit([...rows, { target: source, sources: [source] }]);
  const resetDefault = () => {
    onChange?.({ configured: false, mappings: null });
    setSelectedSources([]);
    setTargetDraft("");
  };

  return <div className={`class-mapping-picker ${expanded ? "expanded" : "collapsed"}`} aria-label="类别映射">
    <button className="class-mapping-summary" type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>
      {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      <span>{configured ? `已映射 ${rows.length} 个目标类别` : `缺省同名映射 ${defaultTargets.length} 类`}</span>
      <em>数据集原类别 {candidates.length} 个</em>
    </button>
    {expanded && <div className="class-mapping-body">
      <div className="class-mapping-toolbar"><span>原类别</span><small>单击选择多个类别；右侧加号可直接建立同名映射</small><button type="button" onClick={resetDefault}>恢复缺省</button></div>
      <div className="class-mapping-candidates">
        {available.map((source) => <span className={selectedSources.includes(source) ? "selected" : ""} key={source}>
          <button type="button" title={`选择原类别 ${source}`} onClick={() => toggleSource(source)}><Tags size={11} />{source}</button>
          <button type="button" title={`${source} 同名映射`} onClick={() => addIdentity(source)}><Plus size={11} /></button>
        </span>)}
        {!available.length && <i>{candidates.length ? "所有原类别均已映射" : "请先选择包含标注的训练集、验证集或推理数据集"}</i>}
      </div>
      <div className="class-mapping-compose">
        <div>{selectedSources.length ? selectedSources.join("、") : "选择左侧原类别"}</div>
        <ArrowRight size={14} />
        <input value={targetDraft} placeholder={selectedSources[0] || "目标类别"} onChange={(event) => setTargetDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addMapping(); } }} />
        <button type="button" onClick={addMapping} disabled={!selectedSources.length} title="添加多对一映射"><Plus size={13} /></button>
      </div>
      <div className="class-mapping-list">
        {rows.map((row) => <div className="class-mapping-row" key={row.target}>
          <div>{row.sources.map((source) => <span key={source}>{source}</span>)}</div>
          <ArrowRight size={14} />
          <strong>{row.target}</strong>
          <button type="button" title={`删除映射 ${row.target}`} onClick={() => emit(rows.filter((item) => item.target !== row.target))}><X size={12} /></button>
        </div>)}
      </div>
      <p>配置映射后，未加入任何映射的原始类别会被屏蔽，不参与训练、推理统计与评估。</p>
    </div>}
  </div>;
}
