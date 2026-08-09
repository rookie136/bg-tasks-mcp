/**
 * bg://{id}/* — single task detail, log resources
 */

import * as registry from "../lib/registry.js";
import { readTail, getSize } from "../lib/store.js";

/**
 * @param {string} taskId
 * @returns {{ json: string, found: boolean }}
 */
export function getTaskStatus(taskId) {
  const task = registry.findByReference(taskId);
  if (!task) return { json: JSON.stringify({ error: "not found", id: taskId }), found: false };

  const json = JSON.stringify({
    id: task.id,
    name: task.name,
    command: task.command,
    mode: task.mode,
    cwd: task.cwd,
    status: task.status,
    exitCode: task.exitCode,
    signal: task.signal,
    pid: task.pid,
    startedAt: task.startedAt,
    endedAt: task.endedAt,
    logSummary: {
      stdout: readTail(task.stdoutLogKey, 5),
      stderr: readTail(task.stderrLogKey, 5),
    },
  }, null, 2);

  return { json, found: true };
}

/**
 * @param {string} taskId
 * @returns {string}
 */
export function getTaskLogs(taskId) {
  const task = registry.findByReference(taskId);
  if (!task) return "Task not found";

  const stdout = readTail(task.stdoutLogKey, 200);
  const stderr = readTail(task.stderrLogKey, 200);
  const parts = [];
  if (stdout) parts.push(`── stdout ──\n${stdout}`);
  if (stderr) parts.push(`── stderr ──\n${stderr}`);
  return parts.join("\n") || "(no output yet)";
}

/**
 * @param {string} taskId
 * @param {"stdout" | "stderr"} stream
 * @returns {string}
 */
export function getTaskStream(taskId, stream) {
  const task = registry.findByReference(taskId);
  if (!task) return "Task not found";

  const key = stream === "stdout" ? task.stdoutLogKey : task.stderrLogKey;
  return readTail(key, 200) || `(no ${stream} yet)`;
}