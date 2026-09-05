// Shared plumbing for the design tools (src/tools/design.ts): $HOME-first
// library-root resolution with env overrides, the path-traversal guard, the
// injectable subprocess runner, and placeholder-slice counting. Split out of
// design.ts to keep both files under the repo's file-size gate.
//
// Neither `@wave-av/pen-extract` nor `@wave-av/loc-study` is published to
// npm (see designs/DESIGN-TO-ENGINEER-SYSTEM.md stage E2 in wave-pen-register).
// Both are resolved from disk, $HOME-first per the cross-repo path law: an
// env override (WAVE_PEN_EXTRACT_ROOT / WAVE_LOC_STUDY_ROOT) wins, else
// `$HOME/wave-av/<repo>/<path>` — never a relative `../../` off this
// checkout, which resolves to the wrong tree (or nothing) from a worktree.
// A missing root fails loudly, naming the env var to set.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { resolve as resolvePath, sep } from "node:path";

function homeRoot(): string {
  return process.env["HOME"] && process.env["HOME"]!.length > 0 ? process.env["HOME"]! : homedir();
}

function resolveLibraryRoot(envVar: string, relPath: string, label: string): string {
  const override = process.env[envVar];
  const root = override && override.length > 0 ? resolvePath(override) : resolvePath(homeRoot(), relPath);
  if (!existsSync(root)) {
    throw new Error(
      `${label} not found at ${root} — it is not published to npm, so this MCP server reads it from a ` +
        `sibling checkout. Set ${envVar} to its root, or check out the repo at that path.`,
    );
  }
  return root;
}

/** Root of `@wave-av/pen-extract` (packages/pen-extract inside wave-pen-register-wt). */
export function penExtractRoot(): string {
  return resolveLibraryRoot(
    "WAVE_PEN_EXTRACT_ROOT",
    "wave-av/wave-pen-register-wt/packages/pen-extract",
    "@wave-av/pen-extract",
  );
}

/** Root of `@wave-av/loc-study` (tools/loc-study inside wave-design-study-wt). */
export function locStudyRoot(): string {
  return resolveLibraryRoot(
    "WAVE_LOC_STUDY_ROOT",
    "wave-av/wave-design-study-wt/tools/loc-study",
    "@wave-av/loc-study",
  );
}

/** `packages/pen-extract`'s own repo root (two dirs up) — where designs/contract/ lives. */
export function penRegisterRepoRoot(): string {
  return resolvePath(penExtractRoot(), "..", "..");
}

// ---------------------------------------------------------------------------
// Path-traversal guard — every path argument must resolve inside $HOME/wave-av
// or the OS temp dir. Never a relative-path allowance; always the resolved
// absolute path is checked and returned.
// ---------------------------------------------------------------------------

export function assertAllowedPath(inputPath: string, label: string): string {
  const abs = resolvePath(inputPath);
  const allowedRoots = [resolvePath(homeRoot(), "wave-av"), resolvePath(tmpdir())];
  const within = allowedRoots.some((root) => abs === root || abs.startsWith(root + sep));
  if (!within) {
    throw new Error(
      `${label} must resolve inside $HOME/wave-av or the OS temp dir; got ${abs} ` +
        `(allowed roots: ${allowedRoots.join(", ")})`,
    );
  }
  return abs;
}

// ---------------------------------------------------------------------------
// Subprocess runner — injectable so tests can mock it with no real fixtures
// beyond a tiny fake extract dir.
// ---------------------------------------------------------------------------

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Runner = (scriptArgs: string[], opts?: { cwd?: string }) => Promise<ExecResult>;

export const runNode: Runner = (scriptArgs, opts) =>
  new Promise((resolveExec) => {
    execFile(
      process.execPath,
      scriptArgs,
      { cwd: opts?.cwd, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error
          ? typeof (error as NodeJS.ErrnoException).code === "number"
            ? (error as unknown as { code: number }).code
            : 1
          : 0;
        resolveExec({ code, stdout: stdout ?? "", stderr: stderr ?? "" });
      },
    );
  });

export function firstLine(text: string): string {
  return text.split("\n").find((l) => l.trim().length > 0) ?? "";
}

// ---------------------------------------------------------------------------
// Placeholder-slice counting — pen-extract's contract composer marks any
// value it cannot ground yet with `{ PLACEHOLDER: true, reason }` or a string
// starting with "PLACEHOLDER" (see packages/pen-extract/src/contract.mjs).
// This is a pure structural count, no knowledge of the schema required.
// ---------------------------------------------------------------------------

export function countPlaceholderSlices(value: unknown): number {
  let count = 0;
  const seen = new WeakSet<object>();

  function walk(v: unknown): void {
    if (v === null || typeof v !== "object") {
      if (typeof v === "string" && v.startsWith("PLACEHOLDER")) count++;
      return;
    }
    if (seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    const record = v as Record<string, unknown>;
    if (record["PLACEHOLDER"] === true) {
      count++;
      return;
    }
    for (const val of Object.values(record)) walk(val);
  }

  walk(value);
  return count;
}
