/**
 * bg_send — Send text or OS signals to running background tasks
 *
 * pipe mode: plain text + <Enter> <Space> <C-d> tokens
 * signal mode: send OS signal
 */

import * as z from "zod/v4";
import * as registry from "../lib/registry.js";
import { sendSignal } from "../lib/platform.js";

export const schema = z.object({
  id: z.string().describe("Task ID or unique name (case-insensitive)"),
  input: z.string().min(1).max(65536).optional().describe("Text to send to stdin. Use <Enter> for newline, <Space> for space, <C-d> or <EOF> to close stdin"),
  signal: z.enum(["SIGTERM", "SIGKILL", "SIGINT", "SIGHUP"]).optional().describe("Send an OS signal instead of text"),
});

export const description =
  "Send text and terminal keys to a running pipe task, or signal a running task. Provide exactly one of input or signal.";

function parsePipeInput(input) {
  let eof = false;
  let remaining = input;
  let result = "";

  while (remaining.length > 0) {
    if (remaining.startsWith("\\<") || remaining.startsWith("\\\\")) {
      result += remaining[1];
      remaining = remaining.slice(2);
      continue;
    }

    const tokenStart = remaining.indexOf("<");
    if (tokenStart === -1) {
      result += remaining;
      break;
    }

    result += remaining.slice(0, tokenStart);
    remaining = remaining.slice(tokenStart);

    const tokenEnd = remaining.indexOf(">");
    if (tokenEnd === -1) {
      result += remaining;
      break;
    }

    const token = remaining.slice(1, tokenEnd).trim();
    remaining = remaining.slice(tokenEnd + 1);

    const lower = token.toLowerCase();
    if (lower === "enter" || lower === "cr" || lower === "return") {
      result += "\n";
    } else if (lower === "space" || lower === "spc") {
      result += " ";
    } else if (lower === "eof") {
      eof = true;
      break;
    } else if (lower === "c-d" || lower === "ctrl-d") {
      eof = true;
      break;
    } else {
      throw new Error(`Pipe mode does not support token <${token}>, supported: <Enter> <Space> <C-d> <EOF>`);
    }
  }

  return { data: Buffer.from(result), eof };
}

export async function execute({ id, input, signal }) {
  const task = registry.findByReference(id);
  if (!task) {
    return { content: [{ type: "text", text: `Task not found: ${id}` }] };
  }

  const sourceCount = [input !== undefined, signal !== undefined].filter(Boolean).length;
  if (sourceCount !== 1) {
    return { isError: true, content: [{ type: "text", text: "Provide exactly one of input or signal" }] };
  }

  if (signal) {
    if (task.status !== "running") {
      return { content: [{ type: "text", text: `Task "${task.name}" is not running (${task.status})` }] };
    }
    const result = sendSignal(task.pid, signal);
    if (!result.ok) {
      return { isError: true, content: [{ type: "text", text: `Failed to send ${signal}: ${result.message}` }] };
    }
    return { content: [{ type: "text", text: `Sent ${signal} to "${task.name}" (${task.id})${result.message ? " — " + result.message : ""}` }] };
  }

  if (task.status !== "running" || !task.process) {
    return { content: [{ type: "text", text: `Task "${task.name}" is not running` }] };
  }

  let parsed;
  try {
    parsed = parsePipeInput(input);
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: err.message }] };
  }

  if (parsed.eof) {
    task.process.stdin?.end();
    return { content: [{ type: "text", text: `Closed stdin for "${task.name}"` }] };
  }

  const ok = task.process.stdin?.write(parsed.data);
  if (!ok) {
    return { isError: true, content: [{ type: "text", text: `Failed to write to "${task.name}"'s stdin` }] };
  }

  return {
    content: [{ type: "text", text: `Sent ${parsed.data.length} bytes to "${task.name}" (${task.id})` }],
  };
}