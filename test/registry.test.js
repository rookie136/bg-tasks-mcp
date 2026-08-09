import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createTask, add, get, findByName, findByReference,
  all, running, remove, dispose,
} from "../lib/registry.js";

describe("TaskRegistry", () => {
  it("creates task with unique id", () => {
    const a = createTask("test", "echo hello", "pipe", "/tmp");
    const b = createTask("test2", "echo world", "pipe", "/tmp");
    assert.ok(a.id !== b.id);
    assert.equal(a.name, "test");
    assert.equal(a.mode, "pipe");
    assert.equal(a.status, "running");
  });

  it("adds and gets by id", () => {
    const task = createTask("get-test", "cmd", "pipe", ".");
    add(task);
    assert.equal(get(task.id), task);
  });

  it("finds by name (case-insensitive)", () => {
    const task = createTask("MyTask", "cmd", "pipe", ".");
    add(task);
    assert.equal(findByName("mytask"), task);
    assert.equal(findByName("MYTASK"), task);
  });

  it("findByReference works with id or name", () => {
    const task = createTask("ref-test", "cmd", "pipe", ".");
    add(task);
    assert.equal(findByReference(task.id), task);
    assert.equal(findByReference("ref-test"), task);
  });

  it("lists all and running", () => {
    dispose();
    const t1 = createTask("a", "c", "pipe", ".");
    const t2 = createTask("b", "c", "pipe", ".");
    t2.status = "completed";
    add(t1);
    add(t2);
    assert.equal(all().length, 2);
    assert.equal(running().length, 1);
    assert.equal(running()[0], t1);
  });

  it("removes task", () => {
    dispose();
    const task = createTask("remove-me", "cmd", "pipe", ".");
    add(task);
    remove(task.id);
    assert.equal(get(task.id), undefined);
    assert.equal(all().length, 0);
  });

  it("dispose clears everything", () => {
    add(createTask("a", "c", "pipe", "."));
    add(createTask("b", "c", "pipe", "."));
    dispose();
    assert.equal(all().length, 0);
  });
});