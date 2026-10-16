import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  WORKSPACE_ROOT,
  MAX_FILE_BYTES,
  MAX_OUTPUT_CHARS,
  ToolError,
  resolveSafe,
} from "./sandbox.js";

const execFileP = promisify(execFile);

type RunFn = (
  fn: () => Promise<string>
) => Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }>;

/* ---------- workspace setup ---------- */

const TEMPLATES: Record<string, string> = {
  "PROJECT_STATE.md":
    "# Project State\n\n## Goal\n(not set)\n\n## Current status\n(not started)\n\n## Next steps\n- (none yet)\n",
  "PLAN_LOG.md": "# Plan Log (append-only)\n\n",
  "DECISIONS.md": "# Decisions (append-only)\n\n",
  "AGENT_PROTOCOL.md":
    "# Agent protocol\n\n" +
    "Session start: call get_project_context once. Do not re-read what it returned.\n" +
    "While working: append_plan_log after each meaningful step. record_decision for design choices.\n" +
    "Session end: update PROJECT_STATE.md, call save_checkpoint, then git_commit.\n" +
    "Rules: PLAN_LOG and DECISIONS are append-only. CHECKPOINTS is immutable. Use str_replace for small edits.\n",
};

export async function ensureWorkspace() {
  await fs.mkdir(path.join(WORKSPACE_ROOT, "CHECKPOINTS"), { recursive: true });
  for (const [name, text] of Object.entries(TEMPLATES)) {
    const p = path.join(WORKSPACE_ROOT, name);
    try {
      await fs.access(p);
    } catch {
      await fs.writeFile(p, text, "utf8");
    }
  }
  try {
    await fs.access(path.join(WORKSPACE_ROOT, ".git"));
  } catch {
    try {
      await rawGit(["init"]);
      console.log("Initialized git repo in workspace.");
    } catch (e: any) {
      console.warn("Could not init git in workspace:", e?.message);
    }
  }
}

/* ---------- git helpers ---------- */

async function rawGit(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileP("git", ["--no-pager", ...args], {
      cwd: WORKSPACE_ROOT,
      timeout: 15_000,
      maxBuffer: 2_000_000,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return stdout.trim();
  } catch (err: any) {
    if (err?.code === "ENOENT") throw new ToolError("git is not installed on the host.");
    const raw = String(err?.stderr || err?.stdout || err?.message || "git failed");
    const msg = raw.split(WORKSPACE_ROOT).join("<workspace>").trim().slice(0, 500);
    throw new ToolError(`git error: ${msg}`);
  }
}

async function git(args: string[]): Promise<string> {
  try {
    await fs.access(path.join(WORKSPACE_ROOT, ".git"));
  } catch {
    throw new ToolError("The workspace is not a git repository.");
  }
  return rawGit(args);
}

/* ---------- small utilities ---------- */

async function readOpt(name: string): Promise<string> {
  try {
    return await fs.readFile(path.join(WORKSPACE_ROOT, name), "utf8");
  } catch {
    return "";
  }
}

const clip = (s: string, n: number) =>
  s.length > n ? s.slice(0, n) + "\n...[clipped]" : s;

function lastEntries(text: string, n: number) {
  const parts = text.split(/^(?=## )/m).filter((p) => p.startsWith("## "));
  return { shown: parts.slice(-n), total: parts.length };
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
}

async function searchDir(
  dir: string,
  rel: string,
  q: string,
  caseSensitive: boolean,
  max: number,
  out: string[],
  budget: { files: number }
) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (out.length >= max || budget.files <= 0) return;
    if (e.isSymbolicLink() || e.name === ".git" || e.name === "node_modules") continue;
    const abs = path.join(dir, e.name);
    const relPath = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      await searchDir(abs, relPath, q, caseSensitive, max, out, budget);
      continue;
    }
    if (!e.isFile()) continue;
    budget.files--;
    if ((await fs.stat(abs)).size > MAX_FILE_BYTES) continue;
    const buf = await fs.readFile(abs);
    if (buf.includes(0)) continue; // skip binary files
    const lines = buf.toString("utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const hay = caseSensitive ? lines[i] : lines[i].toLowerCase();
      if (hay.includes(q)) {
        out.push(`${relPath}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
        if (out.length >= max) return;
      }
    }
  }
}

/* ---------- tool registration ---------- */

export function registerProtocolTools(server: McpServer, run: RunFn) {
  // ----- handoff tools -----

  server.registerTool(
    "get_project_context",
    {
      description:
        "CALL THIS FIRST in every new session. Returns PROJECT_STATE, the last N plan log entries, " +
        "recent decisions, and the latest checkpoint in one response, so you do not need to read those files separately. " +
        "Session end routine: update PROJECT_STATE.md, save_checkpoint, then git_commit.",
      inputSchema: {
        log_entries: z.number().int().min(1).max(20).default(5).describe("How many recent plan log entries"),
      },
    },
    async ({ log_entries }) =>
      run(async () => {
        const n = log_entries ?? 5;
        const state = await readOpt("PROJECT_STATE.md");
        const log = lastEntries(await readOpt("PLAN_LOG.md"), n);
        const decisions = lastEntries(await readOpt("DECISIONS.md"), 3);

        let cpName = "(none yet)";
        let cpText = "";
        try {
          const files = (await fs.readdir(path.join(WORKSPACE_ROOT, "CHECKPOINTS")))
            .filter((f) => f.endsWith(".md"))
            .sort();
          if (files.length) {
            cpName = files[files.length - 1];
            cpText = await fs.readFile(path.join(WORKSPACE_ROOT, "CHECKPOINTS", cpName), "utf8");
          }
        } catch {}

        const out = [
          "=== PROJECT_STATE.md ===",
          clip(state, 6000) || "(empty)",
          `\n=== PLAN_LOG (last ${log.shown.length} of ${log.total}) ===`,
          clip(log.shown.join("\n"), 5000) || "(no entries)",
          `\n=== DECISIONS (last ${decisions.shown.length} of ${decisions.total}) ===`,
          clip(decisions.shown.join("\n"), 3000) || "(no entries)",
          `\n=== LATEST CHECKPOINT: ${cpName} ===`,
          clip(cpText, 4000) || "(no checkpoints)",
        ].join("\n");
        return clip(out, MAX_OUTPUT_CHARS);
      })
  );

  server.registerTool(
    "append_plan_log",
    {
      description:
        "Append one entry to PLAN_LOG.md (append-only, timestamped). Use after each meaningful step: what you did and what is next.",
      inputSchema: {
        entry: z.string().min(1).max(5000),
        agent: z.string().max(40).optional().describe("Your agent or session name"),
      },
    },
    async ({ entry, agent }) =>
      run(async () => {
        const head = `## ${new Date().toISOString()}${agent ? ` [${agent}]` : ""}`;
        await fs.appendFile(
          path.join(WORKSPACE_ROOT, "PLAN_LOG.md"),
          `${head}\n${entry.trim()}\n\n`,
          "utf8"
        );
        return "Appended to PLAN_LOG.md";
      })
  );

  server.registerTool(
    "record_decision",
    {
      description:
        "Append a design decision to DECISIONS.md (append-only). Use for choices a future session must not silently reverse.",
      inputSchema: {
        title: z.string().min(1).max(120),
        decision: z.string().min(1).max(2000),
        rationale: z.string().min(1).max(2000),
      },
    },
    async ({ title, decision, rationale }) =>
      run(async () => {
        const text =
          `## ${new Date().toISOString()} ${title.trim()}\n` +
          `Decision: ${decision.trim()}\nWhy: ${rationale.trim()}\n\n`;
        await fs.appendFile(path.join(WORKSPACE_ROOT, "DECISIONS.md"), text, "utf8");
        return "Appended to DECISIONS.md";
      })
  );

  server.registerTool(
    "save_checkpoint",
    {
      description:
        "Create a new immutable checkpoint file in CHECKPOINTS/. Call at the end of a session so the next session can resume from get_project_context.",
      inputSchema: {
        summary: z.string().min(1).max(4000).describe("What is done and the current state"),
        next_steps: z.string().min(1).max(2000).describe("Exactly what the next session should do first"),
        files_touched: z.array(z.string().max(200)).max(50).optional(),
      },
    },
    async ({ summary, next_steps, files_touched }) =>
      run(async () => {
        const name = `${stamp()}.md`;
        const body =
          `# Checkpoint ${new Date().toISOString()}\n\n## Summary\n${summary.trim()}\n\n` +
          `## Next steps\n${next_steps.trim()}\n` +
          (files_touched?.length ? `\n## Files touched\n${files_touched.map((f) => `- ${f}`).join("\n")}\n` : "");
        try {
          await fs.writeFile(path.join(WORKSPACE_ROOT, "CHECKPOINTS", name), body, {
            encoding: "utf8",
            flag: "wx", // fail if it already exists
          });
        } catch (e: any) {
          if (e?.code === "EEXIST") throw new ToolError("A checkpoint was just saved. Wait a second and retry.");
          throw e;
        }
        return `Saved CHECKPOINTS/${name}`;
      })
  );

  // ----- git-lite tools -----

  server.registerTool(
    "git_status",
    { description: "Show the workspace's git branch and changed files (short format).", inputSchema: {} },
    async () => run(async () => (await git(["status", "--short", "--branch"])) || "(clean)")
  );

  server.registerTool(
    "git_diff",
    {
      description:
        "Show uncommitted changes. Optionally limit to one file and/or show staged changes. Output is truncated.",
      inputSchema: {
        path: z.string().optional().describe("File path relative to workspace root"),
        staged: z.boolean().default(false),
      },
    },
    async ({ path: p, staged }) =>
      run(async () => {
        const args = ["diff", "--no-color"];
        if (staged) args.push("--cached");
        if (p) {
          const abs = await resolveSafe(p);
          const rel = path.relative(await fs.realpath(WORKSPACE_ROOT), abs).split(path.sep).join("/");
          args.push("--", rel);
        }
        const out = await git(args);
        return out ? clip(out, MAX_OUTPUT_CHARS) : "(no changes)";
      })
  );

  server.registerTool(
    "git_commit",
    {
      description:
        "Stage all changes in the workspace and commit them. A non-empty message is required.",
      inputSchema: {
        message: z.string().max(200).describe("Commit message, required"),
        agent: z.string().regex(/^[\w .-]{1,40}$/).optional().describe("Author name for the commit"),
      },
    },
    async ({ message, agent }) =>
      run(async () => {
        const msg = message.trim();
        if (!msg) throw new ToolError("Commit message must not be empty.");
        if ((await git(["status", "--porcelain"])) === "") return "Nothing to commit.";
        await git(["add", "-A"]);
        await git(
          ["-c", `user.name=${agent ?? "mcp-agent"}`, "-c", "user.email=agent@mcp.local", "commit", "-m", msg]
        );
        return `Committed: ${await git(["log", "-1", "--pretty=format:%h %s"])}`;
      })
  );

  server.registerTool(
    "git_log",
    {
      description: "Show recent commits, newest first (hash, date, message).",
      inputSchema: { limit: z.number().int().min(1).max(50).default(10) },
    },
    async ({ limit }) =>
      run(async () => {
        try {
          return (await git(["log", "-n", String(limit ?? 10), "--pretty=format:%h %ad %an: %s", "--date=short"])) || "(no commits)";
        } catch (e: any) {
          if (String(e.message).includes("does not have any commits")) return "(no commits yet)";
          throw e;
        }
      })
  );

  // ----- search -----

  server.registerTool(
    "search_code",
    {
      description:
        "Search text files in the workspace for a literal string (not a regex). Returns file:line: text, capped at max_results. Skips .git, node_modules and binary files. Prefer this over reading many files.",
      inputSchema: {
        query: z.string().min(1).max(200),
        path: z.string().default(".").describe("Folder to search, relative to workspace root"),
        case_sensitive: z.boolean().default(false),
        max_results: z.number().int().min(1).max(100).default(50),
      },
    },
    async ({ query, path: p, case_sensitive, max_results }) =>
      run(async () => {
        const abs = await resolveSafe(p ?? ".");
        if (!(await fs.stat(abs)).isDirectory()) throw new ToolError("path must be a folder.");
        const cs = case_sensitive ?? false;
        const max = max_results ?? 50;
        const out: string[] = [];
        await searchDir(abs, "", cs ? query : query.toLowerCase(), cs, max, out, { files: 2000 });
        if (out.length === 0) return "No matches.";
        return out.join("\n") + (out.length >= max ? `\n...[capped at ${max} results; narrow the query or path]` : "");
      })
  );
}