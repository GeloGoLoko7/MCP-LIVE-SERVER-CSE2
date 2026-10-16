import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveSafe } from "./sandbox.js";

let tmp: string;
let root: string;

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sandbox-test-"));
  root = path.join(tmp, "workspace");
  await fs.mkdir(root);
  await fs.mkdir(path.join(tmp, "workspace-evil")); // sibling with a similar name
  await fs.writeFile(path.join(root, "hello.txt"), "hi");
  await fs.writeFile(path.join(tmp, "secret.txt"), "secret");
});

after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const rejects = (p: string) => assert.rejects(() => resolveSafe(p, root));

test("allows normal paths", async () => {
  await resolveSafe("hello.txt", root);
  await resolveSafe(".", root);
  await resolveSafe("new/deep/file.txt", root); // doesn't exist yet
});

test("rejects ../ escapes", async () => {
  await rejects("../secret.txt");
  await rejects("../../etc/passwd");
  await rejects("foo/../../x");
});

test("rejects absolute paths", async () => {
  await rejects("/etc/passwd");
  await rejects("C:\\Windows\\win.ini");
  await rejects(path.join(tmp, "secret.txt"));
});

test("rejects prefix trick (workspace vs workspace-evil)", async () => {
  await rejects("../workspace-evil/x.txt");
});

test("rejects null bytes", async () => {
  await rejects("hello.txt\0.png");
});

test("rejects symlink pointing outside", async (t) => {
  const link = path.join(root, "link");
  try {
    await fs.symlink(tmp, link, "junction"); // junction works on Windows without admin
  } catch {
    t.skip("could not create a symlink on this system");
    return;
  }
  await rejects("link/secret.txt");
  await rejects("link/new-file.txt");
});