/**
 * 会话管理 — 每次 MCP daemon 启动生成唯一会话 ID。
 * 所有任务标记所属会话，旧会话自动归档。
 */

import crypto from "node:crypto";

/** @type {string} */
let currentSessionId;

export function initSession() {
  if (!currentSessionId) {
    const now = new Date();
    const dateStr = now.toISOString().replace(/[-:]/g, "").slice(0, 15);
    const rand = crypto.randomBytes(3).toString("hex");
    currentSessionId = `${dateStr}-${rand}`;
  }
  return currentSessionId;
}

export function getSessionId() {
  return currentSessionId || initSession();
}