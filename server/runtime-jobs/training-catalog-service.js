function createTrainingCatalogService({
  query,
  scopedSql,
  algorithmAssetService,
  resourceAccess,
}) {
  async function listDatasetSnapshots(actor, scope = "mine") {
    const scoped = scopedSql("dataset_snapshots", "ds", actor, scope);
    const rows = await query(
      `SELECT ds.*, p.name AS source_project_name
       FROM dataset_snapshots ds
       LEFT JOIN projects p ON p.id=ds.source_project_id
       WHERE ${scoped.sql}
       ORDER BY ds.created_at DESC
       LIMIT 200`,
      scoped.params,
    );
    return rows.rows;
  }

  async function listTrainingTemplates(actor, scope = "mine") {
    try {
      const scoped = scopedSql("training_templates", "t", actor, scope);
      return (await query(`SELECT t.* FROM training_templates t WHERE ${scoped.sql} ORDER BY created_at DESC`, scoped.params)).rows;
    } catch (error) {
      if (error.code !== "42P01") throw error;
      return algorithmAssetService.getBuiltinTrainingTemplateFallbacks();
    }
  }

  function templateCapabilities(body = {}) {
    const raw = body.capabilities || body.capabilities_json || {};
    if (Array.isArray(raw.tasks) && raw.tasks.length) {
      return { ...raw, tasks: raw.tasks.filter((task) => ["detect", "segment", "classify"].includes(task)) };
    }
    const key = String(body.templateKey || body.template_key || "").toLowerCase();
    const framework = String(body.framework || "").toLowerCase();
    if (framework === "ultralytics" || key.includes("ultralytics") || key.includes("yolo")) {
      return { tasks: ["detect", "segment", "classify"], autoDetected: true };
    }
    return { tasks: [body.taskType || body.task_type || "detect"], autoDetected: false };
  }

  async function createTrainingTemplate(body = {}, actor) {
    const name = String(body.name || "").trim();
    if (!name) throw new Error("模板名称不能为空");
    const capabilities = templateCapabilities(body);
    const taskType = capabilities.tasks?.[0] || body.taskType || body.task_type || "detect";
    const rows = await query(
      `INSERT INTO training_templates (name, template_key, framework, task_type, command_json, default_params_json, capabilities_json, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        name,
        body.templateKey || body.template_key || "ultralytics_yolo",
        body.framework || "ultralytics",
        taskType,
        JSON.stringify(body.command || body.command_json || {}),
        JSON.stringify(body.defaultParams || body.default_params_json || {}),
        JSON.stringify(capabilities),
        body.description || "",
      ],
    );
    return resourceAccess.assignOwner("training_templates", rows.rows[0].id, actor, { visibility: body.visibility || "private" });
  }

  return {
    listDatasetSnapshots,
    listTrainingTemplates,
    templateCapabilities,
    createTrainingTemplate,
  };
}

module.exports = { createTrainingCatalogService };
