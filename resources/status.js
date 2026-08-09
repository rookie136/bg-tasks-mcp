/**
 * bg://status — 返回所有任务 JSON 摘要
 */

import * as registry from "../lib/registry.js";

/**
 * @returns {string}
 */
export function getStatusJson() {
  const tasks = registry.all().sort((a, b) => a.order - b.order).map((t) => ({
    id: t.id,
    name: t.name,
    command: t.command,
    mode: t.mode,
    cwd: t.cwd,
    status: t.status,
    exitCode: t.exitCode,
    signal: t.signal,
    pid: t.pid,
    uptime: formatUptime(t.startedAt, t.endedAt),
  }));

  return JSON.stringify({
    tasks,
    running: registry.running().length,
    total: tasks.length,
  }, null, 2);
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