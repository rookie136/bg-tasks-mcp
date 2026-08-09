/**
 * 非 owner 进程的任务状态上报。
 * 任务变化时 POST 到 owner 的 /api/report。
 */

import * as registry from "./registry.js";
import { readTail } from "./store.js";
import { log } from "./logger.js";

/** @type {string} */
let ownerUrl = "";

/** @type {number} */
let logPort = 0;

/** @type {NodeJS.Timeout | null} */
let pushTimer = null;

/**
 * @param {string} url
 * @param {number} [port]
 */
export function start(url, port) {
  ownerUrl = url;
  logPort = port || 0;
  // 任务变化时触发推送
  registry.onTaskEvent(() => schedulePush());
  // 定期推送保活（owner 用最后更新时间判断是否过期）
  pushTimer = setInterval(() => doPush(), 10000);
  // 首次立即推送
  schedulePush();
}

export function stop() {
  if (pushTimer) clearInterval(pushTimer);
  pushTimer = null;
}

function schedulePush() {
  // 最多 1s 去抖
  if (!pushTimer) return;
  clearInterval(pushTimer);
  pushTimer = setTimeout(() => { doPush(); pushTimer = setInterval(() => doPush(), 10000); }, 500);
}

function doPush() {
  if (!ownerUrl) return;
  const tasks = registry.currentSession().map((t) => ({
    id: t.id,
    name: t.name,
    command: t.command.slice(0, 80),
    status: t.status,
    pid: t.pid,
    exitCode: t.exitCode,
    startedAt: t.startedAt,
    endedAt: t.endedAt,
    logSummary: readTail(t.stdoutLogKey, 3) || readTail(t.stderrLogKey, 3) || "",
  }));

  fetch(`${ownerUrl}/api/report`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pid: process.pid, port: logPort, tasks }),
    signal: AbortSignal.timeout(2000),
  }).then(() => {
    log("reporter_push", { n: tasks.length, to: ownerUrl });
  }).catch(() => {
    log("reporter_err", { to: ownerUrl });
  });
}