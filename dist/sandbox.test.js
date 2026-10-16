"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const sandbox_js_1 = require("./sandbox.js");
let tmp;
let root;
(0, node_test_1.before)(async () => {
    tmp = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "sandbox-test-"));
    root = node_path_1.default.join(tmp, "workspace");
    await promises_1.default.mkdir(root);
    await promises_1.default.mkdir(node_path_1.default.join(tmp, "workspace-evil")); // sibling with a similar name
    await promises_1.default.writeFile(node_path_1.default.join(root, "hello.txt"), "hi");
    await promises_1.default.writeFile(node_path_1.default.join(tmp, "secret.txt"), "secret");
});
(0, node_test_1.after)(async () => {
    await promises_1.default.rm(tmp, { recursive: true, force: true });
});
const rejects = (p) => strict_1.default.rejects(() => (0, sandbox_js_1.resolveSafe)(p, root));
(0, node_test_1.test)("allows normal paths", async () => {
    await (0, sandbox_js_1.resolveSafe)("hello.txt", root);
    await (0, sandbox_js_1.resolveSafe)(".", root);
    await (0, sandbox_js_1.resolveSafe)("new/deep/file.txt", root); // doesn't exist yet
});
(0, node_test_1.test)("rejects ../ escapes", async () => {
    await rejects("../secret.txt");
    await rejects("../../etc/passwd");
    await rejects("foo/../../x");
});
(0, node_test_1.test)("rejects absolute paths", async () => {
    await rejects("/etc/passwd");
    await rejects("C:\\Windows\\win.ini");
    await rejects(node_path_1.default.join(tmp, "secret.txt"));
});
(0, node_test_1.test)("rejects prefix trick (workspace vs workspace-evil)", async () => {
    await rejects("../workspace-evil/x.txt");
});
(0, node_test_1.test)("rejects null bytes", async () => {
    await rejects("hello.txt\0.png");
});
(0, node_test_1.test)("rejects symlink pointing outside", async (t) => {
    const link = node_path_1.default.join(root, "link");
    try {
        await promises_1.default.symlink(tmp, link, "junction"); // junction works on Windows without admin
    }
    catch {
        t.skip("could not create a symlink on this system");
        return;
    }
    await rejects("link/secret.txt");
    await rejects("link/new-file.txt");
});
//# sourceMappingURL=sandbox.test.js.map