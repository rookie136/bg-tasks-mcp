#!/usr/bin/env node
/**
 * bg-tasks MCP Server — Background Task Manager v0.7.0
 *
 * type: "local" (stdio MCP), starts/stops with opencode.
 * First window becomes owner (HTTP dashboard :9876).
 * Subsequent windows push task state to owner via POST /api/report.
 * Owner death → another window takes over automatically.
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { execSync } from "node:child_process";
import { clearAll } from "./lib/store.js";
import { initSession } from "./lib/session.js";
import * as registry from "./lib/registry.js";
import * as platform from "./lib/platform.js";
import { createServer } from "./lib/status-http.js";
import { start as startReporter, stop as stopReporter } from "./lib/reporter.js";
import { log } from "./lib/logger.js";

import * as bgStart from "./tools/bg-start.js";
import * as bgStatus from "./tools/bg-status.js";
import * as bgLogs from "./tools/bg-logs.js";
import * as bgKill from "./tools/bg-kill.js";
import * as bgWait from "./tools/bg-wait.js";
import * as bgSend from "./tools/bg-send.js";

import { getStatusJson } from "./resources/status.js";
import { getTaskStatus, getTaskLogs, getTaskStream } from "./resources/task-resources.js";

// ── 会话初始化 ─────────────────────────────────────────────────────────

initSession();

// ── grace shutdown ────────────────────────────────────────────────────

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  stopReporter();
  if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
  if (orphanTimer) { clearInterval(orphanTimer); orphanTimer = null; }
  if (miniHttpSrv) { miniHttpSrv.close(); miniHttpSrv = null; }
  for (const task of registry.running()) {
    try { if (task.process && task.pid > 0) platform.killProcess(task.pid, "SIGTERM"); } catch {}
  }
  registry.dispose();
  clearAll();
  process.exit(0);
}
process.on("SIGINT", () => { log("shutdown", { reason: "SIGINT" }); shutdown(); });
process.on("SIGTERM", () => { log("shutdown", { reason: "SIGTERM" }); shutdown(); });
process.on("SIGBREAK", () => { log("shutdown", { reason: "SIGBREAK" }); shutdown(); });
process.stdin.on("end", () => { log("shutdown", { reason: "stdin_end" }); shutdown(); });

// ── 孤儿进程检测 ─────────────────────────────────────────────────────

const parentPid = process.ppid;
const SKIP_ORPHAN = process.env.BG_TASKS_NO_ORPHAN_CHECK === "1";
let orphanTimer = null;
let orphanFails = 0;

function isProcessAlive(pid) {
  if (process.platform !== "win32") {
    try { process.kill(pid, 0); return true; } catch { return false; }
  }
  try {
    const out = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { timeout: 2000, windowsHide: true });
    return out.toString().includes(`"${pid}"`);
  } catch { return false; }
}

function startOrphanCheck() {
  if (orphanTimer || SKIP_ORPHAN) return;
  orphanTimer = setInterval(() => {
    const alive = isProcessAlive(parentPid);
    if (alive) {
      orphanFails = 0;
      return;
    }
    orphanFails++;
    log("orphan_check", { attempt: orphanFails, alive: false, ppid: parentPid });
    if (orphanFails >= 3) {
      log("shutdown", { reason: "orphan", attempts: orphanFails, ppid: parentPid });
      shutdown();
    }
  }, 30000);
}

// ── Owner 检测 ──────────────────────────────────────────────────────

const OWNER_PORT = 9876;
let isOwner = false;
let httpSrv = null;
let miniHttpSrv = null;
let miniPort = 0;
let healthTimer = null;

async function tryBecomeOwner() {
  httpSrv = createServer();
  const result = await httpSrv.listen(OWNER_PORT);
  if (result.port > 0) {
    isOwner = true;
    log("owner_ok", { port: OWNER_PORT, ppid: parentPid });
    process.stderr.write(`[bg-tasks] OWNER http://127.0.0.1:${OWNER_PORT}\n`);
    return true;
  }
  // EADDRINUSE — another owner exists
  isOwner = false;
  httpSrv.close();
  httpSrv = null;
  return false;
}

async function startMiniHttp() {
  miniHttpSrv = createServer();
  for (let p = OWNER_PORT + 1; p < OWNER_PORT + 11; p++) {
    const result = await miniHttpSrv.listen(p);
    if (result.port > 0) {
      miniPort = p;
      log("mini_http", { port: p });
      process.stderr.write(`[bg-tasks] mini HTTP: http://127.0.0.1:${p}\n`);
      return;
    }
  }
  miniHttpSrv.close();
  miniHttpSrv = null;
}

async function startHealthCheck() {
  const ownerUrl = `http://127.0.0.1:${OWNER_PORT}`;
  startReporter(ownerUrl, miniPort);

  healthTimer = setInterval(async () => {
    try {
      const res = await fetch(`${ownerUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return; // owner 还活着
    } catch {}
    // owner is dead → attempt takeover
    stopReporter();
    log("takeover_start", {});
    if (miniHttpSrv) { miniHttpSrv.close(); miniHttpSrv = null; miniPort = 0; }
    if (healthTimer) clearInterval(healthTimer);
    // jitter to prevent thundering herd
    await new Promise((r) => setTimeout(r, 500 + Math.random() * 1000));
    const became = await tryBecomeOwner();
    if (!became) {
      log("takeover_miss", {});
      // someone else beat us, restart mini HTTP and reporting
      await startMiniHttp();
      await startHealthCheck();
    } else {
      log("takeover_ok", { port: OWNER_PORT });
    }
  }, 5000);
}

// ── MCP Server ─────────────────────────────────────────────────────────

serveStdio(() => {
  const server = new McpServer(
    { name: "bg-tasks", version: "0.6.0" },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.registerTool("bg_start", { description: bgStart.description, inputSchema: bgStart.schema }, async (p) => bgStart.execute(p));
  server.registerTool("bg_status", { description: bgStatus.description, inputSchema: bgStatus.schema }, async (p) => bgStatus.execute(p));
  server.registerTool("bg_logs", { description: bgLogs.description, inputSchema: bgLogs.schema }, async (p) => bgLogs.execute(p));
  server.registerTool("bg_kill", { description: bgKill.description, inputSchema: bgKill.schema }, async (p) => bgKill.execute(p));
  server.registerTool("bg_wait", { description: bgWait.description, inputSchema: bgWait.schema }, async (p) => bgWait.execute(p));
  server.registerTool("bg_send", { description: bgSend.description, inputSchema: bgSend.schema }, async (p) => bgSend.execute(p));

  server.registerResource("status", "bg://status", { title: "Task List", description: "All background tasks as JSON", mimeType: "application/json" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: getStatusJson() }] }));
  server.registerResource("task-status", new ResourceTemplate("bg://{taskId}/status", { list: undefined }), { title: "Task Detail", description: "Single task detail", mimeType: "application/json" },
    async (uri, { taskId }) => { const { json } = getTaskStatus(taskId); return { contents: [{ uri: uri.href, mimeType: "application/json", text: json }] }; });
  server.registerResource("task-logs", new ResourceTemplate("bg://{taskId}/logs", { list: undefined }), { title: "Task Logs", description: "Combined stdout+stderr", mimeType: "text/plain" },
    async (uri, { taskId }) => ({ contents: [{ uri: uri.href, mimeType: "text/plain", text: getTaskLogs(taskId) }] }));
  server.registerResource("task-logs-stdout", new ResourceTemplate("bg://{taskId}/logs/stdout", { list: undefined }), { title: "STDOUT", mimeType: "text/plain" },
    async (uri, { taskId }) => ({ contents: [{ uri: uri.href, mimeType: "text/plain", text: getTaskStream(taskId, "stdout") }] }));
  server.registerResource("task-logs-stderr", new ResourceTemplate("bg://{taskId}/logs/stderr", { list: undefined }), { title: "STDERR", mimeType: "text/plain" },
    async (uri, { taskId }) => ({ contents: [{ uri: uri.href, mimeType: "text/plain", text: getTaskStream(taskId, "stderr") }] }));

  return server;
});

// ── 启动 owner 或 health check ───────────────────────────────────────

const ok = await tryBecomeOwner();
if (!ok) {
  await startMiniHttp();
  process.stderr.write(`[bg-tasks] non-owner, reporting to http://127.0.0.1:${OWNER_PORT}\n`);
  await startHealthCheck();
}
startOrphanCheck();