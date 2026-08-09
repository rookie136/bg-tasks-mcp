/**
 * bg_status — 查询任务状态或列出所有任务
 */

import * as z from "zod/v4";
import * as registry from "../lib/registry.js";

export const schema = z.object({
  id: z.string().optional().describe("Task ID or unique name. Omit to list all tasks."),
});

export const description =
  "Inspect task status or list all tasks. Does not return process output — use bg_logs for that.";

/**
 * @param {{ id?: string }} params
 */
export function execute({ id }) {
  if (!id) {
    const all = registry.all();
    if (all.length === 0) {
      return { content: [{ type: "text", text: "No background tasks" }] };
    }
    const lines = all
      .sort((a, b) => a.order - b.order)
      .map((t) => {
        const uptime = formatUptime(t.startedAt, t.endedAt);
        const extra = [];
        if (t.exitCode !== null) extra.push(`exit=${t.exitCode}`);
        if (t.signal) extra.push(`signal=${t.signal}`);
        const ext = extra.length > 0 ? ` (${extra.join(" ")})` : "";
        return `[${t.id}] "${t.name}" ${t.status} ${t.mode} ${uptime}${ext}`;
      });
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  const task = registry.findByReference(id);
  if (!task) {
    return { content: [{ type: "text", text: `Task not found: ${id}` }] };
  }

  const uptime = formatUptime(task.startedAt, task.endedAt);
  const parts = [
    `Task: ${task.name} (${task.id})`,
    `  Status:  ${task.status}`,
    `  Command: ${task.command}`,
    `  Mode:    ${task.mode}`,
    `  CWD:     ${task.cwd}`,
    `  Uptime:  ${uptime}`,
  ];
  if (task.pid > 0) parts.push(`  PID:     ${task.pid}`);
  if (task.exitCode !== null) parts.push(`  Exit:    ${task.exitCode}`);
  if (task.signal) parts.push(`  Signal:  ${task.signal}`);
  if (task.status === "running") parts.push(`  Tip:     use bg_wait to wait for completion`);

  return { content: [{ type: "text", text: parts.join("\n") }] };
}

function formatUptime(startedAt, endedAt) {
  const ms = (endedAt ?? Date.now()) - startedAt;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ${seconds % 60}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ${seconds % 60}s`;
}