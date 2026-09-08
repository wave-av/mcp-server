// `wave_compose` — the registered successor to `wave.ask`, and this repo's
// first tool that ever calls the live WAVE gateway on behalf of the composer.
//
// Contract (mcp-server PR4-MCP, per the front-door design brief §3d — an
// internal design doc, NOT part of this checkout; cited for provenance
// only): when `WAVE_API_KEY` is configured, this tool calls
// the live `POST /v1/compose` gateway route and returns its answer as-is
// (with `grounding: "gateway"` set on the returned object) once it passes a
// minimum shape check — `productIds[]` and `tools[]` present as arrays and
// `executes` never truthy — so an answer that could not be a composition
// falls back rather than reaching the agent. When no key is configured, or
// the gateway call fails, errors, answers with a body past the size ceiling,
// or does not answer within 3 seconds, this tool falls back to the same
// deterministic, offline `compose()` this package already ships for
// `wave.ask` (see ./compose.ts), tagged `grounding: "snapshot"` and carrying
// a fixed `fallbackReason` — so an agent calling this tool NEVER gets a dead
// end, only a lower-grounding answer it can SEE is lower-grounding.
//
// The gateway route this tool calls (`POST /v1/compose` on the public WAVE
// API surface) answers `501 NOT_IMPLEMENTED` as of this writing, so in
// practice every call today falls through to the offline path; the gateway
// branch is written and tested now so this tool needs no further change once
// that route goes live.
//
// Security posture, matching ../../auth.ts's existing guarantees:
//  - The request target is always `getBaseUrl()` (the one configured/validated
//    WAVE gateway origin — https-only for any non-loopback host) + the fixed
//    literal path `/v1/compose`. It is never derived from the caller's
//    `intent`/`budgetUsd` input in any way, so there is no SSRF surface here.
//  - The API key reaches exactly one place: the `Authorization` header on
//    that one request, via the existing `getAuthHeaders()` helper. It is
//    never logged, never echoed into the tool's returned content, and never
//    appears in an error message on any failure path below (every failure
//    collapses to an offline fallback plus a fixed reason string, not a
//    surfaced network error). On the success path the returned object is
//    scrubbed of the key before it is handed back, so even a compromised
//    responder cannot reflect it into the agent's transcript.
//  - `redirect: "error"` — a redirect would re-issue this POST, bearer token
//    and all, at an origin the responder chose. One POST, or nothing.
import { z } from "zod";
import { compose } from "./compose.js";
import { defineTool, textContent, type WaveToolDef } from "../shared.js";
import { getAuthHeaders, getBaseUrl } from "../../auth.js";

/** Gateway `POST /v1/compose` must answer within this window or the offline snapshot wins. */
const COMPOSE_TIMEOUT_MS = 3000;

/**
 * Hard ceiling on the gateway response body this tool will buffer. A compose proposal is a few
 * kilobytes; anything past this is a misbehaving or hostile responder, and reading it whole would
 * let one response grow this process's memory without bound. Over the ceiling ⇒ snapshot fallback.
 */
const MAX_COMPOSE_BODY_BYTES = 256 * 1024;

/** The gateway's response, opaque here — this tool returns it as-is (plus `grounding`). */
type GatewayComposeResult = Record<string, unknown>;

/**
 * Why a live call did not produce the answer. Surfaced (only these fixed strings — never a raw
 * error message, URL, header or body fragment) as `fallbackReason` on the snapshot result, so an
 * agent or operator can tell a real outage from "no key configured" instead of seeing a silently
 * degraded answer.
 */
type FallbackReason =
  | "gateway-http-error"
  | "gateway-empty-body"
  | "gateway-body-too-large"
  | "gateway-invalid-json"
  | "gateway-unexpected-shape"
  | "gateway-unreachable-or-timeout";

type GatewayOutcome = { ok: true; value: GatewayComposeResult } | { ok: false; reason: FallbackReason };

/**
 * Read at most `MAX_COMPOSE_BODY_BYTES` of a response body, then stop and discard the rest.
 * Returns `undefined` when the body is longer than the ceiling (declared or measured).
 */
async function readBodyCapped(res: Response): Promise<string | undefined> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_COMPOSE_BODY_BYTES) {
    await discardBody(res);
    return undefined;
  }
  const stream = res.body;
  if (stream === null) return "";

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    total += value.byteLength;
    if (total > MAX_COMPOSE_BODY_BYTES) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

/**
 * Drain-and-drop a response we are not going to read. Leaving a body unconsumed on an error path
 * keeps the underlying connection out of the pool, so a gateway stuck on 5xx would otherwise cost
 * one socket per attempt.
 */
async function discardBody(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // Nothing to do — the body is already gone, which is the outcome we wanted.
  }
}

/**
 * The minimum shape a gateway answer must have before this tool will hand it to an agent as a
 * composition. The gateway owns the full contract; this only refuses answers that could not
 * possibly be one — so a 2xx JSON object with no products, no tools, or a truthy `executes` falls
 * back to the grounded snapshot instead of passing an unusable (or unsafe) proposal through.
 */
function isPlausibleProposal(value: Record<string, unknown>): boolean {
  if (!Array.isArray(value["productIds"])) return false;
  if (!Array.isArray(value["tools"])) return false;
  if (value["executes"] !== undefined && value["executes"] !== false) return false;
  return true;
}

/** Nesting past this is not a composition — no real proposal is 64 objects deep. */
const MAX_REDACT_DEPTH = 64;

/** Thrown by `redactApiKey` past `MAX_REDACT_DEPTH`; caught at the one call site. */
class TooDeepError extends Error {}

/**
 * Enforce the documented no-echo guarantee on the success path too: if a gateway response ever
 * carried the configured key back (a compromised or misconfigured responder), it is replaced
 * before the object reaches the agent's transcript. Structure is preserved exactly otherwise.
 */
function redactApiKey(value: unknown, key: string, depth = 0): unknown {
  // A valid-but-pathological body ([[[[…]]]]) would otherwise recurse until the stack gives out.
  // Past the ceiling this is not a composition worth returning, so the caller falls back instead.
  if (depth > MAX_REDACT_DEPTH) throw new TooDeepError();
  if (typeof value === "string") return value.includes(key) ? value.split(key).join("[redacted]") : value;
  if (Array.isArray(value)) return value.map((entry) => redactApiKey(entry, key, depth + 1));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactApiKey(v, key, depth + 1);
    return out;
  }
  return value;
}

/** `redactApiKey`, but `undefined` instead of a throw when the body is nested past the ceiling. */
function redactSafely(value: GatewayComposeResult, key: string): GatewayComposeResult | undefined {
  try {
    return redactApiKey(value, key) as GatewayComposeResult;
  } catch (err) {
    if (err instanceof TooDeepError) return undefined;
    throw err;
  }
}

/**
 * Call the live gateway compose route. Never throws, and never lets a caught error's message
 * (which could, in principle, echo request details) escape this function — every failure collapses
 * to one of the fixed `FallbackReason` strings so the caller has exactly two branches: use this
 * answer, or fall back to the snapshot and say why.
 */
async function callGatewayCompose(
  intent: string,
  budgetUsd: number | undefined,
): Promise<GatewayOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COMPOSE_TIMEOUT_MS);
  try {
    const body: Record<string, unknown> = { intent };
    if (typeof budgetUsd === "number") body.budgetUsd = budgetUsd;

    const res = await fetch(`${getBaseUrl()}/v1/compose`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
      // A redirect would re-issue this POST — with the bearer token — at whatever origin the
      // responder names. One POST to the validated origin, or nothing.
      redirect: "error",
    });
    if (!res.ok) {
      await discardBody(res);
      return { ok: false, reason: "gateway-http-error" };
    }

    const text = await readBodyCapped(res);
    if (text === undefined) return { ok: false, reason: "gateway-body-too-large" };
    // A 2xx with no body at all is a distinct failure from malformed JSON, and worth saying so.
    if (text.trim() === "") return { ok: false, reason: "gateway-empty-body" };

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, reason: "gateway-invalid-json" };
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, reason: "gateway-unexpected-shape" };
    }
    const candidate = parsed as GatewayComposeResult;
    if (!isPlausibleProposal(candidate)) return { ok: false, reason: "gateway-unexpected-shape" };
    return { ok: true, value: candidate };
  } catch {
    // Deliberately swallowed: a timeout/abort and a network error mean the same thing to the
    // caller — "no live answer, use the offline snapshot" — and neither may surface an error
    // that could carry request/response details.
    return { ok: false, reason: "gateway-unreachable-or-timeout" };
  } finally {
    clearTimeout(timer);
  }
}

export const waveComposeTools: WaveToolDef[] = [
  defineTool({
    name: "wave_compose",
    description:
      "Propose a WAVE flow (product + MCP tool + price shape) for a media-processing goal stated in " +
      "plain language (captions/clips/dub/realtime/identity/x402/...). When a WAVE_API_KEY is " +
      "configured, calls the live `POST /v1/compose` gateway route and returns its answer as-is " +
      "(`grounding: \"gateway\"`). When no key is configured, or the gateway call fails, errors, or " +
      "does not answer within 3 seconds, falls back to a bundled, measured snapshot composition " +
      "(`grounding: \"snapshot\"`) so you never get a dead end. Never executes: calls no other tool, " +
      "signs no payment, and makes no other side-effecting request. This is the registered successor " +
      "to `wave.ask`, which is deprecated and kept only as an offline-only alias for one release. " +
      "See skills/wave-ask/SKILL.md for the full contract.",
    inputSchema: {
      intent: z
        .string()
        .trim()
        .min(1, "intent must not be empty")
        .max(280, "intent must be 280 characters or fewer")
        .describe(
          "The goal in plain language (e.g. \"live captions from my mic\"). Treated as untrusted text: " +
            "never echoed into a system-prompt-adjacent field, never used to construct a URL or tool call " +
            "directly, and never any part of the outbound request target — it only selects among a " +
            "fixed, pre-grounded set of compositions (or is forwarded, unmodified, as the gateway " +
            "request's `intent` field when a live call is made).",
        ),
      budgetUsd: z
        .number()
        .finite()
        .nonnegative()
        .optional()
        .describe(
          "Optional USD budget ceiling. Forwarded to the gateway on a live call; in the offline " +
            "fallback it never computes or invents a price — only reorders which suggestion in `next[]` " +
            "is surfaced first (a reminder to confirm the live 402 quote against it before calling).",
        ),
    },
    handler: async ({ intent, budgetUsd }) => {
      const apiKey = process.env["WAVE_API_KEY"];
      let fallbackReason: FallbackReason | undefined;
      if (apiKey) {
        const outcome = await callGatewayCompose(intent, budgetUsd);
        if (outcome.ok) {
          const answer = redactSafely(outcome.value, apiKey);
          if (answer !== undefined) {
            return textContent(JSON.stringify({ ...answer, grounding: "gateway" }));
          }
          // Nested past anything a proposal could be — treat it as the unusable shape it is.
          fallbackReason = "gateway-unexpected-shape";
        } else {
          fallbackReason = outcome.reason;
        }
        // A configured key that produced no live answer is an outage, not a normal offline run:
        // say so on stderr (never stdout, which carries the MCP protocol) with the fixed reason
        // string only — no URL, no header, no response body.
        process.stderr.write(
          `[wave-mcp-server] wave_compose: live compose unavailable (${fallbackReason}) — answering from the offline snapshot\n`,
        );
      }
      const proposal = compose(intent, budgetUsd);
      return textContent(
        JSON.stringify({
          ...proposal,
          grounding: "snapshot",
          ...(fallbackReason === undefined ? {} : { fallbackReason }),
        }),
      );
    },
  }),
];
