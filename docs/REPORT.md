# Report: A sandboxed MCP file server as shared memory for agents

Repository: https://github.com/GeloGoLoko7/MCP-LIVE-SERVER-CSE2

## 1. Stack and why

| Layer | Choice | Why |
|---|---|---|
| Runtime and SDK | Node.js with the official TypeScript MCP SDK | Official SDK tracks the protocol closely and has the most documentation. TypeScript catches path and schema mistakes at build time. |
| Transport | Streamable HTTP (stateless) | Required for a remote client. Stateless mode means each request gets a fresh server, so no session state can leak or go stale. |
| Validation | zod on every tool input | Bad input fails before touching the filesystem, with clear messages. |
| Exposure | ngrok with a free static dev domain | Fastest HTTPS with a stable URL, so the client config does not change between restarts. |
| Process manager | pm2 | Auto-restart and log capture with one config file. Limitation: no boot persistence on Windows without an extra package. |
| Version control | git on the host, inside the workspace | Every agent change is a commit that can be reviewed and rolled back. |
| Testing | MCP Inspector, then Claude Desktop through `mcp-remote` | Inspector for protocol checks, a real client for the end-to-end proof. |

## 2. Tool design

14 tools in three groups: file operations (`list_files`, `read_file`, `write_file`, `str_replace`, `delete_file`), git-lite and search (`git_status`, `git_diff`, `git_commit`, `git_log`, `search_code`), and handoff (`get_project_context`, `append_plan_log`, `record_decision`, `save_checkpoint`).

Design choices:

- **One-call orientation.** `get_project_context` returns state, recent plan log, decisions and the latest checkpoint together, so a fresh session needs one call instead of four or five reads.
- **Small outputs.** Listings cap at 200 entries, search at 100 results, reads support line ranges, and all output is truncated at 20,000 characters with a message saying how to read more.
- **Errors that tell the agent what to do.** For example "old_str matched 2 times; add more surrounding context" and "PLAN_LOG.md is append-only. Use append_plan_log". Error text never includes host paths.
- **Targeted edits.** `str_replace` requires a unique match, which stops silent edits in the wrong place and discourages whole-file rewrites.
- **Purpose-built writers.** Dedicated tools for the plan log, decisions and checkpoints let the generic write tools be blocked on those files.
- **Write guards.** Plan log and decisions are append-only, checkpoints are immutable, and `PROJECT_STATE.md` cannot be deleted, emptied, or cut by more than half in one write.

## 3. Security and sandboxing

- **Path resolution.** Every tool calls one function, `resolveSafe`, which rejects absolute paths, null bytes and `..` escapes, resolves symlinks with `realpath`, and compares against `ROOT + path.sep` so a sibling folder like `workspace-evil` cannot pass as `workspace`. For files that do not exist yet, the deepest existing parent is resolved. Broken symlinks are rejected.
- **`.git` blocked.** Agents cannot touch `.git/`, because a file written into `.git/hooks` would execute on commit. Git is reachable only through the git tools, which use `execFile` with no shell.
- **Limits.** 1 MB per read or write, bounded output, a file-count budget on search, and literal-only search to avoid regex denial of service.
- **Authentication.** A bearer token checked with a constant-time comparison. The server refuses to start in production without one. An unauthenticated request returns 401.
- **Verification.** A 38-step guard test run through Claude Desktop passed in full, including path escapes, `.git` access, append-only and immutable files, and size and uniqueness rules. Screenshots are in `docs/evidence/`.
- **Secrets hygiene.** The token lives in a gitignored config, with an example file committed instead. It was found in the repo during review, then rotated and removed.

Not covered (honest limits): the tunnel is public so the token is the only barrier, there is no rate limiting or per-agent identity, a leaked token gives full workspace access, there is no write locking between concurrent agents, and the free ngrok tier has traffic limits.

## 4. Efficiency and agent management

The same agent instruction (`docs/agent-instruction.md`) was used in every session. It tells the agent to call `get_project_context` first, log each step, use `str_replace` and `search_code` rather than rereading files, and finish with state update, checkpoint and commit.

Demo task: a Node.js markdown-to-HTML converter built over two separate chats, run twice.

| | Run 1 S1 | Run 1 S2 | Run 2 S1 | Run 2 S2 |
|---|---|---|---|---|
| Total tool calls | __ | __ | __ | __ |
| `get_project_context` | __ | __ | __ | __ |
| `write_file` | __ | __ | __ | __ |
| `str_replace` | __ | __ | __ | __ |
| Errors or retries | __ | __ | __ | __ |

Results: both second sessions started cold, called `get_project_context` first, and resumed from the checkpoint without being told anything about the earlier chat. Final tests: 14 passing in run 1, 15 passing in run 2, zero failures. Each run left two commits, plan log entries, a decision record and a checkpoint, all in `docs/evidence/`.

## 5. Lessons and tool changes

- The agent cannot run code, so it reported its tests as unexecuted and miscounted them (it claimed 15 in run 1, the real count was 14). A human ran the tests between sessions. A restricted `run_tests` tool is the obvious next improvement.
- The agent suggested `node --test test/`, which fails on Node 24. It was a good example of unverified agent output.
- Deployment bug: pm2 kept running a stale `dist/` build because the config pointed at the old folder while builds went to `build/`. Fix: a single output folder, and `pm2 delete` then start after changing the script path. Checking `server version` and tool count after each deploy would catch this quickly.
- The first guard test run failed completely because the old server was still running. It also showed the guards work as a regression suite.
- Tool changes after watching the agent: added `get_project_context`, made errors name the correct tool to use, and added `.git` blocking after considering the hooks risk.

## 6. Stretch ideas

`if_version` locking, a repo-map tool, a `run_tests` tool with a fixed command, per-agent tokens, and rate limiting.
