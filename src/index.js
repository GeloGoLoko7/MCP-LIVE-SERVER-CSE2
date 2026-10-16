"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const zod_1 = require("zod");
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const streamableHttp_js_1 = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const sandbox_js_1 = require("./sandbox.js");
const PORT = 3000;
const MAX_ENTRIES = 200;
// Wraps every tool: returns clean text on success, a short error on failure
async function run(fn) {
    try {
        return { content: [{ type: "text", text: await fn() }] };
    }
    catch (err) {
        let msg;
        if (err instanceof sandbox_js_1.ToolError)
            msg = err.message;
        else if (err?.code === "ENOENT")
            msg = "Not found: that file or folder does not exist.";
        else if (err?.code === "EISDIR")
            msg = "That path is a folder, not a file.";
        else
            msg = `Operation failed (${err?.code ?? "unknown error"}).`;
        return { content: [{ type: "text", text: msg }], isError: true };
    }
}
function truncate(text) {
    if (text.length <= sandbox_js_1.MAX_OUTPUT_CHARS)
        return text;
    return text.slice(0, sandbox_js_1.MAX_OUTPUT_CHARS) + `\n...[truncated at ${sandbox_js_1.MAX_OUTPUT_CHARS} characters; use start_line/end_line to read more]`;
}
async function walk(dir, rel, depth, out) {
    const entries = await promises_1.default.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
        if (out.length >= MAX_ENTRIES)
            return;
        if (e.name === ".git")
            continue;
        const relPath = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
            out.push(relPath + "/");
            if (depth > 1)
                await walk(node_path_1.default.join(dir, e.name), relPath, depth - 1, out);
        }
        else {
            out.push(relPath);
        }
    }
}
function createServer() {
    const server = new mcp_js_1.McpServer({ name: "mcp-file-server", version: "0.2.0" });
    server.registerTool("list_files", {
        description: "List files and folders under a workspace path. Folders end with '/'. Use depth to look into subfolders (max 3). Output is capped at 200 entries.",
        inputSchema: {
            path: zod_1.z.string().default(".").describe("Folder relative to workspace root, e.g. 'src'"),
            depth: zod_1.z.number().int().min(1).max(3).default(1).describe("How many levels to list"),
        },
    }, async ({ path: p, depth }) => run(async () => {
        const abs = await (0, sandbox_js_1.resolveSafe)(p ?? ".");
        const out = [];
        await walk(abs, "", depth ?? 1, out);
        if (out.length === 0)
            return "(empty)";
        const note = out.length >= MAX_ENTRIES ? `\n...[capped at ${MAX_ENTRIES} entries]` : "";
        return out.join("\n") + note;
    }));
    server.registerTool("read_file", {
        description: "Read a text file from the workspace. Optionally pass start_line and end_line (1-based) to read just part of it.",
        inputSchema: {
            path: zod_1.z.string().describe("File path relative to workspace root"),
            start_line: zod_1.z.number().int().min(1).optional(),
            end_line: zod_1.z.number().int().min(1).optional(),
        },
    }, async ({ path: p, start_line, end_line }) => run(async () => {
        const abs = await (0, sandbox_js_1.resolveSafe)(p);
        const st = await promises_1.default.stat(abs);
        if (st.isDirectory())
            throw new sandbox_js_1.ToolError("That path is a folder. Use list_files.");
        if (st.size > sandbox_js_1.MAX_FILE_BYTES) {
            throw new sandbox_js_1.ToolError(`File is ${st.size} bytes; the limit is ${sandbox_js_1.MAX_FILE_BYTES}.`);
        }
        const lines = (await promises_1.default.readFile(abs, "utf8")).split("\n");
        const start = start_line ?? 1;
        const end = Math.min(end_line ?? lines.length, lines.length);
        if (start > lines.length) {
            throw new sandbox_js_1.ToolError(`File only has ${lines.length} lines.`);
        }
        const body = lines.slice(start - 1, end).join("\n");
        return truncate(`[lines ${start}-${end} of ${lines.length}]\n${body}`);
    }));
    server.registerTool("write_file", {
        description: "Create a file or completely overwrite an existing one. Parent folders are created automatically. For small edits to an existing file, use str_replace instead.",
        inputSchema: {
            path: zod_1.z.string().describe("File path relative to workspace root"),
            content: zod_1.z.string().describe("Full file contents"),
        },
    }, async ({ path: p, content }) => run(async () => {
        const bytes = Buffer.byteLength(content, "utf8");
        if (bytes > sandbox_js_1.MAX_WRITE_BYTES) {
            throw new sandbox_js_1.ToolError(`Content is ${bytes} bytes; the limit is ${sandbox_js_1.MAX_WRITE_BYTES}.`);
        }
        const abs = await (0, sandbox_js_1.resolveSafe)(p);
        await promises_1.default.mkdir(node_path_1.default.dirname(abs), { recursive: true });
        await promises_1.default.writeFile(abs, content, "utf8");
        return `Wrote ${bytes} bytes to ${p}`;
    }));
    server.registerTool("str_replace", {
        description: "Replace one exact piece of text in a file. old_str must appear exactly once; if it matches several places, add more surrounding context.",
        inputSchema: {
            path: zod_1.z.string().describe("File path relative to workspace root"),
            old_str: zod_1.z.string().min(1).describe("Exact text to find"),
            new_str: zod_1.z.string().describe("Replacement text (can be empty to delete)"),
        },
    }, async ({ path: p, old_str, new_str }) => run(async () => {
        const abs = await (0, sandbox_js_1.resolveSafe)(p);
        const st = await promises_1.default.stat(abs);
        if (st.size > sandbox_js_1.MAX_FILE_BYTES)
            throw new sandbox_js_1.ToolError("File is too large to edit.");
        const text = await promises_1.default.readFile(abs, "utf8");
        const count = text.split(old_str).length - 1;
        if (count === 0) {
            throw new sandbox_js_1.ToolError("old_str was not found. Check whitespace, or read_file to see the current text.");
        }
        if (count > 1) {
            throw new sandbox_js_1.ToolError(`old_str matched ${count} times; add more surrounding context so it matches once.`);
        }
        const updated = text.replace(old_str, () => new_str); // function form avoids '$' tricks
        if (Buffer.byteLength(updated, "utf8") > sandbox_js_1.MAX_WRITE_BYTES) {
            throw new sandbox_js_1.ToolError("Result would exceed the write size limit.");
        }
        await promises_1.default.writeFile(abs, updated, "utf8");
        return `Replaced 1 occurrence in ${p}`;
    }));
    server.registerTool("delete_file", {
        description: "Delete a single file from the workspace. Folders cannot be deleted with this tool.",
        inputSchema: {
            path: zod_1.z.string().describe("File path relative to workspace root"),
        },
    }, async ({ path: p }) => run(async () => {
        const abs = await (0, sandbox_js_1.resolveSafe)(p);
        if (abs === (await promises_1.default.realpath(sandbox_js_1.WORKSPACE_ROOT))) {
            throw new sandbox_js_1.ToolError("Cannot delete the workspace root.");
        }
        const st = await promises_1.default.lstat(abs);
        if (st.isDirectory())
            throw new sandbox_js_1.ToolError("That path is a folder; only files can be deleted.");
        await promises_1.default.unlink(abs);
        return `Deleted ${p}`;
    }));
    return server;
}
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.post("/mcp", async (req, res) => {
    const server = createServer();
    const transport = new streamableHttp_js_1.StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
        transport.close();
        server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
});
const notAllowed = (_req, res) => {
    res.status(405).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed." },
        id: null,
    });
};
app.get("/mcp", notAllowed);
app.delete("/mcp", notAllowed);
app.listen(PORT, () => {
    console.log(`MCP server running at http://localhost:${PORT}/mcp`);
    console.log(`Workspace root: ${sandbox_js_1.WORKSPACE_ROOT}`);
});
//# sourceMappingURL=index.js.map