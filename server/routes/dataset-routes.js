"use strict";

function createDatasetRoutes(deps) {
  const {
    query,
    readBody,
    sendJson,
    httpError,
    requestedScope,
    accessControl,
    resourceAccess,
    projectService,
    trashService,
    importService,
    datasetContentService,
    baselineService,
  } = deps;

  async function projectForImage(imageId) {
    const result = await query(
      "SELECT project_id FROM project_images WHERE id=$1 AND deleted_at IS NULL",
      [imageId],
    );
    return result.rows[0]?.project_id || null;
  }

  async function projectForImport(importId) {
    const result = await query("SELECT project_id FROM import_batches WHERE id=$1", [importId]);
    return result.rows[0]?.project_id || null;
  }

  async function handle(req, res, parsed, actor) {
    const method = req.method;
    const pathname = parsed.pathname;

    if (method === "GET" && pathname === "/api/projects") {
      sendJson(res, { projects: await projectService.listProjects(false, actor, requestedScope(parsed, actor)) });
      return true;
    }
    if (method === "GET" && pathname === "/api/projects/trash") {
      sendJson(res, { projects: await projectService.listProjects(true, actor, requestedScope(parsed, actor)) });
      return true;
    }
    if (method === "DELETE" && pathname === "/api/projects/trash/empty") {
      accessControl.requireAdmin(actor);
      sendJson(res, await trashService.emptyProjectTrash());
      return true;
    }
    if (method === "POST" && pathname === "/api/projects") {
      sendJson(res, { project: await projectService.createProject(await readBody(req), actor) });
      return true;
    }

    const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (method === "PATCH" && projectMatch) {
      await resourceAccess.assertProjectWrite(actor, projectMatch[1]);
      sendJson(res, { project: await projectService.renameProject(projectMatch[1], await readBody(req)) });
      return true;
    }
    if (method === "DELETE" && projectMatch) {
      await resourceAccess.assertProjectDelete(actor, projectMatch[1]);
      await trashService.softDeleteProjectTree(projectMatch[1]);
      sendJson(res, { ok: true });
      return true;
    }

    const permanentProjectMatch = pathname.match(/^\/api\/projects\/([^/]+)\/permanent$/);
    if (method === "DELETE" && permanentProjectMatch) {
      await resourceAccess.assertProjectDelete(actor, permanentProjectMatch[1]);
      sendJson(res, await trashService.deleteProjectPermanently(permanentProjectMatch[1]));
      return true;
    }
    const restoreProjectMatch = pathname.match(/^\/api\/projects\/([^/]+)\/restore$/);
    if (method === "POST" && restoreProjectMatch) {
      await resourceAccess.assertProjectWrite(actor, restoreProjectMatch[1]);
      await trashService.restoreProjectTree(restoreProjectMatch[1]);
      sendJson(res, { ok: true });
      return true;
    }

    if (method === "POST" && pathname === "/api/imports") {
      sendJson(res, await importService.importPath(await readBody(req), actor));
      return true;
    }

    if (method === "POST" && pathname === "/api/baselines/preview") {
      accessControl.requireAdmin(actor);
      sendJson(res, await baselineService.createBaselinePreview(await readBody(req)));
      return true;
    }
    const baselineConflictsMatch = pathname.match(/^\/api\/baselines\/([^/]+)\/conflicts$/);
    if (method === "GET" && baselineConflictsMatch) {
      accessControl.requireAdmin(actor);
      sendJson(res, { conflicts: await baselineService.listBaselineConflicts(baselineConflictsMatch[1]) });
      return true;
    }
    if (method === "POST" && baselineConflictsMatch) {
      accessControl.requireAdmin(actor);
      sendJson(res, await baselineService.resolveBaselineConflicts(baselineConflictsMatch[1], await readBody(req)));
      return true;
    }
    const applyBaselineMatch = pathname.match(/^\/api\/baselines\/([^/]+)\/apply$/);
    if (method === "POST" && applyBaselineMatch) {
      accessControl.requireAdmin(actor);
      sendJson(res, await baselineService.applyBaselineRun(applyBaselineMatch[1], await readBody(req), actor));
      return true;
    }

    const projectImportsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/imports$/);
    if (method === "GET" && projectImportsMatch) {
      await resourceAccess.assertProjectRead(actor, projectImportsMatch[1]);
      sendJson(res, { imports: await importService.listImports(projectImportsMatch[1], parsed.query.trash === "1") });
      return true;
    }
    const emptyImportsTrashMatch = pathname.match(/^\/api\/projects\/([^/]+)\/imports\/trash\/empty$/);
    if (method === "DELETE" && emptyImportsTrashMatch) {
      await resourceAccess.assertProjectWrite(actor, emptyImportsTrashMatch[1]);
      sendJson(res, await trashService.emptyImportTrash(emptyImportsTrashMatch[1]));
      return true;
    }
    const importMatch = pathname.match(/^\/api\/imports\/([^/]+)$/);
    if (method === "DELETE" && importMatch) {
      await resourceAccess.assertProjectWrite(actor, await projectForImport(importMatch[1]));
      await trashService.softDeleteImport(importMatch[1]);
      sendJson(res, { ok: true });
      return true;
    }
    const cancelImportMatch = pathname.match(/^\/api\/imports\/([^/]+)\/cancel$/);
    if (method === "POST" && cancelImportMatch) {
      await resourceAccess.assertProjectWrite(actor, await projectForImport(cancelImportMatch[1]));
      await importService.cancelImport(cancelImportMatch[1]);
      sendJson(res, { ok: true });
      return true;
    }
    const restoreImportMatch = pathname.match(/^\/api\/imports\/([^/]+)\/restore$/);
    if (method === "POST" && restoreImportMatch) {
      await resourceAccess.assertProjectWrite(actor, await projectForImport(restoreImportMatch[1]));
      await trashService.restoreImport(restoreImportMatch[1]);
      sendJson(res, { ok: true });
      return true;
    }

    const summaryMatch = pathname.match(/^\/api\/projects\/([^/]+)\/summary$/);
    if (method === "GET" && summaryMatch) {
      await resourceAccess.assertProjectRead(actor, summaryMatch[1]);
      sendJson(res, { summary: await projectService.projectSummary(summaryMatch[1]) });
      return true;
    }
    const imageListMatch = pathname.match(/^\/api\/projects\/([^/]+)\/images$/);
    if (method === "GET" && imageListMatch) {
      await resourceAccess.assertProjectRead(actor, imageListMatch[1]);
      sendJson(res, await datasetContentService.listProjectImages(imageListMatch[1], parsed.query));
      return true;
    }
    const deleteImagesMatch = pathname.match(/^\/api\/projects\/([^/]+)\/images\/delete$/);
    if (method === "POST" && deleteImagesMatch) {
      await resourceAccess.assertProjectWrite(actor, deleteImagesMatch[1]);
      sendJson(res, await importService.softDeleteProjectImages(deleteImagesMatch[1], (await readBody(req)).ids));
      return true;
    }
    const exportMatch = pathname.match(/^\/api\/projects\/([^/]+)\/export$/);
    if (method === "POST" && exportMatch) {
      await resourceAccess.assertProjectRead(actor, exportMatch[1]);
      sendJson(res, await datasetContentService.exportProject(exportMatch[1], await readBody(req), actor));
      return true;
    }

    const thumbnailMatch = pathname.match(/^\/api\/project-images\/([^/]+)\/thumb$/);
    if (method === "GET" && thumbnailMatch) {
      await resourceAccess.assertProjectRead(actor, await projectForImage(thumbnailMatch[1]));
      await datasetContentService.streamProjectImage(res, thumbnailMatch[1], true);
      return true;
    }
    const fullImageMatch = pathname.match(/^\/api\/project-images\/([^/]+)\/full$/);
    if (method === "GET" && fullImageMatch) {
      await resourceAccess.assertProjectRead(actor, await projectForImage(fullImageMatch[1]));
      await datasetContentService.streamProjectImage(res, fullImageMatch[1], false);
      return true;
    }
    const saveAnnotationsMatch = pathname.match(/^\/api\/project-images\/([^/]+)\/annotations\/save$/);
    if (method === "POST" && saveAnnotationsMatch) {
      await resourceAccess.assertProjectWrite(actor, await projectForImage(saveAnnotationsMatch[1]));
      sendJson(res, await datasetContentService.saveImageAnnotations(saveAnnotationsMatch[1], await readBody(req), actor));
      return true;
    }

    if (method === "GET" && pathname === "/api/imports/latest") {
      const projectId = parsed.query.projectId || parsed.query.project_id;
      if (!projectId) throw httpError(400, "projectId is required");
      await resourceAccess.assertProjectRead(actor, projectId);
      const rows = await query(
        `SELECT *, CASE WHEN total_files > 0 THEN round((processed_files::numeric / total_files::numeric) * 100)::int ELSE 0 END AS progress
         FROM import_batches WHERE deleted_at IS NULL AND project_id=$1 ORDER BY created_at DESC LIMIT 1`,
        [projectId],
      );
      sendJson(res, { importBatch: rows.rows[0] || null });
      return true;
    }

    return false;
  }

  return { handle };
}

module.exports = { createDatasetRoutes };
