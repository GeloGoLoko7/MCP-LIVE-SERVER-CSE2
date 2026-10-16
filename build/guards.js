"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.guardWrite = guardWrite;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const sandbox_js_1 = require("./sandbox.js");
const APPEND_ONLY = ["plan_log.md", "decisions.md"];
const STATE_FILE = "project_state.md";
const CHECKPOINT_PREFIX = "checkpoints/";
// Call this before any write_file / str_replace / delete_file.
// Compared in lowercase because Windows paths are case-insensitive.
async function guardWrite(abs, op, newContent) {
    const realRoot = await promises_1.default.realpath(sandbox_js_1.WORKSPACE_ROOT);
    const rel = node_path_1.default.relative(realRoot, abs).split(node_path_1.default.sep).join("/").toLowerCase();
    if (APPEND_ONLY.includes(rel)) {
        throw new sandbox_js_1.ToolError(`${node_path_1.default.basename(abs)} is append-only. Use append_plan_log or record_decision.`);
    }
    if (rel.startsWith(CHECKPOINT_PREFIX)) {
        throw new sandbox_js_1.ToolError("CHECKPOINTS/ is immutable. Use save_checkpoint to create a new checkpoint.");
    }
    if (rel === STATE_FILE) {
        if (op === "delete") {
            throw new sandbox_js_1.ToolError("PROJECT_STATE.md cannot be deleted. Edit it instead.");
        }
        if (newContent !== undefined) {
            if (newContent.trim().length === 0) {
                throw new sandbox_js_1.ToolError("Refusing to empty PROJECT_STATE.md.");
            }
            let oldSize = 0;
            try {
                oldSize = (await promises_1.default.stat(abs)).size;
            }
            catch { }
            const newSize = Buffer.byteLength(newContent, "utf8");
            if (oldSize > 200 && newSize < oldSize * 0.5) {
                throw new sandbox_js_1.ToolError(`This write would shrink PROJECT_STATE.md from ${oldSize} to ${newSize} bytes. ` +
                    `Use str_replace for targeted edits, or read it first and write the full updated version.`);
            }
        }
    }
}
