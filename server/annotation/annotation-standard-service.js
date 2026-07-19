"use strict";

const DEFAULT_PRINCIPLES = [
  { key: "center", title: "目标中心点", content: "每个目标均记录中心点；矩形框场景由平台根据边界框自动计算，避免重复操作和坐标不一致。" },
  { key: "bbox", title: "目标边界框", content: "矩形框应覆盖完整目标并尽量贴合目标边缘。炮管等过长突出部可部分容纳，但不得遗漏目标主体。" },
  { key: "category", title: "类别标签", content: "标签必须明确准确；无法确认细分类别时选择能够确认的上级类别，并通过清晰度和确定性属性补充说明。" },
  { key: "occlusion", title: "遮挡处理", content: "目标被遮挡时仍按理论完整体积标注，并记录遮挡程度；密集排列目标应逐个标注。" },
  { key: "blur", title: "模糊目标", content: "模糊目标仍应尽量标注，语义类别与模糊属性分开记录。" },
];

const CATEGORY_SEED = [
  ["target", null, "目标类型", "Target Type", 10],
  ["vehicle", "target", "车辆", "Vehicle", 10],
  ["military_vehicle", "vehicle", "军用车辆", "Military Vehicle", 10],
  ["armored_vehicle", "military_vehicle", "装甲车", "Armored Vehicle", 10],
  ["tank", "armored_vehicle", "坦克", "Tank", 10],
  ["ifv", "armored_vehicle", "步战车", "Infantry Fighting Vehicle", 20],
  ["tracked_ifv", "ifv", "履带式步战车", "Tracked IFV", 10],
  ["wheeled_ifv", "ifv", "轮式步战车", "Wheeled IFV", 20],
  ["apc", "armored_vehicle", "装甲输送车", "Armored Personnel Carrier", 30],
  ["non_armored_vehicle", "military_vehicle", "非装甲车", "Non-armored Vehicle", 20],
  ["transport_truck", "non_armored_vehicle", "运输货车", "Transport Truck", 10],
  ["command_vehicle", "non_armored_vehicle", "指挥车", "Command Vehicle", 20],
  ["recon_vehicle", "non_armored_vehicle", "侦察车", "Reconnaissance Vehicle", 30],
  ["multi_purpose_vehicle", "non_armored_vehicle", "多功能车", "Multi-purpose Vehicle", 40],
  ["civilian_vehicle", "vehicle", "民用车辆", "Civilian Vehicle", 20],
  ["civilian_large", "civilian_vehicle", "民用大车", "Civilian Truck, Large", 10],
  ["cargo_truck", "civilian_large", "货运车", "Cargo Truck", 10],
  ["bus", "civilian_large", "公共汽车", "Bus", 20],
  ["special_civil_truck", "civilian_large", "特殊用途车", "Special-purpose Civil Truck", 30],
  ["civilian_small", "civilian_vehicle", "民用小车", "Civilian Vehicle, Small", 20],
  ["passenger_car", "civilian_small", "私家车", "Passenger Car", 10],
];

const DEFINITIONS = {
  tank: {
    purpose: "正面装甲战、突破防线并打击敌装甲车辆。",
    firepower: "通常配备 120-125 毫米口径滑膛炮。",
    appearance: "大型旋转炮塔、厚重装甲、低矮车身和履带式底盘；俯视时炮塔通常位于车体中部。",
    role: "正面突击并压制敌装甲目标。",
    dimensions: "长度通常 9-10 米，宽度 3-4 米，高度约 2-3 米。",
    examples: "M1A2 艾布拉姆斯、T-90。",
  },
  tracked_ifv: {
    purpose: "运送步兵并提供火力支援。",
    firepower: "通常配备 20-40 毫米自动炮。",
    appearance: "较高车身、步兵舱、履带式底盘；武器站相对车体较小，整体轮廓接近矩形盒体。",
    role: "运送步兵并打击轻型装甲目标。",
    dimensions: "长度通常 6-7 米，宽度 2.5-3 米，高度 2.5-3 米。",
    examples: "BMP-3、M2 布雷德利。",
  },
  wheeled_ifv: {
    purpose: "快速运送步兵并提供机动火力支援。",
    firepower: "通常配备 20-40 毫米自动炮。",
    appearance: "车身较高，具有 4 至 8 个轮胎，轮廓较履带式步战车更接近楔形。",
    role: "快速运送步兵并支援作战。",
    dimensions: "长度通常 7-8 米，宽度 2.5-3 米，高度 2.5-3 米。",
    examples: "皮兰哈 III 轮式步战车。",
  },
};

function createAnnotationStandardService({ query, audit }) {
  async function ensureSchema() {
    await query(`CREATE TABLE IF NOT EXISTS annotation_standard_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      version TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      principles_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
      published_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS annotation_standard_categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      version_id UUID NOT NULL REFERENCES annotation_standard_versions(id) ON DELETE CASCADE,
      parent_id UUID REFERENCES annotation_standard_categories(id) ON DELETE SET NULL,
      code TEXT NOT NULL,
      name_zh TEXT NOT NULL,
      name_en TEXT NOT NULL DEFAULT '',
      definition_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      rules_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      sort_order INT NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(version_id, code)
    )`);
    await query(`CREATE TABLE IF NOT EXISTS annotation_standard_examples (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      category_id UUID NOT NULL REFERENCES annotation_standard_categories(id) ON DELETE CASCADE,
      example_type TEXT NOT NULL DEFAULT 'correct',
      title TEXT NOT NULL DEFAULT '',
      explanation TEXT NOT NULL DEFAULT '',
      object_key TEXT NOT NULL DEFAULT '',
      preview_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await seedInitialStandard();
  }

  async function seedInitialStandard() {
    let version = (await query("SELECT * FROM annotation_standard_versions ORDER BY created_at LIMIT 1")).rows[0];
    if (!version) {
      version = (await query(
        `INSERT INTO annotation_standard_versions (version,name,status,principles_json)
         VALUES ('1.0-draft','典型目标标注规范','draft',$1::jsonb) RETURNING *`,
        [JSON.stringify(DEFAULT_PRINCIPLES)],
      )).rows[0];
    }
    const existing = Number((await query("SELECT count(*)::int AS count FROM annotation_standard_categories WHERE version_id=$1", [version.id])).rows[0]?.count || 0);
    if (existing) return;
    const ids = new Map();
    for (const [code, parentCode, nameZh, nameEn, sortOrder] of CATEGORY_SEED) {
      const row = (await query(
        `INSERT INTO annotation_standard_categories
         (version_id,parent_id,code,name_zh,name_en,definition_json,sort_order)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING id`,
        [version.id, parentCode ? ids.get(parentCode) : null, code, nameZh, nameEn, JSON.stringify(DEFINITIONS[code] || {}), sortOrder],
      )).rows[0];
      ids.set(code, row.id);
    }
  }

  async function getStandard() {
    const version = (await query(
      "SELECT * FROM annotation_standard_versions ORDER BY (status='published') DESC, updated_at DESC LIMIT 1",
    )).rows[0];
    if (!version) return { version: null, categories: [], examples: [] };
    const categories = (await query(
      "SELECT * FROM annotation_standard_categories WHERE version_id=$1 ORDER BY sort_order,name_zh",
      [version.id],
    )).rows;
    const examples = (await query(
      `SELECT e.* FROM annotation_standard_examples e
       JOIN annotation_standard_categories c ON c.id=e.category_id
       WHERE c.version_id=$1 ORDER BY e.sort_order,e.created_at`,
      [version.id],
    )).rows;
    return { version, categories, examples };
  }

  async function updatePrinciples(body, actor) {
    const id = body.versionId || body.version_id;
    const principles = Array.isArray(body.principles) ? body.principles : [];
    const row = (await query(
      `UPDATE annotation_standard_versions SET principles_json=$1::jsonb,updated_at=now()
       WHERE id=$2 RETURNING *`,
      [JSON.stringify(principles), id],
    )).rows[0];
    if (!row) throw Object.assign(new Error("annotation standard version not found"), { statusCode: 404 });
    await audit?.(actor, "principles.update", row.id, { count: principles.length });
    return row;
  }

  async function saveCategory(categoryId, body, actor) {
    const row = (await query(
      `UPDATE annotation_standard_categories SET
       name_zh=COALESCE($1,name_zh),name_en=COALESCE($2,name_en),
       definition_json=COALESCE($3::jsonb,definition_json),rules_json=COALESCE($4::jsonb,rules_json),
       active=COALESCE($5,active),updated_at=now()
       WHERE id=$6 RETURNING *`,
      [body.nameZh ?? body.name_zh ?? null, body.nameEn ?? body.name_en ?? null,
        body.definition ? JSON.stringify(body.definition) : null,
        body.rules ? JSON.stringify(body.rules) : null,
        body.active === undefined ? null : Boolean(body.active), categoryId],
    )).rows[0];
    if (!row) throw Object.assign(new Error("annotation category not found"), { statusCode: 404 });
    await audit?.(actor, "category.update", row.id, { code: row.code });
    return row;
  }

  return { ensureSchema, getStandard, updatePrinciples, saveCategory };
}

module.exports = { createAnnotationStandardService };
