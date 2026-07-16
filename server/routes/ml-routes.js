"use strict";

function createMlRoutes(deps) {
  const {
    query,
    readBody,
    sendJson,
    requestedScope,
    accessControl,
    resourceAccess,
    modelService,
    modelMaintenanceService,
    algorithmAssetService,
    runtimeAssetLinkService,
    trainingCatalogService,
    pythonEnvService,
    runtimeQueueService,
    runtimeJobService,
    createInferenceJob,
  } = deps;

  async function handle(req, res, parsed, actor) {
    const method = req.method;
    const pathname = parsed.pathname;

    if (method === "GET" && pathname === "/api/ml/models") {
      sendJson(res, { models: await modelService.listMlModels(actor, requestedScope(parsed, actor)) });
      return true;
    }
    if (method === "POST" && pathname === "/api/ml/models") {
      sendJson(res, { model: await modelService.createMlModel(await readBody(req), actor) });
      return true;
    }
    if (method === "GET" && pathname === "/api/ml/model-versions") {
      sendJson(res, {
        versions: await modelService.listModelVersions(
          parsed.query.modelId || parsed.query.model_id,
          actor,
          requestedScope(parsed, actor),
        ),
      });
      return true;
    }
    if (method === "POST" && pathname === "/api/ml/model-versions") {
      sendJson(res, { version: await modelService.createModelVersion(await readBody(req), actor) });
      return true;
    }
    if (method === "POST" && pathname === "/api/ml/model-assets/clear") {
      accessControl.requireAdmin(actor);
      sendJson(res, await modelMaintenanceService.clearModelAssets(await readBody(req)));
      return true;
    }
    if (method === "GET" && pathname === "/api/ml/algorithm-assets") {
      sendJson(res, { algorithms: await algorithmAssetService.listAlgorithmAssets(actor, requestedScope(parsed, actor)) });
      return true;
    }
    if (method === "GET" && pathname === "/api/ml/asset-links") {
      sendJson(res, { links: await runtimeAssetLinkService.listLinks(actor, requestedScope(parsed, actor)) });
      return true;
    }
    if (method === "GET" && pathname === "/api/ml/training-templates") {
      sendJson(res, { templates: await trainingCatalogService.listTrainingTemplates(actor, requestedScope(parsed, actor)) });
      return true;
    }
    if (method === "POST" && pathname === "/api/ml/training-templates") {
      sendJson(res, { template: await trainingCatalogService.createTrainingTemplate(await readBody(req), actor) });
      return true;
    }
    if (method === "GET" && pathname === "/api/ml/python-envs") {
      sendJson(res, { envs: await pythonEnvService.listPythonEnvs(actor, requestedScope(parsed, actor)) });
      return true;
    }
    if (method === "POST" && pathname === "/api/ml/python-envs") {
      sendJson(res, { env: await pythonEnvService.createPythonEnv(await readBody(req), actor) });
      return true;
    }

    const pythonEnvDownloadMatch = pathname.match(/^\/api\/ml\/python-envs\/([^/]+)\/download$/);
    if (method === "GET" && pythonEnvDownloadMatch) {
      await resourceAccess.assertIndependentAccess("runtime_envs", pythonEnvDownloadMatch[1], actor, "read");
      await pythonEnvService.streamPythonEnvArtifact(res, pythonEnvDownloadMatch[1]);
      return true;
    }
    const modelVersionMatch = pathname.match(/^\/api\/ml\/model-versions\/([^/]+)$/);
    if (method === "PATCH" && modelVersionMatch) {
      await resourceAccess.assertIndependentAccess("model_revisions", modelVersionMatch[1], actor, "write");
      sendJson(res, { version: await modelService.renameModelVersion(modelVersionMatch[1], await readBody(req)) });
      return true;
    }
    const modelVersionDownloadMatch = pathname.match(/^\/api\/ml\/model-versions\/([^/]+)\/download$/);
    if (method === "GET" && modelVersionDownloadMatch) {
      await resourceAccess.assertIndependentAccess("model_revisions", modelVersionDownloadMatch[1], actor, "read");
      await modelService.streamModelArtifact(
        res,
        modelVersionDownloadMatch[1],
        parsed.query.artifactId || parsed.query.artifact_id,
      );
      return true;
    }
    if (method === "GET" && pathname === "/api/ml/dataset-snapshots") {
      sendJson(res, { snapshots: await trainingCatalogService.listDatasetSnapshots(actor, requestedScope(parsed, actor)) });
      return true;
    }

    if (method === "GET" && pathname === "/api/ml/training-jobs") {
      sendJson(res, { jobs: await runtimeJobService.listTrainingJobs(actor, requestedScope(parsed, actor)) });
      return true;
    }
    if (method === "POST" && pathname === "/api/ml/training-jobs") {
      sendJson(res, { job: await runtimeJobService.createTrainingJob(await readBody(req), actor) });
      return true;
    }
    const trainingPriorityMatch = pathname.match(/^\/api\/ml\/training-jobs\/([^/]+)\/priority$/);
    if (method === "PATCH" && trainingPriorityMatch) {
      await resourceAccess.assertTrainingJobWrite(actor, trainingPriorityMatch[1]);
      const body = await readBody(req);
      sendJson(res, {
        job: await runtimeQueueService.moveRuntimeJobPriority(
          "runtime_training_jobs",
          trainingPriorityMatch[1],
          body.direction,
          actor,
        ),
      });
      return true;
    }
    const requeueTrainingMatch = pathname.match(/^\/api\/ml\/training-jobs\/([^/]+)\/requeue$/);
    if (method === "POST" && requeueTrainingMatch) {
      await resourceAccess.assertTrainingJobWrite(actor, requeueTrainingMatch[1]);
      sendJson(res, { job: await runtimeJobService.requeueTrainingJob(requeueTrainingMatch[1], await readBody(req)) });
      return true;
    }
    const pauseTrainingMatch = pathname.match(/^\/api\/ml\/training-jobs\/([^/]+)\/pause$/);
    if (method === "POST" && pauseTrainingMatch) {
      await resourceAccess.assertTrainingJobWrite(actor, pauseTrainingMatch[1]);
      sendJson(res, { job: await runtimeJobService.pauseTrainingJob(pauseTrainingMatch[1]) });
      return true;
    }
    const resumeTrainingMatch = pathname.match(/^\/api\/ml\/training-jobs\/([^/]+)\/resume$/);
    if (method === "POST" && resumeTrainingMatch) {
      await resourceAccess.assertTrainingJobWrite(actor, resumeTrainingMatch[1]);
      sendJson(res, { job: await runtimeJobService.resumeTrainingJob(resumeTrainingMatch[1]) });
      return true;
    }
    const trainingJobMatch = pathname.match(/^\/api\/ml\/training-jobs\/([^/]+)$/);
    if (method === "DELETE" && trainingJobMatch) {
      await resourceAccess.assertTrainingJobWrite(actor, trainingJobMatch[1]);
      sendJson(res, await runtimeJobService.deleteTrainingJob(trainingJobMatch[1]));
      return true;
    }
    const trainingLogsMatch = pathname.match(/^\/api\/ml\/training-jobs\/([^/]+)\/logs$/);
    if (method === "GET" && trainingLogsMatch) {
      await resourceAccess.assertTrainingJobRead(actor, trainingLogsMatch[1]);
      const rows = await query(
        "SELECT * FROM runtime_training_logs WHERE job_id=$1 ORDER BY id DESC LIMIT 300",
        [trainingLogsMatch[1]],
      );
      sendJson(res, { logs: rows.rows.reverse() });
      return true;
    }
    const trainingMetricsMatch = pathname.match(/^\/api\/ml\/training-jobs\/([^/]+)\/metrics$/);
    if (method === "GET" && trainingMetricsMatch) {
      await resourceAccess.assertTrainingJobRead(actor, trainingMetricsMatch[1]);
      const rows = await query(
        "SELECT * FROM runtime_training_metrics WHERE job_id=$1 ORDER BY id DESC LIMIT 500",
        [trainingMetricsMatch[1]],
      );
      sendJson(res, { metrics: rows.rows.reverse() });
      return true;
    }

    if (method === "GET" && pathname === "/api/ml/inference-jobs") {
      sendJson(res, { jobs: await runtimeJobService.listInferenceJobs(actor, requestedScope(parsed, actor)) });
      return true;
    }
    if (method === "POST" && pathname === "/api/ml/inference-jobs") {
      sendJson(res, { job: await createInferenceJob(await readBody(req), actor) });
      return true;
    }
    const inferencePriorityMatch = pathname.match(/^\/api\/ml\/inference-jobs\/([^/]+)\/priority$/);
    if (method === "PATCH" && inferencePriorityMatch) {
      await resourceAccess.assertInferenceJobWrite(actor, inferencePriorityMatch[1]);
      const body = await readBody(req);
      sendJson(res, {
        job: await runtimeQueueService.moveRuntimeJobPriority(
          "runtime_inference_jobs",
          inferencePriorityMatch[1],
          body.direction,
          actor,
        ),
      });
      return true;
    }
    const requeueInferenceMatch = pathname.match(/^\/api\/ml\/inference-jobs\/([^/]+)\/requeue$/);
    if (method === "POST" && requeueInferenceMatch) {
      await resourceAccess.assertInferenceJobWrite(actor, requeueInferenceMatch[1]);
      sendJson(res, { job: await runtimeJobService.requeueInferenceJob(requeueInferenceMatch[1]) });
      return true;
    }
    const inferenceJobMatch = pathname.match(/^\/api\/ml\/inference-jobs\/([^/]+)$/);
    if (method === "DELETE" && inferenceJobMatch) {
      await resourceAccess.assertInferenceJobWrite(actor, inferenceJobMatch[1]);
      sendJson(res, await runtimeJobService.deleteInferenceJob(inferenceJobMatch[1]));
      return true;
    }
    const inferenceEvaluationMatch = pathname.match(/^\/api\/ml\/inference-jobs\/([^/]+)\/evaluation$/);
    if (method === "GET" && inferenceEvaluationMatch) {
      await resourceAccess.assertInferenceJobRead(actor, inferenceEvaluationMatch[1]);
      sendJson(res, { evaluation: await runtimeJobService.getInferenceEvaluation(inferenceEvaluationMatch[1]) });
      return true;
    }
    const inferenceResultsMatch = pathname.match(/^\/api\/ml\/inference-jobs\/([^/]+)\/results$/);
    if (method === "GET" && inferenceResultsMatch) {
      await resourceAccess.assertInferenceJobRead(actor, inferenceResultsMatch[1]);
      sendJson(res, { results: await runtimeJobService.listInferenceResults(inferenceResultsMatch[1]) });
      return true;
    }

    return false;
  }

  return { handle };
}

module.exports = { createMlRoutes };
