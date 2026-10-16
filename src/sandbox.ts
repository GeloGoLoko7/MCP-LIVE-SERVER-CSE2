import fs from "node:fs/promises";
import path from "node:path";

export const WORKSPACE_ROOT = path.resolve(
  process.env.WORKSPACE_ROOT ?? path.join(process.cwd(), "workspace")
);

export const MAX_FILE_BYTES = 1_000_000; // refuse to read files bigger than this
export const MAX_WRITE_BYTES = 1_000_000; // refuse to write more than this
export const MAX_OUTPUT_CHARS = 20_000; // cap what we send back to the agent

// An error whose message is safe and useful to show the agent
export class ToolError extends Error {}

function isInside(root: string, target: string) {
  return target === root || target.startsWith(root + path.sep);
}

export async function resolveSafe(
  userPath: string,
  root: string = WORKSPACE_ROOT
): Promise<string> {
  if (typeof userPath !== "string") throw new ToolError("Path must be a string.");
  if (userPath.includes("\0")) throw new ToolError("Path contains a null byte.");
  if (path.isAbsolute(userPath) || /^[a-zA-Z]:/.test(userPath)) {
    throw new ToolError("Absolute paths are not allowed. Use a path relative to the workspace.");
  }

  const realRoot = await fs.realpath(root);
  const lexical = path.resolve(realRoot, userPath);
  if (!isInside(realRoot, lexical)) {
    throw new ToolError("Path escapes the workspace.");
  }

  // Walk up to the deepest part that exists, resolve symlinks there,
  // then re-attach the parts that don't exist yet (for new files).
  let current = lexical;
  const tail: string[] = [];
  while (true) {
    try {
      const real = await fs.realpath(current);
      const final = path.join(real, ...tail.reverse());
      if (!isInside(realRoot, final)) {
        throw new ToolError("Path escapes the workspace (symlink).");
      }
      const rel = path.relative(realRoot, final);
      if (rel.split(path.sep).includes(".git")) {
        throw new ToolError("Access to .git is not allowed. Use the git tools.");
      }
      return final;

    } catch (err: any) {
      if (err instanceof ToolError) throw err;
      if (err?.code !== "ENOENT") throw err;
      // A dangling symlink looks like "doesn't exist" but could point outside
      try {
        await fs.lstat(current);
        throw new ToolError("Path is a broken symlink.");
      } catch (e: any) {
        if (e instanceof ToolError) throw e;
      }
      const parent = path.dirname(current);
      if (parent === current) throw new ToolError("Path could not be resolved.");
      tail.push(path.basename(current));
      current = parent;
    }
  }
}