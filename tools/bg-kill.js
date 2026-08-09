/**
 * bg_kill — 终止后台任务
 */

import * as z from "zod/v4";
import * as registry from "../lib/registry.js";
import { killProcess } from "../lib/platform.js";
import { log } from "../lib/logger.js";

export const schema = z.object({
  id: z.string().describe("Task ID or unique name (case-insensitive)"),
  force: z.boolean().default(false).describe("Send SIGKILL instead of SIGTERM (default: false)"),
});

export const description = "Terminate a running background task. Sends SIGTERM by default or SIGKILL with force=true.";

/**
 * @param {{ id: string, force?: boolean }} params
 */
export async function execute({ id, force }) {
  const task = registry.findByReference(id);
  if (!task) {
    return { content: [{ type: "text", text: `Task not found: ${id}` }] };
  }

  if (task.status !== "running") {
    return { content: [{ type: "text", text: `Task "${task.name}" is already ${task.status}` }] };
  }

  const signal = force ? "SIGKILL" : "SIGTERM";
  killProcess(task.pid, signal);
  log("bg_kill", { id: task.id, name: task.name, signal, pid: task.pid });

  // 等待进程结束
  const waitMs = force ? 500 : 2500;
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, waitMs);
    task.done.signal.addEventListener("abort", () => { clearTimeout(timeout); resolve(); }, { once: true });
  });

  return {
    content: [{
      type: "text",
      text: `${task.status === "running" ? `Sent ${signal}, waiting for termination` : "Terminated"} "${task.name}" (${task.id}). Status: ${task.status}`,
    }],
  };
}