/**
 * 平台适配层。封装 Windows / Unix 差异：
 * shell 命令生成、信号发送、进程树清理。
 */

import { spawn as nodeSpawn } from "node:child_process";

const isWin = process.platform === "win32";

export function isWindows() {
  return isWin;
}

/**
 * 获取适合当前平台的 shell 命令包装
 * @param {string} command
 * @returns {{ file: string, args: string[] }}
 */
export function getShell(command) {
  if (isWin) {
    return { file: "cmd.exe", args: ["/d", "/s", "/c", command] };
  }
  return { file: "/bin/sh", args: ["-c", command] };
}

/**
 * 跨平台 spawn
 * @param {string} command
 * @param {{ cwd?: string, env?: Record<string, string> }} [options]
 * @returns {import("child_process").ChildProcess}
 */
export function spawnCommand(command, options = {}) {
  const shell = getShell(command);
  return nodeSpawn(shell.file, shell.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
}

/**
 * 跨平台杀进程 (含进程树)
 * @param {number} pid
 * @param {"SIGTERM" | "SIGKILL"} signal
 */
export function killProcess(pid, signal = "SIGTERM") {
  if (pid <= 0) return;
  if (isWin) {
    // Windows: taskkill 杀进程树
    try {
      nodeSpawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch { /* 进程可能已退出 */ }
  } else {
    try {
      process.kill(pid, signal);
    } catch { /* 进程可能已退出 */ }
  }
}

/**
 * 跨平台发信号
 * @param {number} pid
 * @param {string} signal
 * @returns {{ ok: boolean, message?: string }}
 */
export function sendSignal(pid, signal) {
  if (isWin) {
    if (signal !== "SIGTERM" && signal !== "SIGKILL") {
      return { ok: false, message: `Signal ${signal} not supported on Windows` };
    }
    killProcess(pid, signal);
    return { ok: true, message: `Sent ${signal} (taskkill /F) on Windows` };
  }
  try {
    process.kill(pid, signal);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}