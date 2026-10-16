import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const PORT = 3000;
const WORKSPACE_ROOT = path.resolve(process.cwd(), "workspace");

// Build a fresh MCP server with our tools registered
function createServer() {
  const server = new McpServer({ name: "mcp-file-server", version: "0.1.0" });

  server.registerTool(
    "list_files",
    {
      description:
        "List the files and folders at the top level of the workspace. Folders end with '/'.",
    },
    async () => {
      const entries = await fs.readdir(WORKSPACE_ROOT, { withFileTypes: true });
      const lines = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
      return {
        content: [{ type: "text", text: lines.length ? lines.join("\n") : "(empty)" }],
      };
    }
  );

  return server;
}

const app = express();
app.use(express.json());

// Stateless mode: each request gets its own server + transport
app.post("/mcp", async (req, res) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// GET and DELETE aren't used in stateless mode
const notAllowed = (_req: express.Request, res: express.Response) => {
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
  console.log(`Workspace root: ${WORKSPACE_ROOT}`);
});