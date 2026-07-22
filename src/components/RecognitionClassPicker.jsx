import { useState } from "react";
import { Plus, Tags, X } from "lucide-react";

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

export function RecognitionClassPicker({ values = [], onChange }) {
  const [draft, setDraft] = useState("");
  const classes = Array.from(new Set(values.map(normalize).filter(Boolean)));

  const add = () => {
    const next = normalize(draft);
    if (!next) return;
    if (!classes.includes(next)) onChange?.([...classes, next]);
    setDraft("");
  };

  return <div className="recognition-class-picker" aria-label="识别类别选择">
    <div className="recognition-class-items">
      {classes.map((name) => <span className="recognition-class-item" key={name}>
        <Tags size={13} />
        <b>{name}</b>
        <button type="button" title={`移除 ${name}`} aria-label={`移除 ${name}`} onClick={() => onChange?.(classes.filter((item) => item !== name))}><X size={12} /></button>
      </span>)}
      <label className="recognition-class-add">
        <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} placeholder="添加识别类别" />
        <button type="button" title="添加识别类别" aria-label="添加识别类别" onClick={add} disabled={!normalize(draft)}><Plus size={13} /></button>
      </label>
    </div>
  </div>;
}
