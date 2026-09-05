// Tests for src/tools/design.ts. Every test mocks the `Runner` (subprocess
// exec) injection point — no real pen-extract/loc-study checkout is required,
// only a tiny fake extract dir this file creates under the OS temp dir.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

import { assertAllowedPath, countPlaceholderSlices, type ExecResult, type Runner } from "./design-lib.js";
import { extractImpl, contractImpl, contractCheckImpl, measureImpl } from "./design.js";

function ok(stdout = "", stderr = ""): ExecResult {
  return { code: 0, stdout, stderr };
}
function fail(stderr: string, code = 1): ExecResult {
  return { code, stdout: "", stderr };
}

// ---------------------------------------------------------------------------
// assertAllowedPath — path-traversal guard
// ---------------------------------------------------------------------------

test("assertAllowedPath accepts a path under $HOME/wave-av", () => {
  const p = join(homedir(), "wave-av", "some-repo", "board.pen");
  assert.equal(assertAllowedPath(p, "pen"), p);
});

test("assertAllowedPath accepts a path under the OS temp dir", () => {
  const p = join(tmpdir(), "board.pen");
  assert.equal(assertAllowedPath(p, "pen"), p);
});

test("assertAllowedPath rejects a path outside both allowed roots", () => {
  assert.throws(() => assertAllowedPath("/etc/passwd", "pen"), /must resolve inside/);
});

test("assertAllowedPath rejects a relative traversal that escapes to a disallowed root", () => {
  assert.throws(() => assertAllowedPath(join(homedir(), "wave-av", "..", "..", "etc", "passwd"), "pen"), /must resolve inside/);
});

test("assertAllowedPath rejects a sibling directory that merely shares the $HOME/wave-av prefix as a string", () => {
  // e.g. $HOME/wave-avocado should NOT pass just because it starts with the same characters.
  const sneaky = join(homedir(), "wave-avocado", "board.pen");
  assert.throws(() => assertAllowedPath(sneaky, "pen"), /must resolve inside/);
});

// ---------------------------------------------------------------------------
// countPlaceholderSlices
// ---------------------------------------------------------------------------

test("countPlaceholderSlices counts PLACEHOLDER:true marker objects and PLACEHOLDER-prefixed strings", () => {
  const fixture = {
    tokens: { sky: { spring: { default: { PLACEHOLDER: true, reason: "no sibling extract" } } } },
    washi: { name: "PLACEHOLDER", value: "#000000" },
    frames: { og: { path: "PLACEHOLDER — frames/og.png not extracted yet", width: 1200, height: 630 } },
    geometry: { steering: ["a", "b"], occluders: ["c"] },
  };
  assert.equal(countPlaceholderSlices(fixture), 3);
});

test("countPlaceholderSlices returns 0 on a fully grounded object", () => {
  assert.equal(countPlaceholderSlices({ a: 1, b: { c: "real value" } }), 0);
});

// ---------------------------------------------------------------------------
// extractImpl
// ---------------------------------------------------------------------------

test("extractImpl runs pen-extract all and returns the manifest", async () => {
  const dir = mkdtempSync(join(tmpdir(), "design-extract-"));
  const pen = join(dir, "board.pen");
  writeFileSync(pen, "{}");
  const outDir = join(dir, "board.extract");
  mkdirSync(outDir, { recursive: true });

  const runner: Runner = async (args) => {
    assert.ok(args.some((a) => a.endsWith("cli.mjs")));
    assert.ok(args.includes("all"));
    assert.ok(args.includes("--pen"));
    assert.ok(args.includes(pen));
    assert.ok(args.includes("--out"));
    assert.ok(args.includes(outDir));
    // simulate the real CLI writing manifest.json inside --out
    writeFileSync(join(outDir, "manifest.json"), JSON.stringify({ files: [{ path: "tokens.json", sha256: "abc" }], owed: [] }));
    return ok("pen-extract: wrote " + outDir);
  };

  const result = await extractImpl({ pen, out: outDir }, runner);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.out, outDir);
    assert.equal(result.files.length, 1);
    assert.deepEqual(result.owed, []);
  }

  rmSync(dir, { recursive: true, force: true });
});

test("extractImpl surfaces a non-zero exit as a structured error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "design-extract-fail-"));
  const pen = join(dir, "board.pen");
  writeFileSync(pen, "{}");

  const runner: Runner = async () => fail("pen-extract: no such file: board.pen\n");
  const result = await extractImpl({ pen }, runner);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /no such file/);

  rmSync(dir, { recursive: true, force: true });
});

test("extractImpl rejects a pen path outside the allowed roots", async () => {
  await assert.rejects(() => extractImpl({ pen: "/etc/passwd" }, async () => ok()), /must resolve inside/);
});

// ---------------------------------------------------------------------------
// contractImpl / contractCheckImpl
// ---------------------------------------------------------------------------

const FAKE_CONTRACT = {
  meta: { boardId: "spring-register" },
  geometry: { steering: ["t1", "t2", "t3"], occluders: ["c1"] },
  acceptanceTests: ["a1", "a2"],
  tokens: { washi: { name: "PLACEHOLDER", value: "#000000" } },
};

test("contractImpl composes then validates, returning counts and the validator line", async () => {
  const dir = mkdtempSync(join(tmpdir(), "design-contract-"));

  const runner: Runner = async (args) => {
    if (args.includes("contract")) {
      const outIdx = args.indexOf("--out");
      writeFileSync(args[outIdx + 1]!, JSON.stringify(FAKE_CONTRACT));
      return ok("pen-extract: wrote " + args[outIdx + 1]);
    }
    // validate.mjs call
    return ok("VALID: design-contract.json conforms to design-contract.schema.json\n  acceptanceTests: 2 id(s)");
  };

  const result = await contractImpl({ extract: dir }, runner);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.valid, true);
    assert.match(result.validatorLine, /^VALID:/);
    assert.deepEqual(result.counts, { steering: 3, occluders: 1, acceptanceTests: 2, placeholderSlices: 1 });
    assert.equal(result.path, join(dir, "design-contract.json"));
  }

  rmSync(dir, { recursive: true, force: true });
});

test("contractImpl reports an invalid contract via the validator's stderr line", async () => {
  const dir = mkdtempSync(join(tmpdir(), "design-contract-invalid-"));
  const runner: Runner = async (args) => {
    if (args.includes("contract")) {
      const outIdx = args.indexOf("--out");
      writeFileSync(args[outIdx + 1]!, JSON.stringify(FAKE_CONTRACT));
      return ok();
    }
    return fail("INVALID: 1 error(s) found. First 1:\n  $.meta: missing required property \"penSha256\"", 1);
  };

  const result = await contractImpl({ extract: dir }, runner);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.valid, false);
    assert.match(result.validatorLine, /^INVALID:/);
  }

  rmSync(dir, { recursive: true, force: true });
});

test("contractCheckImpl validates only, no compose call", async () => {
  const dir = mkdtempSync(join(tmpdir(), "design-contract-check-"));
  const contractPath = join(dir, "design-contract.json");
  writeFileSync(contractPath, JSON.stringify(FAKE_CONTRACT));

  let calls = 0;
  const runner: Runner = async () => {
    calls++;
    return ok("VALID: ok");
  };

  const result = await contractCheckImpl({ contract: contractPath }, runner);
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.valid, true);
  assert.equal(result.validatorLine, "VALID: ok");

  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// measureImpl
// ---------------------------------------------------------------------------

test("measureImpl runs loc-study measure and parses stdout JSON", async () => {
  const dir = mkdtempSync(join(tmpdir(), "design-measure-"));
  const image = join(dir, "print.jpg");
  writeFileSync(image, "");
  const geometry = join(dir, "geometry.json");
  writeFileSync(geometry, "{}");

  const runner: Runner = async (args) => {
    assert.ok(args.some((a) => a.endsWith("loc-study.mjs")));
    assert.ok(args.includes("measure"));
    assert.ok(args.includes(image));
    assert.ok(args.includes("--from-geometry"));
    assert.ok(args.includes(geometry));
    return ok(JSON.stringify({ id: "print", bokashi: { stopCount: 4 } }));
  };

  const result = await measureImpl({ image, geometry }, runner);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.measurement, { id: "print", bokashi: { stopCount: 4 } });

  rmSync(dir, { recursive: true, force: true });
});

test("measureImpl requires image or plate", async () => {
  const result = await measureImpl({}, async () => ok("{}"));
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /one of `image` or `plate`/);
});

test("measureImpl surfaces non-JSON stdout as a structured error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "design-measure-badjson-"));
  const image = join(dir, "print.jpg");
  writeFileSync(image, "");
  const runner: Runner = async () => ok("not json");
  const result = await measureImpl({ image }, runner);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /did not return valid JSON/);
  rmSync(dir, { recursive: true, force: true });
});
