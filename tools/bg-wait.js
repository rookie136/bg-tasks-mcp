/**
 * bg_wait — 等待任务完成或超时。不返回输出，超时不杀进程。
 */

import * as z from "zod/v4";
import * as registry from "../lib/registry.js";

export const schema = z.object({
  id: z.string().describe("Task ID or unique name (case-insensitive)"),
  timeout: z.number().int().min(1).max(3600).default(300).describe("Maximum seconds to wait"),
});

export const description =
  "Wait for a finite task to finish or time out. When output is needed, follow with bg_logs in the same response.";

/**
 * @param {{ id: string, timeout?: number }} params
 */
export async function execute({ id, timeout }) {
  const task = registry.findByReference(id);
  if (!task) {
    return { content: [{ type: "text", text: `Task not found: ${id}` }] };
  }

  if (task.status !== "running") {
    return {
      content: [{ type: "text", text: `Task "${task.name}" is already ${task.status}, no need to wait` }],
    };
  }

  const timeoutMs = timeout * 1000;
  let timedOut = false;

  await new Promise((resolve) => {
    const timer = setTimeout(() => { timedOut = true; resolve(); }, timeoutMs);
    task.done.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });

  const duration = formatDuration((task.endedAt ?? Date.now()) - task.startedAt);

  if (timedOut) {
    return {
      content: [{
        type: "text",
        text: [
          `Timed out waiting for "${task.name}" (${task.id}) after ${formatDuration(timeoutMs)}`,
          `Task is still running, not terminated`,
          `Use bg_logs to read current output`,
        ].join("\n"),
      }],
    };
  }

  const parts = [
    `Task "${task.name}" (${task.id}) ${task.status}, duration ${duration}`,
  ];
  if (task.exitCode !== null) parts.push(`  Exit code: ${task.exitCode}`);
  if (task.signal) parts.push(`  Signal:   ${task.signal}`);

  return { content: [{ type: "text", text: parts.join("\n") }] };
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ${seconds % 60}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ${seconds % 60}s`;
}