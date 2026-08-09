/**
 * JSONL 日志模块。
 * 写入安装目录下的 .log 文件，自动轮转（1MB 切新文件，保留最近 2 个）。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOG_FILE = path.join(ROOT, ".log");
const MAX_SIZE = 1 * 1024 * 1024; // 1MB
const MAX_BACKUPS = 2;

function ts() {
  return new Date().toISOString().replace(/[-:]/g, "").slice(0, 15).replace("T", "T");
}

function rotate() {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    const stat = fs.statSync(LOG_FILE);
    if (stat.size < MAX_SIZE) return;
    // 删除最老的备份
    const oldest = LOG_FILE + "." + (MAX_BACKUPS - 1);
    try { fs.unlinkSync(oldest); } catch {}
    // 轮换
    for (let i = MAX_BACKUPS - 1; i > 0; i--) {
      const old = LOG_FILE + "." + (i - 1);
      const next = LOG_FILE + "." + i;
      try { fs.renameSync(old, next); } catch {}
    }
    fs.renameSync(LOG_FILE, LOG_FILE + ".0");
  } catch {}
}

/**
 * @param {string} evt
 * @param {Record<string, unknown>} [extra]
 */
export function log(evt, extra) {
  const entry = { ts: ts(), evt, pid: process.pid, ...extra };
  const line = JSON.stringify(entry) + "\n";
  try {
    rotate();
    fs.appendFileSync(LOG_FILE, line, "utf-8");
  } catch {}
}