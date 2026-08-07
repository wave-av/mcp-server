// Regression test for wave-av/mcp-server#91: every tool call 404'd against
// prod because the default base URL pointed at the marketing site
// (https://wave.online) instead of the gateway (https://api.wave.online).
//
// See src/tools/regression-91.test.ts for the end-to-end proof across all 18
// tools + 2 resources. This file covers the narrower unit: getBaseUrl()'s
// default and env-override behavior.
import { test } from "node:test";
import assert from "node:assert/strict";

const ORIGINAL_BASE_URL = process.env["WAVE_BASE_URL"];
const ORIGINAL_API_KEY = process.env["WAVE_API_KEY"];

test.afterEach(() => {
  if (ORIGINAL_BASE_URL === undefined) delete process.env["WAVE_BASE_URL"];
  else process.env["WAVE_BASE_URL"] = ORIGINAL_BASE_URL;
  if (ORIGINAL_API_KEY === undefined) delete process.env["WAVE_API_KEY"];
  else process.env["WAVE_API_KEY"] = ORIGINAL_API_KEY;
});

test("getBaseUrl() defaults to the gateway (api.wave.online), not the marketing site", async () => {
  delete process.env["WAVE_BASE_URL"];
  const { getBaseUrl } = await import("./auth.js");
  assert.equal(getBaseUrl(), "https://api.wave.online");
  assert.notEqual(
    getBaseUrl(),
    "https://wave.online",
    "wave.online is the Next.js marketing site — it 404s on /v1/* and /api/v1/* (issue #91)",
  );
});

test("getBaseUrl() still honors an explicit WAVE_BASE_URL override", async () => {
  process.env["WAVE_BASE_URL"] = "https://staging.wave.online";
  const { getBaseUrl } = await import("./auth.js");
  assert.equal(getBaseUrl(), "https://staging.wave.online");
});

test("getApiKey() throws an actionable error when WAVE_API_KEY is unset", async () => {
  delete process.env["WAVE_API_KEY"];
  const { getApiKey } = await import("./auth.js");
  assert.throws(() => getApiKey(), /WAVE_API_KEY environment variable is required/);
});
