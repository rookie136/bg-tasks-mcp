/**
 * bg_start — 启动后台进程 (pipe 模式)
 */

import * as z from "zod/v4";
import * as registry from "../lib/registry.js";
import { append } from "../lib/store.js";
import { spawnCommand } from "../lib/platform.js";
import { log } from "../lib/logger.js";

export const schema = z.object({
  name: z.string().min(1).describe("Unique name for this task (case-insensitive)"),
  command: z.string().min(1).describe("Shell command to run"),
  cwd: z.string().optional().describe("Working directory (defaults to current directory)"),
});

export const description =
  "Start a background task asynchronously. Returns a task ID for use with bg_wait, bg_logs, bg_status, bg_send, and bg_kill.";

/**
 * @param {string} name
 * @param {string} command
 * @param {string} [cwd]
 */
export async function execute({ name, command, cwd }) {
  const normalized = name.trim();
  const duplicate = registry.findByName(normalized);
  if (duplicate) {
    return {
      isError: true,
      content: [{ type: "text", text: `Task name "${normalized}" is already used (${duplicate.id}, ${duplicate.status})` }],
    };
  }

  const workDir = cwd || process.cwd();
  const task = registry.createTask(normalized, command, "pipe", workDir);

  let child;
  try {
    child = spawnCommand(command, { cwd: workDir });
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text", text: `Failed to start: ${err.message}` }],
    };
  }

  task.process = child;
  task.pid = child.pid ?? 0;
  registry.add(task);
  log("bg_start", { id: task.id, name: task.name, cmd: command, pid: task.pid });

  child.stdout?.on("data", (data) => append(task.stdoutLogKey, Buffer.isBuffer(data) ? data : Buffer.from(data)));
  child.stderr?.on("data", (data) => append(task.stderrLogKey, Buffer.isBuffer(data) ? data : Buffer.from(data)));

  child.on("exit", (code, sig) => {
    task.status = code === 0 ? "completed" : "failed";
    task.exitCode = code;
    task.signal = sig;
    task.endedAt = Date.now();
    task.done.abort();
    log("bg_exit", { id: task.id, name: task.name, exit: code, sig: sig || null, ms: task.endedAt - task.startedAt });
  });

  child.on("error", (err) => {
    if (task.status === "running") {
      task.status = "failed";
      task.exitCode = null;
      task.endedAt = Date.now();
      task.done.abort();
    }
    log("bg_err", { id: task.id, name: task.name, err: err.message });
    append(task.stderrLogKey, Buffer.from(`\n[error: ${err.message}]\n`));
  });

  return {
    content: [{
      type: "text",
      text: [
        `Background task started:`,
        `  ID:      ${task.id}`,
        `  Name:    ${task.name}`,
        `  Command: ${command}`,
        `  PID:     ${task.pid}`,
        `  Mode:    ${task.mode}`,
        `  CWD:     ${workDir}`,
        ``,
        `Use bg_wait to wait for completion, bg_logs to read output, bg_kill to terminate.`,
      ].join("\n"),
    }],
  };
}