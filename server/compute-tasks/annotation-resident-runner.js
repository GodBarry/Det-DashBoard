"use strict";

const { spawn } = require("child_process");

const residents = new Map();

function createResident({ key, pythonPath, adapterPath, cwd, env, onStdout, onStderr, onSpawn }) {
  const child = spawn(pythonPath, [adapterPath, "--serve"], {
    cwd,
    env,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const resident = { child, pending: new Map(), stdoutBuffer: "" };
  onSpawn?.(child);
  onStdout?.(`常驻分割进程已启动，PID ${child.pid}\n`);
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    resident.current?.onStdout?.(text);
    resident.stdoutBuffer += text;
    const lines = resident.stdoutBuffer.split(/\r?\n/);
    resident.stdoutBuffer = lines.pop() || "";
    for (const line of lines) {
      const match = line.match(/^DET_DASHBOARD_RESULT:([^:]+):(ok|error)(?::(.*))?$/);
      if (!match) continue;
      const waiter = resident.pending.get(match[1]);
      if (!waiter) continue;
      resident.pending.delete(match[1]);
      if (match[2] === "ok") waiter.resolve();
      else waiter.reject(new Error(match[3] || "常驻分割进程执行失败"));
    }
  });
  child.stderr.on("data", (chunk) => resident.current?.onStderr?.(chunk.toString()));
  child.on("exit", (code, signal) => {
    residents.delete(key);
    const error = new Error(`常驻分割进程退出: code=${code ?? ""} signal=${signal || ""}`);
    for (const waiter of resident.pending.values()) waiter.reject(error);
    resident.pending.clear();
  });
  child.on("error", (error) => {
    residents.delete(key);
    for (const waiter of resident.pending.values()) waiter.reject(error);
    resident.pending.clear();
  });
  residents.set(key, resident);
  return resident;
}

function runResidentAnnotation(options) {
  let resident = residents.get(options.key);
  if (!resident || resident.child.exitCode != null || resident.child.killed) {
    resident = createResident(options);
  }
  resident.current = { onStdout: options.onStdout, onStderr: options.onStderr };
  const requestId = String(options.requestId);
  return new Promise((resolve, reject) => {
    resident.pending.set(requestId, { resolve, reject });
    resident.child.stdin.write(`${JSON.stringify({ requestId, requestPath: options.requestPath, outputPath: options.outputPath })}\n`, (error) => {
      if (!error) return;
      resident.pending.delete(requestId);
      reject(error);
    });
  });
}

module.exports = { runResidentAnnotation };
