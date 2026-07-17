const VIEW_LABELS = {
  oblique: "斜视",
  nadir: "正射俯视",
  aerial: "航拍视角",
  "aerial view": "航拍视角",
  top: "顶视",
  "top view": "顶视",
  front: "前视",
  rear: "后视",
  back: "后视",
  side: "侧视",
  left: "左视",
  right: "右视",
  ground: "地面视角",
  "ground view": "地面视角",
  unknownview: "未知视角",
  unknown: "未知视角",
};

const SCENE_LABELS = {
  urban: "城市",
  city: "城市",
  rural: "乡村",
  village: "村庄",
  highway: "高速公路",
  road: "道路",
  indoor: "室内",
  outdoor: "室外",
  mountain: "山区",
  forest: "森林",
  desert: "荒漠",
  sea: "海面",
  unknownscene: "未知场景",
  unknown: "未知场景",
};

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

export function modalityLabel(value) {
  const key = normalized(value).replace(/[\s_-]+/g, "");
  if (["infrared", "ir", "thermal", "thermalinfrared"].includes(key)) return "红外";
  if (["visible", "visiblelight", "rgb", "vis", "ccd", "color", "colour"].includes(key)) return "彩色";
  if (["grayscale", "greyscale", "gray", "grey", "mono", "monochrome"].includes(key)) return "灰度";
  return value || "未知模态";
}

export function viewLabel(value) {
  return VIEW_LABELS[normalized(value)] || value || "未知视角";
}

export function sceneLabel(value) {
  return SCENE_LABELS[normalized(value)] || value || "未知场景";
}

export function metadataOption(value, type) {
  return [value, metadataLabel(value, type)];
}

export function metadataLabel(value, type) {
  if (["view", "views"].includes(type)) return viewLabel(value);
  if (["scene", "scenes"].includes(type)) return sceneLabel(value);
  if (["modality", "modalities"].includes(type)) return modalityLabel(value);
  return value;
}
