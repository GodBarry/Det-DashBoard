"use strict";

function createAnnotationRoutes({ readBody, sendJson, annotationService, computeTaskService }) {
  async function handle(req, res, parsed, actor) {
    const method = req.method;
    const pathname = parsed.pathname;

    if (method === "POST" && pathname === "/api/annotation/sessions") {
      sendJson(res, { session: await annotationService.createSession(await readBody(req), actor) });
      return true;
    }
    const operationMatch = pathname.match(/^\/api\/annotation\/sessions\/([^/]+)\/operations$/);
    if (method === "POST" && operationMatch) {
      sendJson(res, { task: await annotationService.runOperation(operationMatch[1], await readBody(req), actor) });
      return true;
    }
    const correctionMatch = pathname.match(/^\/api\/annotation\/sessions\/([^/]+)\/corrections$/);
    if (method === "POST" && correctionMatch) {
      sendJson(res, { revision: await annotationService.correctTrack(correctionMatch[1], await readBody(req), actor) });
      return true;
    }
    const suggestionsMatch = pathname.match(/^\/api\/annotation\/sessions\/([^/]+)\/suggestions$/);
    if (method === "GET" && suggestionsMatch) {
      sendJson(res, { suggestions: await annotationService.suggestions(suggestionsMatch[1], actor) });
      return true;
    }
    const commitMatch = pathname.match(/^\/api\/annotation\/sessions\/([^/]+)\/commit$/);
    if (method === "POST" && commitMatch) {
      sendJson(res, await annotationService.commitSuggestions(commitMatch[1], await readBody(req), actor));
      return true;
    }
    if (method === "GET" && pathname === "/api/compute/tasks") {
      sendJson(res, { tasks: await computeTaskService.listTasks(actor, parsed.query) });
      return true;
    }
    const taskLogsMatch = pathname.match(/^\/api\/compute\/tasks\/([^/]+)\/logs$/);
    if (method === "GET" && taskLogsMatch) {
      sendJson(res, { logs: await computeTaskService.taskLogs(taskLogsMatch[1], actor) });
      return true;
    }
    const taskControlMatch = pathname.match(/^\/api\/compute\/tasks\/([^/]+)\/(pause|resume|cancel|restart)$/);
    if (method === "POST" && taskControlMatch) {
      sendJson(res, { task: await computeTaskService.controlTask(taskControlMatch[1], taskControlMatch[2], actor) });
      return true;
    }
    return false;
  }

  return { handle };
}

module.exports = { createAnnotationRoutes };
