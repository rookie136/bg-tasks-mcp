/**
 * bg_logs — 读取后台任务的输出日志
 */

import * as z from "zod/v4";
import * as registry from "../lib/registry.js";
import { readTail, readRange } from "../lib/store.js";

export const schema = z.object({
  id: z.string().describe("Task ID or unique name (case-insensitive)"),
  tail: z.number().int().min(1).max(1000).default(100).describe("Read last N lines"),
  stream: z.enum(["stdout", "stderr", "both"]).default("both").describe("Which stream to read"),
  from_line: z.number().int().min(0).optional().describe("Start from this line (0-indexed). Overrides tail."),
  max_lines: z.number().int().min(1).max(2000).default(500).describe("Max lines with from_line"),
});

export const description =
  "Read retained pipe output. Use after bg_wait to read final output, or use tail=N for recent output.";

/**
 * @param {object} params
 */
export function execute({ id, tail, stream, from_line, max_lines }) {
  const task = registry.findByReference(id);
  if (!task) {
    return { content: [{ type: "text", text: `Task not found: ${id}` }] };
  }

  let stdout = "";
  let stderr = "";

  const readStream = (key) => {
    if (from_line !== undefined) return readRange(key, from_line, max_lines);
    return readTail(key, tail);
  };

  if (stream === "stdout" || stream === "both") stdout = readStream(task.stdoutLogKey);
  if (stream === "stderr" || stream === "both") stderr = readStream(task.stderrLogKey);

  const parts = [];
  if (stream === "both") {
    if (stdout) parts.push(`── stdout ──\n${stdout}`);
    if (stderr) parts.push(`── stderr ──\n${stderr}`);
    if (!stdout && !stderr) parts.push("(no output yet)");
  } else {
    parts.push(stream === "stdout" ? (stdout || "(no stdout yet)") : (stderr || "(no stderr yet)"));
  }

  return { content: [{ type: "text", text: parts.join("\n") }] };
}