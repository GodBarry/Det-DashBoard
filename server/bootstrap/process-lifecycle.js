"use strict";

function createProcessLifecycle({
  createServer,
  route,
  sendError,
  lifecycle,
  startTrainingWorker,
  startInferenceWorker,
  pool,
  port,
  host,
  dataRoot,
  dataRootDisplay,
  browseRoot,
  browseRootDisplay,
  hostPathMode,
  storageRoot,
  processRef = process,
  globalRef = globalThis,
  logger = console,
  scheduleTimeout = setTimeout,
  shutdownTimeoutMs = 25000,
}) {
  let httpServer;

  function startHttpServer() {
    const server = createServer((req, res) => {
      route(req, res).catch((error) => {
        const statusCode = error.statusCode || 500;
        if (statusCode >= 500) logger.error(error);
        if (!res.headersSent) sendError(res, statusCode, error.message);
        else res.end();
      });
    });
    globalRef.detDashboardServer = server;
    server.on("error", (error) => logger.error("HTTP server error:", error));
    server.on("close", () => logger.error("HTTP server closed"));
    server.listen(port, host, () => {
      logger.log(`PostgreSQL + MinIO API: http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
      logger.log(`DATA_ROOT=${dataRoot}`);
      logger.log(`DATA_ROOT_DISPLAY=${dataRootDisplay}`);
      logger.log(`BROWSE_ROOT=${browseRoot}`);
      logger.log(`BROWSE_ROOT_DISPLAY=${browseRootDisplay}`);
      logger.log(`HOST_PATH_MODE=${hostPathMode}`);
      logger.log(`STORAGE_ROOT=${storageRoot}`);
    });
    const trainingWorker = startTrainingWorker();
    const inferenceWorker = startInferenceWorker();
    if (trainingWorker) lifecycle.registerWorker(trainingWorker);
    if (inferenceWorker) lifecycle.registerWorker(inferenceWorker);
    return server;
  }

  async function shutdown(signal) {
    if (!lifecycle.beginShutdown()) return;
    logger.log(`Received ${signal}; stopping gracefully`);
    const serverClosed = new Promise((resolve) => {
      if (!httpServer) return resolve();
      httpServer.close(resolve);
    });
    const workersStopped = lifecycle.stopWorkers();
    const backgroundTasksStopped = lifecycle.waitForBackgroundTasks();
    const timeout = new Promise((resolve) => scheduleTimeout(resolve, shutdownTimeoutMs));
    await Promise.race([Promise.all([serverClosed, workersStopped, backgroundTasksStopped]), timeout]);
    await pool.end().catch((error) => logger.error("PostgreSQL shutdown error:", error.message));
  }

  function installSignalHandlers() {
    processRef.on("SIGINT", () => shutdown("SIGINT").finally(() => processRef.exit(0)));
    processRef.on("SIGTERM", () => shutdown("SIGTERM").finally(() => processRef.exit(0)));
  }

  function run(main) {
    installSignalHandlers();
    return main()
      .then((server) => { httpServer = server; })
      .catch((error) => {
        logger.error(error);
        processRef.exit(1);
      });
  }

  return {
    startHttpServer,
    shutdown,
    installSignalHandlers,
    run,
  };
}

module.exports = { createProcessLifecycle };
