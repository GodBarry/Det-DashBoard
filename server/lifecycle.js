"use strict";

function createLifecycle() {
  let shuttingDown = false;
  let workersStopped = false;
  let stoppingWorkers;

  const backgroundTasks = new Set();
  const importTasks = new Set();
  const exportTasks = new Set();
  const workers = new Set();

  function isShuttingDown() {
    return shuttingDown;
  }

  function beginShutdown() {
    if (shuttingDown) return false;
    shuttingDown = true;
    return true;
  }

  function trackIn(task, taskSet) {
    const tracked = Promise.resolve(task);
    backgroundTasks.add(tracked);
    if (taskSet) taskSet.add(tracked);

    const remove = () => {
      backgroundTasks.delete(tracked);
      if (taskSet) taskSet.delete(tracked);
    };
    tracked.then(remove, remove);
    return tracked;
  }

  function trackPromise(task) {
    return trackIn(task);
  }

  function trackImport(task) {
    return trackIn(task, importTasks);
  }

  function trackExport(task) {
    return trackIn(task, exportTasks);
  }

  async function waitForBackgroundTasks() {
    while (backgroundTasks.size > 0) {
      await Promise.allSettled([...backgroundTasks]);
    }
  }

  function workerStopper(worker) {
    if (typeof worker === "function") return worker;
    if (worker == null) throw new TypeError("worker must provide a way to stop it");

    const methods = ["stop", "close", "terminate", "abort", "dispose"];
    for (const method of methods) {
      if (typeof worker[method] === "function") return () => worker[method]();
    }
    if (typeof Symbol.dispose === "symbol" && typeof worker[Symbol.dispose] === "function") {
      return () => worker[Symbol.dispose]();
    }
    if (typeof worker === "object" || typeof worker === "number") {
      return () => clearTimeout(worker);
    }
    throw new TypeError("worker must provide a way to stop it");
  }

  function registerWorker(worker) {
    const entry = { worker, stop: workerStopper(worker) };
    if (workersStopped) {
      Promise.resolve().then(entry.stop).catch(() => {});
      return worker;
    }
    workers.add(entry);
    return worker;
  }

  function stopWorkers() {
    if (stoppingWorkers) return stoppingWorkers;
    workersStopped = true;
    const registered = [...workers];
    workers.clear();
    stoppingWorkers = Promise.allSettled(registered.map(({ stop }) => Promise.resolve().then(stop)));
    return stoppingWorkers;
  }

  return {
    isShuttingDown,
    beginShutdown,
    trackImport,
    trackExport,
    trackPromise,
    waitForBackgroundTasks,
    registerWorker,
    stopWorkers,
  };
}

module.exports = { createLifecycle };
