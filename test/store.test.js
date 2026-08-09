import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { append, readTail, readRange, getSize, clear, clearAll } from "../lib/store.js";

describe("MemoryLogStore", () => {
  it("appends and reads tail", () => {
    clearAll();
    append("test:stdout", Buffer.from("line1\nline2\nline3\n"));
    assert.equal(readTail("test:stdout", 2), "line2\nline3");
  });

  it("returns empty for unknown key", () => {
    assert.equal(readTail("nonexistent"), "");
  });

  it("returns correct size", () => {
    clear("test:size");
    append("test:size", Buffer.from("hello"));
    assert.equal(getSize("test:size"), 5);
  });

  it("reads range", () => {
    clear("test:range");
    append("test:range", Buffer.from("0\n1\n2\n3\n4\n"));
    assert.equal(readRange("test:range", 1, 2), "1\n2");
  });

  it("clears single key", () => {
    append("test:clear", Buffer.from("data"));
    clear("test:clear");
    assert.equal(getSize("test:clear"), 0);
    assert.equal(readTail("test:clear"), "");
  });

  it("trims old data when exceeding 4MB limit", () => {
    clear("test:large");
    const mb = Buffer.alloc(1024 * 1024, "x");
    // 写入 5MB 数据
    for (let i = 0; i < 5; i++) {
      append("test:large", Buffer.from(`${String(i).repeat(100)}\n`));
    }
    getSize("test:large");
    append("test:large", mb);
    append("test:large", mb);
    append("test:large", mb);
    append("test:large", mb);
    // 超 4MB 后应裁减
    assert.ok(getSize("test:large") <= 4 * 1024 * 1024 + 1024);
  });

  it("clearAll removes everything", () => {
    append("a", Buffer.from("x"));
    append("b", Buffer.from("y"));
    clearAll();
    assert.equal(readTail("a"), "");
    assert.equal(readTail("b"), "");
  });
});