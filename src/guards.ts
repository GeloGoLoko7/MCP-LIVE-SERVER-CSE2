import fs from "node:fs/promises";
import path from "node:path";
import { WORKSPACE_ROOT, ToolError } from "./sandbox.js";

const APPEND_ONLY = ["plan_log.md", "decisions.md"];
const STATE_FILE = "project_state.md";
const CHECKPOINT_PREFIX = "checkpoints/";

// Call this before any write_file / str_replace / delete_file.
// Compared in lowercase because Windows paths are case-insensitive.
export async function guardWrite(
  abs: string,
  op: "write" | "edit" | "delete",
  newContent?: string
) {
  const realRoot = await fs.realpath(WORKSPACE_ROOT);
  const rel = path.relative(realRoot, abs).split(path.sep).join("/").toLowerCase();

  if (APPEND_ONLY.includes(rel)) {
    throw new ToolError(
      `${path.basename(abs)} is append-only. Use append_plan_log or record_decision.`
    );
  }

  if (rel.startsWith(CHECKPOINT_PREFIX)) {
    throw new ToolError(
      "CHECKPOINTS/ is immutable. Use save_checkpoint to create a new checkpoint."
    );
  }

  if (rel === STATE_FILE) {
    if (op === "delete") {
      throw new ToolError("PROJECT_STATE.md cannot be deleted. Edit it instead.");
    }
    if (newContent !== undefined) {
      if (newContent.trim().length === 0) {
        throw new ToolError("Refusing to empty PROJECT_STATE.md.");
      }
      let oldSize = 0;
      try {
        oldSize = (await fs.stat(abs)).size;
      } catch {}
      const newSize = Buffer.byteLength(newContent, "utf8");
      if (oldSize > 200 && newSize < oldSize * 0.5) {
        throw new ToolError(
          `This write would shrink PROJECT_STATE.md from ${oldSize} to ${newSize} bytes. ` +
            `Use str_replace for targeted edits, or read it first and write the full updated version.`
        );
      }
    }
  }
}