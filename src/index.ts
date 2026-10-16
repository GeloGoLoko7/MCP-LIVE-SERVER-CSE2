import { guardWrite } from "./guards.js";
import { ensureWorkspace, registerProtocolTools } from "./protocol.js";
import crypto from "node:crypto";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  WORKSPACE_ROOT,
  MAX_FILE_BYTES,
  MAX_WRITE_BYTES,
  MAX_OUTPUT_CHARS,
  ToolError,
  resolveSafe,
} from "./sandbox.js";

const PORT = 3000;
const MAX_ENTRIES = 200;

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

// Wraps every tool: returns clean text on success, a short error on failure
async function run(fn: () => Promise<string>): Promise<ToolResult> {
  try {
    return { content: [{ type: "text", text: await fn() }] };
  } catch (err: any) {
    let msg: string;
    if (err instanceof ToolError) msg = err.message;
    else if (err?.code === "ENOENT") msg = "Not found: that file or folder does not exist.";
    else if (err?.code === "EISDIR") msg = "That path is a folder, not a file.";
    else msg = `Operation failed (${err?.code ?? "unknown error"}).`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}

function truncate(text: string) {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return text.slice(0, MAX_OUTPUT_CHARS) + `\n...[truncated at ${MAX_OUTPUT_CHARS} characters; use start_line/end_line to read more]`;
}

async function walk(dir: string, rel: string, depth: number, out: string[]) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (out.length >= MAX_ENTRIES) return;
    if (e.name === ".git") continue;
    const relPath = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(relPath + "/");
      if (depth > 1) await walk(path.join(dir, e.name), relPath, depth - 1, out);
    } else {
      out.push(relPath);
    }
  }
}

function createServer() {
  const server = new McpServer({ name: "mcp-file-server", version: "0.2.0" });

  server.registerTool(
    "list_files",
    {
      description:
        "List files and folders under a workspace path. Folders end with '/'. Use depth to look into subfolders (max 3). Output is capped at 200 entries.",
      inputSchema: {
        path: z.string().default(".").describe("Folder relative to workspace root, e.g. 'src'"),
        depth: z.number().int().min(1).max(3).default(1).describe("How many levels to list"),
      },
    },
    async ({ path: p, depth }) =>
      run(async () => {
        const abs = await resolveSafe(p ?? ".");
        const out: string[] = [];
        await walk(abs, "", depth ?? 1, out);
        if (out.length === 0) return "(empty)";
        const note = out.length >= MAX_ENTRIES ? `\n...[capped at ${MAX_ENTRIES} entries]` : "";
        return out.join("\n") + note;
      })
  );

  server.registerTool(
    "read_file",
    {
      description:
        "Read a text file from the workspace. Optionally pass start_line and end_line (1-based) to read just part of it.",
      inputSchema: {
        path: z.string().describe("File path relative to workspace root"),
        start_line: z.number().int().min(1).optional(),
        end_line: z.number().int().min(1).optional(),
      },
    },
    async ({ path: p, start_line, end_line }) =>
      run(async () => {
        const abs = await resolveSafe(p);
        const st = await fs.stat(abs);
        if (st.isDirectory()) throw new ToolError("That path is a folder. Use list_files.");
        if (st.size > MAX_FILE_BYTES) {
          throw new ToolError(`File is ${st.size} bytes; the limit is ${MAX_FILE_BYTES}.`);
        }
        const lines = (await fs.readFile(abs, "utf8")).split("\n");
        const start = start_line ?? 1;
        const end = Math.min(end_line ?? lines.length, lines.length);
        if (start > lines.length) {
          throw new ToolError(`File only has ${lines.length} lines.`);
        }
        const body = lines.slice(start - 1, end).join("\n");
        return truncate(`[lines ${start}-${end} of ${lines.length}]\n${body}`);
      })
  );

  server.registerTool(
    "write_file",
    {
      description:
        "Create a file or completely overwrite an existing one. Parent folders are created automatically. For small edits to an existing file, use str_replace instead.",
      inputSchema: {
        path: z.string().describe("File path relative to workspace root"),
        content: z.string().describe("Full file contents"),
      },
    },
    async ({ path: p, content }) =>
      run(async () => {
        const bytes = Buffer.byteLength(content, "utf8");
        if (bytes > MAX_WRITE_BYTES) {
          throw new ToolError(`Content is ${bytes} bytes; the limit is ${MAX_WRITE_BYTES}.`);
        }
        const abs = await resolveSafe(p);
        await guardWrite(abs, "write", content);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, content, "utf8");
        return `Wrote ${bytes} bytes to ${p}`;
      })
  );

  server.registerTool(
    "str_replace",
    {
      description:
        "Replace one exact piece of text in a file. old_str must appear exactly once; if it matches several places, add more surrounding context.",
      inputSchema: {
        path: z.string().describe("File path relative to workspace root"),
        old_str: z.string().min(1).describe("Exact text to find"),
        new_str: z.string().describe("Replacement text (can be empty to delete)"),
      },
    },
    async ({ path: p, old_str, new_str }) =>
      run(async () => {
        const abs = await resolveSafe(p);
        const st = await fs.stat(abs);
        if (st.size > MAX_FILE_BYTES) throw new ToolError("File is too large to edit.");
        const text = await fs.readFile(abs, "utf8");
        const count = text.split(old_str).length - 1;
        if (count === 0) {
          throw new ToolError("old_str was not found. Check whitespace, or read_file to see the current text.");
        }
        if (count > 1) {
          throw new ToolError(`old_str matched ${count} times; add more surrounding context so it matches once.`);
        }
        const updated = text.replace(old_str, () => new_str); // function form avoids '$' tricks
        if (Buffer.byteLength(updated, "utf8") > MAX_WRITE_BYTES) {
          throw new ToolError("Result would exceed the write size limit.");
        }
        await guardWrite(abs, "edit", updated);
        await fs.writeFile(abs, updated, "utf8");
        return `Replaced 1 occurrence in ${p}`;
      })
  );

  server.registerTool(
    "delete_file",
    {
      description: "Delete a single file from the workspace. Folders cannot be deleted with this tool.",
      inputSchema: {
        path: z.string().describe("File path relative to workspace root"),
      },
    },
    async ({ path: p }) =>
      run(async () => {
        const abs = await resolveSafe(p);
        await guardWrite(abs, "delete");
        if (abs === (await fs.realpath(WORKSPACE_ROOT))) {
          throw new ToolError("Cannot delete the workspace root.");
        }
        const st = await fs.lstat(abs);
        if (st.isDirectory()) throw new ToolError("That path is a folder; only files can be deleted.");
        await fs.unlink(abs);
        return `Deleted ${p}`;
      })
  );
  registerProtocolTools(server, run);

  return server;
}

const app = express();
app.use(express.json());

const AUTH_TOKEN = process.env.AUTH_TOKEN;
if (!AUTH_TOKEN && process.env.NODE_ENV === "production") {
  console.error("AUTH_TOKEN must be set in production.");
  process.exit(1);
}

app.use("/mcp", (req, res, next) => {
  if (!AUTH_TOKEN) return next(); // local dev only
  const given = Buffer.from(req.headers.authorization ?? "");
  const expected = Buffer.from(`Bearer ${AUTH_TOKEN}`);
  const ok = given.length === expected.length && crypto.timingSafeEqual(given, expected);
  if (!ok) {
    return res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized." },
      id: null,
    });
  }
  next();
});

app.post("/mcp", async (req, res) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const notAllowed = (_req: express.Request, res: express.Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
};
app.get("/mcp", notAllowed);
app.delete("/mcp", notAllowed);
ensureWorkspace()
  .catch((e) => console.warn("Workspace setup problem:", e?.message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`MCP server running at http://localhost:${PORT}/mcp`);
      console.log(`Workspace root: ${WORKSPACE_ROOT}`);
    });
  });