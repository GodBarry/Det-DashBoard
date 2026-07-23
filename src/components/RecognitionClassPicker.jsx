import { useState } from "react";
import { GripVertical, Plus, X } from "lucide-react";

import {
  moveRecognitionClass,
  normalizeRecognitionClass,
  parseRecognitionClasses,
} from "./recognition-class-utils.js";

export function RecognitionClassPicker({ values = [], onChange }) {
  const [draft, setDraft] = useState("");
  const [draggedIndex, setDraggedIndex] = useState(-1);
  const [dragOverIndex, setDragOverIndex] = useState(-1);
  const classes = Array.from(new Set(values.map(normalizeRecognitionClass).filter(Boolean)));

  const add = () => {
    const parsed = parseRecognitionClasses(draft);
    if (!parsed.length) return;
    const additions = parsed.filter((name) => !classes.includes(name));
    if (additions.length) onChange?.([...classes, ...additions]);
    setDraft("");
  };

  const reorder = (fromIndex, toIndex) => {
    const next = moveRecognitionClass(classes, fromIndex, toIndex);
    if (next !== classes) onChange?.(next);
  };

  return <div className="recognition-class-picker" aria-label="识别类别选择">
    <div className="recognition-class-items">
      {classes.map((name, index) => <span
        className={`recognition-class-item${draggedIndex === index ? " is-dragging" : ""}${dragOverIndex === index ? " is-drag-over" : ""}`}
        key={name}
        draggable
        onDragStart={(event) => {
          setDraggedIndex(index);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", name);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDragOverIndex(index);
        }}
        onDrop={(event) => {
          event.preventDefault();
          reorder(draggedIndex, index);
          setDraggedIndex(-1);
          setDragOverIndex(-1);
        }}
        onDragEnd={() => {
          setDraggedIndex(-1);
          setDragOverIndex(-1);
        }}
      >
        <button
          className="recognition-class-drag"
          type="button"
          title={`拖动调整 ${name} 的顺序；也可用左右方向键`}
          aria-label={`调整类别 ${name}，当前序号 ${index + 1}`}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            reorder(index, Math.max(0, Math.min(classes.length - 1, index + (event.key === "ArrowLeft" ? -1 : 1))));
          }}
        ><GripVertical size={12} /></button>
        <small title={`模型类别索引 ${index}`}>{index}</small>
        <b>{name}</b>
        <button className="recognition-class-remove" type="button" title={`移除 ${name}`} aria-label={`移除 ${name}`} onClick={() => onChange?.(classes.filter((item) => item !== name))}><X size={12} /></button>
      </span>)}
      <label className="recognition-class-add">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          placeholder="添加类别，可粘贴多个"
        />
        <button type="button" title="添加一个或多个识别类别" aria-label="添加一个或多个识别类别" onClick={add} disabled={!parseRecognitionClasses(draft).length}><Plus size={13} /></button>
      </label>
    </div>
    <p className="recognition-class-hint">拖动类别调整模型索引顺序；批量添加支持空格、逗号、顿号、分号或换行分隔。</p>
  </div>;
}
