/**
 * 任务注册表，管理所有后台任务的增删查。
 * 依赖 MemoryLogStore 管理任务关联的日志 key。
 */

import crypto from "node:crypto";
import { clear as clearLog } from "./store.js";
import { getSessionId } from "./session.js";

/** @type {Map<string, BgTask>} */
const tasks = new Map();

/** @type {number} */
let nextOrder = 0;

/** @type {Array<(task: BgTask) => void>} */
const listeners = [];

/**
 * 注册任务事件监听器
 * @param {(task: BgTask) => void} fn
 */
export function onTaskEvent(fn) {
  listeners.push(fn);
}

function emit(task) {
  for (const fn of listeners) fn(task);
}

/**
 * @typedef {Object} BgTask
 * @property {string} id           8 位 hex
 * @property {string} name         用户自定义名
 * @property {string} command      原始 shell 命令
 * @property {"pipe" | "pty"} mode
 * @property {string} cwd          工作目录
 * @property {import("child_process").ChildProcess | null} process
 * @property {number} pid
 * @property {"running" | "completed" | "failed" | "stopped"} status
 * @property {number | null} exitCode
 * @property {string | null} signal
 * @property {number} startedAt
 * @property {number | null} endedAt
 * @property {string} stdoutLogKey
 * @property {string} stderrLogKey
 * @property {AbortController} done    进程结束时 abort
 * @property {boolean} retainForNextTurn
 * @property {number} order            启动顺序
 * @property {string} sessionId        所属会话
 */

function generateId() {
  return crypto.randomBytes(4).toString("hex");
}

function logKey(taskId, stream) {
  return `${taskId}:${stream}`;
}

/**
 * @param {string} name
 * @param {string} command
 * @param {"pipe" | "pty"} mode
 * @param {string} cwd
 * @returns {BgTask}
 */
export function createTask(name, command, mode, cwd) {
  const id = generateId();
  return {
    id,
    name,
    command,
    mode,
    cwd,
    process: null,
    pid: 0,
    status: "running",
    exitCode: null,
    signal: null,
    startedAt: Date.now(),
    endedAt: null,
    stdoutLogKey: logKey(id, "stdout"),
    stderrLogKey: logKey(id, "stderr"),
    done: new AbortController(),
    retainForNextTurn: false,
    order: nextOrder++,
    sessionId: getSessionId(),
  };
}

/**
 * @param {BgTask} task
 */
export function add(task) {
  tasks.set(task.id, task);
  emit(task);
}

/**
 * @param {string} id
 * @returns {BgTask | undefined}
 */
export function get(id) {
  return tasks.get(id);
}

/**
 * 大小写不敏感查找
 * @param {string} name
 * @returns {BgTask | undefined}
 */
export function findByName(name) {
  const lower = name.toLowerCase();
  for (const task of tasks.values()) {
    if (task.name.toLowerCase() === lower) return task;
  }
  return undefined;
}

/**
 * 先按 id 查找，再按 name 模糊匹配
 * @param {string} idOrName
 * @returns {BgTask | undefined}
 */
export function findByReference(idOrName) {
  return get(idOrName) ?? findByName(idOrName);
}

/**
 * @returns {BgTask[]}
 */
export function all() {
  return Array.from(tasks.values());
}

/**
 * @returns {BgTask[]}
 */
export function running() {
  return Array.from(tasks.values()).filter((t) => t.status === "running");
}

/**
 * 获取当前会话的所有任务
 * @returns {BgTask[]}
 */
export function currentSession() {
  const sid = getSessionId();
  return Array.from(tasks.values()).filter((t) => t.sessionId === sid);
}

/**
 * 获取当前会话的已完成任务 (非 running)
 * @returns {BgTask[]}
 */
export function currentSessionHistory() {
  const sid = getSessionId();
  return Array.from(tasks.values()).filter((t) => t.sessionId === sid && t.status !== "running");
}

/**
 * 清除当前会话的已完成任务
 */
export function clearCurrentSessionHistory() {
  const sid = getSessionId();
  for (const [id, task] of tasks) {
    if (task.sessionId === sid && task.status !== "running") {
      clearLog(task.stdoutLogKey);
      clearLog(task.stderrLogKey);
      tasks.delete(id);
    }
  }
}

/**
 * @param {string} id
 */
export function remove(id) {
  const task = tasks.get(id);
  if (task) {
    clearLog(task.stdoutLogKey);
    clearLog(task.stderrLogKey);
    tasks.delete(id);
  }
}

export function dispose() {
  for (const task of tasks.values()) {
    clearLog(task.stdoutLogKey);
    clearLog(task.stderrLogKey);
  }
  tasks.clear();
  nextOrder = 0;
}