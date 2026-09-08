// Design tools — thin MCP wrappers over the design-to-engineer pipeline's two
// standalone libraries: `@wave-av/pen-extract` (mechanical .pen extraction +
// contract composition) and `@wave-av/loc-study` (ukiyo-e print measurement).
// Root resolution, the path-traversal guard, the injectable subprocess
// runner, and placeholder-slice counting live in ./design-lib.js.
//
// Every tool shells out to the library's own CLI (`node <root>/src/cli.mjs`,
// `node <root>/bin/loc-study.mjs`) via `execFile` rather than importing the
// ESM source directly — the CLIs are the libraries' own supported entry
// points (own process.exit / argv handling), so this is the same boundary
// the libraries themselves draw between "pure library" and "CLI". Every path
// argument is checked against `assertAllowedPath` first (confined to
// `$HOME/wave-av` and the OS temp dir) so a tool call can never read or write
// outside those roots.
import { mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { z } from "zod";
import { defineTool, textContent, type WaveToolDef } from "./shared.js";
import {
  assertAllowedPath,
  countPlaceholderSlices,
  firstLine,
  locStudyRoot,
  penExtractRoot,
  penRegisterRepoRoot,
  runNode,
  type Runner,
} from "./design-lib.js";

// ---------------------------------------------------------------------------
// wave_design_extract — runs pen-extract's `all` subcommand and returns the
// written manifest.json (files, sha256s, owed).
// ---------------------------------------------------------------------------

function defaultExtractOutDir(pen: string): string {
  const dir = dirname(pen);
  const base = basename(pen, extname(pen));
  return join(dir, `${base}.extract`);
}

export interface ExtractInput {
  pen: string;
  out?: string;
  delta?: string;
}

export type ExtractResult =
  | {
      ok: true;
      out: string;
      manifestPath: string;
      files: Array<{ path: string; sha256: string; bytes?: number }>;
      owed: string[];
    }
  | { ok: false; error: string; stderr: string };

export async function extractImpl(input: ExtractInput, runner: Runner = runNode): Promise<ExtractResult> {
  const pen = assertAllowedPath(input.pen, "pen");
  const outDir = assertAllowedPath(input.out ?? defaultExtractOutDir(pen), "out");
  const delta = input.delta ? assertAllowedPath(input.delta, "delta") : undefined;

  const root = penExtractRoot();
  const cli = join(root, "src", "cli.mjs");
  const args = [cli, "all", "--pen", pen, "--out", outDir];
  if (delta) args.push("--delta", delta);

  const result = await runner(args);
  if (result.code !== 0) {
    return {
      ok: false,
      error: result.spawnError
        ? `pen-extract failed to run: ${result.spawnError}`
        : firstLine(result.stderr) || `pen-extract exited ${result.code}`,
      stderr: result.stderr,
    };
  }

  const manifestPath = join(outDir, "manifest.json");
  let manifest: { files?: Array<{ path: string; sha256: string; bytes?: number }>; owed?: string[] };
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as typeof manifest;
  } catch (err) {
    return {
      ok: false,
      error: `pen-extract exited 0 but ${manifestPath} could not be read/parsed: ${(err as Error).message}`,
      stderr: result.stderr,
    };
  }

  return {
    ok: true,
    out: outDir,
    manifestPath,
    files: manifest.files ?? [],
    owed: manifest.owed ?? [],
  };
}

// ---------------------------------------------------------------------------
// wave_design_contract — composes + validates a design-contract.json via
// pen-extract's `contract` subcommand, then designs/contract/validate.mjs.
// ---------------------------------------------------------------------------

export interface ContractInput {
  extract: string;
  out?: string;
}

export type ContractResult =
  | {
      ok: true;
      valid: boolean;
      validatorLine: string;
      counts: { steering: number; occluders: number; acceptanceTests: number; placeholderSlices: number };
      path: string;
    }
  | { ok: false; error: string; stderr: string };

export async function contractImpl(input: ContractInput, runner: Runner = runNode): Promise<ContractResult> {
  const extractDir = assertAllowedPath(input.extract, "extract");
  const outFile = assertAllowedPath(input.out ?? join(extractDir, "design-contract.json"), "out");

  const root = penExtractRoot();
  const repoRoot = penRegisterRepoRoot();
  const cli = join(root, "src", "cli.mjs");
  const schemaPath = join(repoRoot, "designs", "contract", "design-contract.schema.json");
  const catalogPath = join(repoRoot, "designs", "contract", "acceptance-tests.json");

  mkdirSync(dirname(outFile), { recursive: true });
  const compose = await runner([cli, "contract", "--extract", extractDir, "--out", outFile]);
  if (compose.code !== 0) {
    return {
      ok: false,
      error: compose.spawnError
        ? `pen-extract contract failed to run: ${compose.spawnError}`
        : firstLine(compose.stderr) || `pen-extract contract exited ${compose.code}`,
      stderr: compose.stderr,
    };
  }

  let contract: { geometry?: { steering?: unknown[]; occluders?: unknown[] }; acceptanceTests?: unknown[] };
  try {
    contract = JSON.parse(readFileSync(outFile, "utf8")) as typeof contract;
  } catch (err) {
    return {
      ok: false,
      error: `pen-extract contract exited 0 but ${outFile} could not be read/parsed: ${(err as Error).message}`,
      stderr: compose.stderr,
    };
  }

  const validatorScript = join(repoRoot, "designs", "contract", "validate.mjs");
  const validation = await runner([validatorScript, outFile, schemaPath, catalogPath]);
  if (validation.spawnError) {
    return {
      ok: false,
      error: `design-contract validator failed to run: ${validation.spawnError}`,
      stderr: validation.stderr,
    };
  }
  const validatorLine = validation.code === 0 ? firstLine(validation.stdout) : firstLine(validation.stderr);

  return {
    ok: true,
    valid: validation.code === 0,
    validatorLine,
    counts: {
      steering: contract.geometry?.steering?.length ?? 0,
      occluders: contract.geometry?.occluders?.length ?? 0,
      acceptanceTests: contract.acceptanceTests?.length ?? 0,
      placeholderSlices: countPlaceholderSlices(contract),
    },
    path: outFile,
  };
}

// ---------------------------------------------------------------------------
// wave_design_contract_check — validate only, no compose.
// ---------------------------------------------------------------------------

export interface ContractCheckInput {
  contract: string;
}

export type ContractCheckResult =
  | { ok: true; valid: boolean; validatorLine: string; path: string }
  | { ok: false; error: string; stderr: string };

export async function contractCheckImpl(
  input: ContractCheckInput,
  runner: Runner = runNode,
): Promise<ContractCheckResult> {
  const contractPath = assertAllowedPath(input.contract, "contract");
  const repoRoot = penRegisterRepoRoot();
  const schemaPath = join(repoRoot, "designs", "contract", "design-contract.schema.json");
  const catalogPath = join(repoRoot, "designs", "contract", "acceptance-tests.json");
  const validatorScript = join(repoRoot, "designs", "contract", "validate.mjs");

  const validation = await runner([validatorScript, contractPath, schemaPath, catalogPath]);
  if (validation.spawnError) {
    return {
      ok: false,
      error: `design-contract validator failed to run: ${validation.spawnError}`,
      stderr: validation.stderr,
    };
  }
  const validatorLine = validation.code === 0 ? firstLine(validation.stdout) : firstLine(validation.stderr);

  return { ok: true, valid: validation.code === 0, validatorLine, path: contractPath };
}

// ---------------------------------------------------------------------------
// wave_design_measure — loc-study `measure`, masked when geometry is given.
// ---------------------------------------------------------------------------

export interface MeasureInput {
  image?: string;
  geometry?: string;
  plate?: string;
  region?: string;
}

export type MeasureResult = { ok: true; measurement: unknown } | { ok: false; error: string; stderr?: string; stdout?: string };

export async function measureImpl(input: MeasureInput, runner: Runner = runNode): Promise<MeasureResult> {
  if (!input.image && !input.plate) {
    return { ok: false, error: "wave_design_measure: one of `image` or `plate` is required" };
  }

  const root = locStudyRoot();
  const bin = join(root, "bin", "loc-study.mjs");
  const args = [bin, "measure"];

  if (input.plate) {
    args.push("--plate", assertAllowedPath(input.plate, "plate"));
  } else if (input.image) {
    args.push(assertAllowedPath(input.image, "image"));
  }
  if (input.geometry) args.push("--from-geometry", assertAllowedPath(input.geometry, "geometry"));
  if (input.region) args.push("--region", input.region);

  const result = await runner(args);
  if (result.code !== 0) {
    return { ok: false, error: firstLine(result.stderr) || `loc-study exited ${result.code}`, stderr: result.stderr };
  }

  try {
    return { ok: true, measurement: JSON.parse(result.stdout) };
  } catch {
    return { ok: false, error: "loc-study measure did not return valid JSON on stdout", stdout: result.stdout };
  }
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export const designTools: WaveToolDef[] = [
  defineTool({
    name: "wave_design_extract",
    description:
      "Run @wave-av/pen-extract's `all` extraction pipeline on a .pen board (plates/tokens/geometry/copy/" +
      "components/receipts/frames/manifest). Returns the manifest.json (files, sha256s, owed).",
    inputSchema: {
      pen: z.string().min(1).describe("Path to the .pen board file (must be under $HOME/wave-av or the OS temp dir)"),
      out: z.string().min(1).optional().describe("Output extract dir (default: <pen-dir>/<basename>.extract)"),
      delta: z
        .string()
        .min(1)
        .optional()
        .describe("Reference board's already-extracted dir; writes season-delta.json into this run's --out"),
    },
    handler: async ({ pen, out, delta }) => {
      const result = await extractImpl({ pen, out, delta });
      return textContent(JSON.stringify(result, null, 2));
    },
  }),

  defineTool({
    name: "wave_design_contract",
    description:
      "Compose a design-contract.json from an already-extracted pen-extract dir, then validate it against " +
      "the schema + acceptance-tests catalogue. Returns the validator line, key counts, and the written path.",
    inputSchema: {
      extract: z.string().min(1).describe("Path to a <board>.extract/ dir written by wave_design_extract"),
      out: z.string().min(1).optional().describe("Output contract file (default: <extract>/design-contract.json)"),
    },
    handler: async ({ extract, out }) => {
      const result = await contractImpl({ extract, out });
      return textContent(JSON.stringify(result, null, 2));
    },
  }),

  defineTool({
    name: "wave_design_measure",
    description:
      "Run @wave-av/loc-study's `measure` on an image (masked by geometry.json when given) or a rasterized " +
      "plate SVG, optionally cropped to a region. Returns the measurement JSON (bokashi/keyblock/palette/composition).",
    inputSchema: {
      image: z.string().min(1).optional().describe("Path to the image to measure (required unless `plate` is given)"),
      geometry: z
        .string()
        .min(1)
        .optional()
        .describe("pen-extract geometry.json — masks occluder rects out of the measurement"),
      plate: z.string().min(1).optional().describe("Path to a plate SVG to rasterize and measure keyblock on"),
      region: z.string().min(1).optional().describe("Crop region as `x,y,w,h` (fractions or pixels)"),
    },
    handler: async ({ image, geometry, plate, region }) => {
      const result = await measureImpl({ image, geometry, plate, region });
      return textContent(JSON.stringify(result, null, 2));
    },
  }),

  defineTool({
    name: "wave_design_contract_check",
    description: "Validate an existing design-contract.json against the schema + acceptance-tests catalogue, no compose.",
    inputSchema: {
      contract: z.string().min(1).describe("Path to a design-contract.json"),
    },
    handler: async ({ contract }) => {
      const result = await contractCheckImpl({ contract });
      return textContent(JSON.stringify(result, null, 2));
    },
  }),
];
