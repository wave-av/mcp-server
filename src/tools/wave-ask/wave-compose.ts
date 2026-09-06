// `wave_compose` — the registered successor to `wave.ask`, and this repo's
// first tool that ever calls the live WAVE gateway on behalf of the composer.
//
// Contract (mcp-server PR4-MCP, per designs/front-door/PR4-BRIEF.md §3d in
// wave-pen-register-wt — that design doc is NOT part of this checkout; cited
// for provenance only): when `WAVE_API_KEY` is configured, this tool calls
// the live `POST /v1/compose` gateway route and returns its answer verbatim
// (with `grounding: "gateway"` set on the returned object). When no key is
// configured, or the gateway call fails, errors, or does not answer within
// 3 seconds, this tool falls back to the same deterministic, offline
// `compose()` this package already ships for `wave.ask` (see ./compose.ts),
// tagged `grounding: "snapshot"` — so an agent calling this tool NEVER gets a
// dead end, only a lower-grounding answer.
//
// The gateway route this tool calls is a stub returning `501 NOT_IMPLEMENTED`
// as of this writing (wave-gateway PR #1649, `src/compose-route.ts`), so in
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
//    collapses to the same offline fallback, not a surfaced network error).
import { z } from "zod";
import { compose } from "./compose.js";
import { defineTool, textContent, type WaveToolDef } from "../shared.js";
import { getAuthHeaders, getBaseUrl } from "../../auth.js";

/** Gateway `POST /v1/compose` must answer within this window or the offline snapshot wins. */
const COMPOSE_TIMEOUT_MS = 3000;

/** The gateway's response, opaque here — this tool returns it as-is (plus `grounding`). */
type GatewayComposeResult = Record<string, unknown>;

/**
 * Call the live gateway compose route. Returns `undefined` on ANY failure —
 * non-2xx status, network error, timeout/abort, or a body that doesn't parse
 * as a JSON object — so the caller has one branch to handle: use this result,
 * or fall back. Never throws, and never lets a caught error's message (which
 * could, in principle, echo request details) escape this function.
 */
async function callGatewayCompose(
  intent: string,
  budgetUsd: number | undefined,
): Promise<GatewayComposeResult | undefined> {
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
    });
    if (!res.ok) return undefined;

    const text = await res.text();
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return parsed as GatewayComposeResult;
  } catch {
    // Deliberately swallowed: a timeout/abort, a network error, and a JSON parse failure all
    // land here, and all three mean the same thing to the caller — "no live answer, use the
    // offline snapshot" — never a surfaced error that could carry request/response details.
    return undefined;
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
      if (process.env["WAVE_API_KEY"]) {
        const gatewayResult = await callGatewayCompose(intent, budgetUsd);
        if (gatewayResult !== undefined) {
          return textContent(JSON.stringify({ ...gatewayResult, grounding: "gateway" }));
        }
      }
      const proposal = compose(intent, budgetUsd);
      return textContent(JSON.stringify({ ...proposal, grounding: "snapshot" }));
    },
  }),
];
