/**
 * 环形缓冲区日志存储，全局单例。
 * 每个 key 最大 4MB，超出时从头部裁剪。
 */

const MAX_SIZE_PER_KEY = 4 * 1024 * 1024; // 4MB

/** @type {Map<string, { chunks: Buffer[], size: number }>} */
const store = new Map();

function ensureBucket(key) {
  let bucket = store.get(key);
  if (!bucket) {
    bucket = { chunks: [], size: 0 };
    store.set(key, bucket);
  }
  return bucket;
}

/**
 * @param {string} key
 * @param {Buffer} chunk
 */
export function append(key, chunk) {
  if (!Buffer.isBuffer(chunk)) return;
  const bucket = ensureBucket(key);
  bucket.chunks.push(chunk);
  bucket.size += chunk.length;

  // 超 4MB 时从头部裁剪
  while (bucket.size > MAX_SIZE_PER_KEY && bucket.chunks.length > 0) {
    const removed = bucket.chunks.shift();
    bucket.size -= removed.length;
  }
}

/**
 * @param {string} key
 * @param {number} lines
 * @returns {string}
 */
export function readTail(key, lines = 100) {
  const bucket = store.get(key);
  if (!bucket || bucket.chunks.length === 0) return "";

  const text = Buffer.concat(bucket.chunks).toString("utf-8");
  const allLines = text.split("\n");
  // 去掉末尾空行 (由末尾 \n 产生)
  if (allLines.length > 0 && allLines[allLines.length - 1] === "") {
    allLines.pop();
  }
  if (lines >= allLines.length) return allLines.join("\n");
  return allLines.slice(-lines).join("\n");
}

/**
 * @param {string} key
 * @param {number} fromLine 起始行 (0-indexed)
 * @param {number} maxLines 最多返回行数
 * @returns {string}
 */
export function readRange(key, fromLine, maxLines = 500) {
  const bucket = store.get(key);
  if (!bucket || bucket.chunks.length === 0) return "";

  const lines = [];
  let lineCount = 0;
  let carry = "";

  for (const chunk of bucket.chunks) {
    const text = chunk.toString("utf-8");
    // 处理分片边界：前一个 chunk 的不完整行拼接到开头
    const chunkLines = (carry + text).split("\n");
    carry = chunkLines.pop() ?? "";

    for (const line of chunkLines) {
      if (lineCount >= fromLine && lines.length < maxLines) {
        lines.push(line);
      }
      lineCount++;
      if (lines.length >= maxLines) break;
    }
    if (lines.length >= maxLines) break;
  }
  // 处理最后一段不完整行
  if (carry && lines.length < maxLines && lineCount >= fromLine) {
    lines.push(carry);
  }

  return lines.join("\n");
}

/**
 * @param {string} key
 * @returns {number}
 */
export function getSize(key) {
  return store.get(key)?.size ?? 0;
}

/**
 * @param {string} key
 */
export function clear(key) {
  store.delete(key);
}

export function clearAll() {
  store.clear();
}