"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolError = exports.MAX_OUTPUT_CHARS = exports.MAX_WRITE_BYTES = exports.MAX_FILE_BYTES = exports.WORKSPACE_ROOT = void 0;
exports.resolveSafe = resolveSafe;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
exports.WORKSPACE_ROOT = node_path_1.default.resolve(process.env.WORKSPACE_ROOT ?? node_path_1.default.join(process.cwd(), "workspace"));
exports.MAX_FILE_BYTES = 1_000_000; // refuse to read files bigger than this
exports.MAX_WRITE_BYTES = 1_000_000; // refuse to write more than this
exports.MAX_OUTPUT_CHARS = 20_000; // cap what we send back to the agent
// An error whose message is safe and useful to show the agent
class ToolError extends Error {
}
exports.ToolError = ToolError;
function isInside(root, target) {
    return target === root || target.startsWith(root + node_path_1.default.sep);
}
async function resolveSafe(userPath, root = exports.WORKSPACE_ROOT) {
    if (typeof userPath !== "string")
        throw new ToolError("Path must be a string.");
    if (userPath.includes("\0"))
        throw new ToolError("Path contains a null byte.");
    if (node_path_1.default.isAbsolute(userPath) || /^[a-zA-Z]:/.test(userPath)) {
        throw new ToolError("Absolute paths are not allowed. Use a path relative to the workspace.");
    }
    const realRoot = await promises_1.default.realpath(root);
    const lexical = node_path_1.default.resolve(realRoot, userPath);
    if (!isInside(realRoot, lexical)) {
        throw new ToolError("Path escapes the workspace.");
    }
    // Walk up to the deepest part that exists, resolve symlinks there,
    // then re-attach the parts that don't exist yet (for new files).
    let current = lexical;
    const tail = [];
    while (true) {
        try {
            const real = await promises_1.default.realpath(current);
            const final = node_path_1.default.join(real, ...tail.reverse());
            if (!isInside(realRoot, final)) {
                throw new ToolError("Path escapes the workspace (symlink).");
            }
            return final;
        }
        catch (err) {
            if (err instanceof ToolError)
                throw err;
            if (err?.code !== "ENOENT")
                throw err;
            // A dangling symlink looks like "doesn't exist" but could point outside
            try {
                await promises_1.default.lstat(current);
                throw new ToolError("Path is a broken symlink.");
            }
            catch (e) {
                if (e instanceof ToolError)
                    throw e;
            }
            const parent = node_path_1.default.dirname(current);
            if (parent === current)
                throw new ToolError("Path could not be resolved.");
            tail.push(node_path_1.default.basename(current));
            current = parent;
        }
    }
}
