/**
 * HTTP 边车服务 — Web 仪表盘 + 多窗口任务聚合
 *
 * 路由:
 *   GET /                    → 仪表盘 HTML (分区: 运行中 / 本会话历史 / 归档会话 / 其他窗口)
 *   GET /status              → JSON API
 *   GET /logs/{id}           → 日志页面 HTML
 *   GET /logs/{id}/raw[/stdout|stderr]  → 纯文本日志
 *   POST /clear-history      → 清除本会话历史
 *   GET /api/health          → owner 存活检测
 *   POST /api/report         → 非 owner 推送任务状态
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as registry from "./registry.js";
import { readTail } from "./store.js";
import { getSessionId } from "./session.js";
import { log } from "./logger.js";
import { t } from "./i18n.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PORT = 9876;
const MAX_PORT_TRIES = 10;
const PORT_FILE = path.join(ROOT, ".port");

function statusLabel(status) {
  // universal — no translation needed
  return status;
}

// ── 其他窗口任务聚合 ────────────────────────────────────────────────

/** @type {Map<number, { tasks: any[], timestamp: number, port: number }>} */
const remoteTasks = new Map();
const REMOTE_TTL = 15000; // 15s 无更新视为离线

function pruneRemote() {
  const now = Date.now();
  for (const [pid, entry] of remoteTasks) {
    if (now - entry.timestamp > REMOTE_TTL) remoteTasks.delete(pid);
  }
}

export function handleReport(pid, tasks, port) {
  remoteTasks.set(pid, { tasks, timestamp: Date.now(), port: port || 0 });
  log("report_rcv", { pid, n: tasks.length, port: port || 0 });
}

export function getRemoteTasks() {
  pruneRemote();
  const all = [];
  for (const [pid, entry] of remoteTasks) {
    for (const t of entry.tasks) {
      all.push({ ...t, _remotePid: pid, _remotePort: entry.port });
    }
  }
  return all;
}

export function getRemoteTasksByPid() {
  pruneRemote();
  return new Map(remoteTasks);
}

export function clearRemote(pid) {
  remoteTasks.delete(pid);
}

export function clearAllRemote() {
  remoteTasks.clear();
}

// ── HTML helpers ───────────────────────────────────────────────────────

function htmlEscape(s) {
  return String(s).replace(/\x1b\[[\d;]*m/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatUptime(startedAt, endedAt) {
  const ms = (endedAt ?? Date.now()) - startedAt;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ${s % 60}s`;
}

function statusBadge(status) {
  const map = { running: ["●", "#22c55e"], completed: ["✓", "#888"], failed: ["✗", "#ef4444"], stopped: ["■", "#f59e0b"] };
  const [icon, color] = map[status] || ["?", "#888"];
  return `<span style="color:${color}">${icon}</span>`;
}

// ── Dashboard ──────────────────────────────────────────────────────────

function renderDashboard(lang) {
  const localRunning = registry.running().sort((a, b) => a.order - b.order);
  const localHistory = registry.currentSessionHistory().sort((a, b) => b.endedAt - a.endedAt);
  const remotes = getRemoteTasks();
  const remoteRunning = remotes.filter((t) => t.status === "running");
  const remoteByPid = getRemoteTasksByPid();
  const remoteDone = remotes.filter((t) => t.status !== "running");

  const totalRunning = localRunning.length + remoteRunning.length;

  function taskRow(t, remotePid, remotePort) {
    const uptime = formatUptime(t.startedAt, t.endedAt);
    const last = htmlEscape((t.logSummary || (t.status !== "running" ? `exit: ${t.exitCode ?? "?"}` : "—")).slice(0, 60));
    const cmd = htmlEscape((t.command || "").slice(0, 45));
    const nameHtml = remotePort
      ? `<a href="http://127.0.0.1:${remotePort}/logs/${t.id}" target="_blank">${htmlEscape(t.name)}</a>`
      : htmlEscape(t.name);
    return `<tr>
      <td>${statusBadge(t.status)}</td>
      <td>${nameHtml}</td>
      <td style="font-size:11px;color:#888" title="${htmlEscape(t.command || "")}">${cmd}</td>
      <td>${uptime}</td>
      <td style="font-size:11px;color:#666">${last}</td>
      <td style="font-size:10px;color:#585b70">${remotePid ? `PID ${remotePid}` : ""}</td>
    </tr>`;
  }

  function localRow(t) {
    const uptime = formatUptime(t.startedAt, t.endedAt);
    const last = t.status === "running"
      ? htmlEscape((readTail(t.stdoutLogKey, 1) || readTail(t.stderrLogKey, 1) || "—").slice(0, 60))
      : `exit: ${t.exitCode ?? "?"}`;
    const cmd = htmlEscape(t.command.slice(0, 45));
    return `<tr>
      <td>${statusBadge(t.status)}</td>
      <td><a href="/logs/${t.id}">${htmlEscape(t.name)}</a></td>
      <td style="font-size:12px;color:#888" title="${htmlEscape(t.command)}">${cmd}${t.command.length > 45 ? "…" : ""}</td>
      <td>${uptime}</td>
      <td style="font-size:12px;color:#666">${last}</td>
    </tr>`;
  }

  function renderTable(tasks, local, emptyMsg) {
    if (tasks.length === 0) return `<p style="color:#585b70">${emptyMsg}</p>`;
    const header = local
      ? `<thead><tr><th></th><th>${t(lang, "name")}</th><th>${t(lang, "command")}</th><th>${t(lang, "uptime")}</th><th>${t(lang, "last")}</th></tr></thead>`
      : `<thead><tr><th></th><th>${t(lang, "name")}</th><th>${t(lang, "command")}</th><th>${t(lang, "uptime")}</th><th>${t(lang, "last")}</th><th>${t(lang, "source")}</th></tr></thead>`;
    const body = `<tbody>${tasks.map((t) => local ? localRow(t) : taskRow(t, t._remotePid, t._remotePort)).join("")}</tbody>`;
    return `<table style="margin:0">${header}${body}</table>`;
  }

  // 运行中列表（合并所有窗口）
  const allRunning = [
    ...localRunning.map((t) => ({ local: t })),
    ...remoteRunning.map((t) => ({ remote: t })),
  ];
  const runningHtml = allRunning.length === 0
    ? `<p style="color:#585b70">${t(lang, "noRunning")}</p>`
    : `<table style="margin:0"><thead><tr><th></th><th>${t(lang, "name")}</th><th>${t(lang, "command")}</th><th>${t(lang, "uptime")}</th><th>${t(lang, "last")}</th><th>${t(lang, "source")}</th></tr></thead><tbody>${
      allRunning.map((r) => {
        if (r.local) {
          const task = r.local;
          return `<tr><td>${statusBadge(task.status)}</td><td><a href="/logs/${task.id}">${htmlEscape(task.name)}</a></td><td style="font-size:12px;color:#888">${htmlEscape(task.command.slice(0, 45))}</td><td>${formatUptime(task.startedAt, task.endedAt)}</td><td style="font-size:12px;color:#666">${htmlEscape((readTail(task.stdoutLogKey, 1) || readTail(task.stderrLogKey, 1) || "—").slice(0, 60))}</td><td style="font-size:10px;color:#585b70">${t(lang, "window")}</td></tr>`;
        }
        return taskRow(r.remote, r.remote._remotePid, r.remote._remotePort);
      }).join("")
    }</tbody></table>`;

  // 统计
  const allCounts = { running: totalRunning, completed: 0, failed: 0, total: (registry.all().length + remotes.length) };
  for (const t of registry.all()) if (allCounts[t.status] !== undefined) allCounts[t.status]++;
  for (const t of remotes) if (allCounts[t.status] !== undefined) allCounts[t.status]++;

  // ── 窗口列表 ────────────────────────────────────────────────
  function relativeTime(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 5) return t(lang, "justNow");
    if (s < 60) return s + t(lang, "secAgo");
    const m = Math.floor(s / 60);
    if (m < 60) return m + t(lang, "minAgo");
    return Math.floor(m / 60) + t(lang, "hourAgo");
  }
  function renderWindowList(remoteByPid) {
    const ownerRunning = localRunning.length;
    const ownerTotal = registry.all().length;
    const rows = [`<tr>
      <td>PID ${process.pid}</td>
      <td style="color:#f9e2af">👑 ${t(lang, "owner")}</td>
      <td>${ownerRunning}/${ownerTotal}</td>
      <td style="color:#585b70">—</td>
    </tr>`];
    for (const [pid, entry] of remoteByPid) {
      const r = entry.tasks.filter((t) => t.status === "running").length;
      const total = entry.tasks.length;
      const active = relativeTime(entry.timestamp);
      rows.push(`<tr>
        <td>PID ${pid}</td>
        <td style="color:#a6adc8">${t(lang, "remote")}</td>
        <td>${r}/${total}</td>
        <td style="color:#585b70">${active}</td>
      </tr>`);
    }
    const total = 1 + remoteByPid.size;
    return `<details open style="margin-bottom:16px">
      <summary style="cursor:pointer;color:#bac2de;font-size:13px;font-weight:600">📋 ${t(lang, "windowList")} (${total})</summary>
      <table style="margin:8px 0 0;font-size:13px">
        <thead><tr><th>${t(lang, "pid")}</th><th>${t(lang, "role")}</th><th>${t(lang, "task")}</th><th>${t(lang, "lastActive")}</th></tr></thead>
        <tbody>${rows.join("")}</tbody>
      </table>
    </details>`;
  }

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>bg-tasks</title>
<style>
  body { font-family: system-ui,monospace; background:#1e1e2e; color:#cdd6f4; margin:0; padding:24px; }
  a { color:#89b4fa; text-decoration:none; }
  a:hover { text-decoration:underline; }
  table { width:100%; border-collapse:collapse; }
  th, td { padding:6px 10px; text-align:left; border-bottom:1px solid #313244; }
  th { color:#a6adc8; font-size:11px; text-transform:uppercase; }
  .section { margin:16px 0; }
  .section-title { font-size:14px; font-weight:600; margin:12px 0 8px; color:#bac2de; display:flex; justify-content:space-between; }
  .section-title span { color:#585b70; font-weight:400; font-size:12px; }
  .btn { background:#313244; color:#cdd6f4; border:1px solid #45475a; border-radius:4px; padding:4px 10px; cursor:pointer; font-size:12px; }
  .btn:hover { background:#45475a; }
  .footer { margin-top:24px; padding-top:12px; border-top:1px solid #313244; font-size:12px; color:#585b70; }
</style>
</head>
<body>
<h2 style="margin-top:0;">⚙ bg-tasks v0.7.0 <a href="?lang=${lang === "zh" ? "en" : "zh"}" style="font-size:12px;color:#585b70;margin-left:8px;text-decoration:none">${lang === "zh" ? "EN" : "中文"}</a><button onclick="location.reload()" style="float:right;background:#313244;color:#cdd6f4;border:1px solid #45475a;border-radius:4px;padding:4px 12px;cursor:pointer;font-size:14px">⟳ ${t(lang, "refresh")}</button></h2>

${renderWindowList(remoteByPid)}

<div class="section">
  <div class="section-title"><span>● ${t(lang, "running")} (${totalRunning})</span></div>
  ${runningHtml}
</div>

<div class="section">
    <div class="section-title">
      <span>▼ ${t(lang, "history")} (${localHistory.length})</span>
      ${localHistory.length > 0 ? `<form method="post" action="/clear-history?lang=${lang}" style="display:inline"><button class="btn" onclick="return confirm('${t(lang, "clearConfirm", localHistory.length)}')">${t(lang, "clear")}</button></form>` : ""}
    </div>
    ${localHistory.length > 0 ? renderTable(localHistory, true, "") : `<p style="color:#585b70">${t(lang, "noHistory")}</p>`}
  </div>

${Array.from(remoteByPid.entries()).map(([pid, entry]) => {
  const rt = entry.tasks.filter((t) => t.status !== "running");
  if (rt.length === 0) return "";
  return `<div class="section">
    <div class="section-title">
      <span>▼ PID ${pid} (${rt.length})</span>
      <form method="post" action="/clear-remote/${pid}?lang=${lang}" style="display:inline"><button class="btn" onclick="return confirm('${t(lang, "clearRemoteConfirm", rt.length, pid)}')">${t(lang, "clear")}</button></form>
    </div>
    ${renderTable(rt.sort((a, b) => b.startedAt - a.startedAt), false, "")}
  </div>`;
}).join("")}

${remoteDone.filter((t) => !remoteByPid.get(t._remotePid)).length > 0 ? `<div class="section"><div class="section-title"><span>▼ ${t(lang, "otherDone")} (${remoteDone.filter((t) => !remoteByPid.get(t._remotePid)).length})</span></div>${renderTable(remoteDone.filter((t) => !remoteByPid.get(t._remotePid)).sort((a, b) => b.startedAt - a.startedAt), false, "")}</div>` : ""}

<div class="footer">
  <span>${t(lang, "summaryLine", allCounts.running, allCounts.completed, allCounts.failed, allCounts.total)}</span>
    <span style="float:right">${t(lang, "curlTip", actualPort)}</span>
</div>
</body>
</html>`;
}

// ── Log Page ──────────────────────────────────────────────────────────

function renderLogPage(taskId, lang) {
  const task = registry.findByReference(taskId);
  if (!task) return { code: 404, body: t(lang, "notFound") };

  const stdout = readTail(task.stdoutLogKey, 200);
  const stderr = readTail(task.stderrLogKey, 200);
  const uptime = formatUptime(task.startedAt, task.endedAt);

  return { code: 200, body: `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${htmlEscape(task.name)} — bg-tasks</title>
<style>
  body { font-family: system-ui,monospace; background:#1e1e2e; color:#cdd6f4; margin:0; padding:24px; }
  a { color:#89b4fa; text-decoration:none; }
  .meta { font-size:13px; color:#a6adc8; margin-bottom:16px; }
  .meta b { color:#cdd6f4; }
  .log-block { background:#11111b; border-radius:6px; padding:16px; margin:8px 0; white-space:pre-wrap; word-break:break-all; font-size:13px; line-height:1.5; max-height:60vh; overflow-y:auto; }
  .log-label { font-size:11px; color:#585b70; text-transform:uppercase; margin:12px 0 4px; }
  .nav { margin-bottom:16px; }
</style>
</head>
<body>
<div class="nav"><a href="http://127.0.0.1:9876/?lang=${lang}">${t(lang, "backDashboard")}</a> <button onclick="location.reload()" style="float:right;background:#313244;color:#cdd6f4;border:1px solid #45475a;border-radius:4px;padding:4px 12px;cursor:pointer;font-size:14px">⟳ ${t(lang, "refresh")}</button></div>
<div class="meta">
  ${statusBadge(task.status)} <b>${htmlEscape(task.name)}</b> (${task.id})
  | <b>${htmlEscape(task.command)}</b>
  | PID: ${task.pid}
  | ${uptime}
  ${task.exitCode !== null ? `| ${t(lang, "exit")}: ${task.exitCode}` : ""}
</div>
<div class="log-label">── ${t(lang, "stdout")} ──</div>
<div class="log-block">${stdout ? htmlEscape(stdout) : `<span style="color:#585b70">${t(lang, "noStdout")}</span>`}</div>
<div class="log-label">── ${t(lang, "stderr")} ──</div>
<div class="log-block">${stderr ? htmlEscape(stderr) : `<span style="color:#585b70">${t(lang, "noStderr")}</span>`}</div>
</body>
</html>` };
}

// ── Helpers ───────────────────────────────────────────────────────────

function send(res, code, contentType, body) {
  res.writeHead(code, { "content-type": contentType, "cache-control": "no-cache" });
  res.end(body);
}

let actualPort = DEFAULT_PORT;

// ── Main: 创建 HTTP server (仅 owner 调用) ───────────────────────────

export function createServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${actualPort}`);
      const pn = url.pathname;

      // GET /api/health
      if (req.method === "GET" && pn === "/api/health") {
        return send(res, 200, "application/json", JSON.stringify({ status: "ok" }));
      }

      // POST /api/report
      if (req.method === "POST" && pn === "/api/report") {
        let body = "";
        req.on("data", (chunk) => body += chunk);
        req.on("end", () => {
          try {
            const data = JSON.parse(body);
            handleReport(data.pid, data.tasks || [], data.port || 0);
            send(res, 200, "application/json", JSON.stringify({ ok: true }));
          } catch {
            send(res, 400, "application/json", JSON.stringify({ ok: false }));
          }
        });
        return;
      }

      const lang = url.searchParams.get("lang") === "zh" ? "zh" : "en";

      // POST /clear-history
      if (req.method === "POST" && pn === "/clear-history") {
        registry.clearCurrentSessionHistory();
        res.writeHead(303, { "location": `/?lang=${lang}` });
        return res.end();
      }

      // POST /clear-remote/{pid}
      const clearRemoteMatch = pn.match(/^\/clear-remote\/(\d+)$/);
      if (req.method === "POST" && clearRemoteMatch) {
        clearRemote(parseInt(clearRemoteMatch[1]));
        res.writeHead(303, { "location": `/?lang=${lang}` });
        return res.end();
      }

      // GET /status
      if (req.method === "GET" && pn === "/status") {
        const local = registry.all().sort((a, b) => a.order - b.order).map((t) => ({
          id: t.id, name: t.name, command: t.command, mode: t.mode, cwd: t.cwd,
          status: t.status, exitCode: t.exitCode, signal: t.signal, pid: t.pid,
          uptime: formatUptime(t.startedAt, t.endedAt), sessionId: t.sessionId,
        }));
        const remote = getRemoteTasks();
        return send(res, 200, "application/json; charset=utf-8",
          JSON.stringify({ tasks: [...local, ...remote], running: registry.running().length + remote.filter((t) => t.status === "running").length, total: local.length + remote.length, sessionId: getSessionId() }, null, 2));
      }

      // GET /logs/{id}
      const logMatch = pn.match(/^\/logs\/([a-f0-9]+)$/);
      if (req.method === "GET" && logMatch) {
        const result = renderLogPage(logMatch[1], lang);
        return send(res, result.code, result.code === 404 ? "text/plain" : "text/html; charset=utf-8", result.body);
      }

      // GET /logs/{id}/raw ...
      const rawMatch = pn.match(/^\/logs\/([a-f0-9]+)\/raw$/);
      if (req.method === "GET" && rawMatch) {
        const task = registry.findByReference(rawMatch[1]);
        if (!task) return send(res, 404, "text/plain", t(lang, "notFound"));
        const out = readTail(task.stdoutLogKey, 200);
        const err = readTail(task.stderrLogKey, 200);
return send(res, 200, "text/plain; charset=utf-8", [out && `── ${t(lang, "stdout")} ──\n${out}`, err && `── ${t(lang, "stderr")} ──\n${err}`].filter(Boolean).join("\n") || t(lang, "noOutput"));

        // GET /logs/{id}/raw/stdout|stderr
        for (const stream of ["stdout", "stderr"]) {
          const m = pn.match(new RegExp(`^/logs/([a-f0-9]+)/raw/${stream}$`));
          if (req.method === "GET" && m) {
            const task = registry.findByReference(m[1]);
            if (!task) return send(res, 404, "text/plain", t(lang, "notFound"));
            const key = stream === "stdout" ? task.stdoutLogKey : task.stderrLogKey;
            return send(res, 200, "text/plain; charset=utf-8", readTail(key, 200) || t(lang, stream === "stdout" ? "noStdout" : "noStderr"));
          }
        }
      }

      // GET /
      if (req.method === "GET" && (pn === "/" || pn === "")) {
        return send(res, 200, "text/html; charset=utf-8", renderDashboard(lang));
      }

      send(res, 404, "text/plain", "404");
    } catch (err) {
      send(res, 500, "text/plain", `500: ${err.message}`);
    }
  });

  return {
    server,
    listen(portOption) {
      const target = portOption ?? DEFAULT_PORT;
      actualPort = target;
      return new Promise((resolve) => {
        server.listen(target, "127.0.0.1", () => {
          try {
            const dir = path.dirname(PORT_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(PORT_FILE, String(target));
          } catch {}
          resolve({ port: target });
        });
        server.once("error", (err) => {
          if (err.code === "EADDRINUSE") {
            server.removeAllListeners("error");
            resolve({ port: 0, error: "EADDRINUSE" });
          } else {
            resolve({ port: 0, error: err.message });
          }
        });
      });
    },
    close() {
      server.close();
      try { fs.unlinkSync(PORT_FILE); } catch {}
    },
    get port() { return actualPort; },
  };
}