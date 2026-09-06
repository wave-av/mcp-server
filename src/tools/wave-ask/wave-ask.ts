// `wave.ask` — the agent rendering of the WAVE conversational front door
// composer. Registered here as the 24th tool in THIS package's own registry
// (src/tools/index.ts) — becoming "tool #70" in the live gateway's `/mcp`
// listing (the design plan's numbering) is a separate deploy of the gateway
// itself, not something this repo does. The schema/behavior follow
// designs/front-door/AGENT-MANIFEST-PLAN-2026-09-05.md §3(c) in the
// wave-pen-register-wt repo (that design doc is NOT part of this checkout;
// cited for provenance only). It PROPOSES a composition of WAVE
// products/tools/meters for a plain-language goal and NEVER executes
// anything — it calls no other tool, fetches no network resource, and its
// output always carries the literal `executes: false`.
//
// Description/field-doc prose below is adapted from the wave-writer pass at
// wave-pen-register-wt designs/front-door/AGENT-COPY-2026-09-05/
// wave-ask-descriptions.json (commit 509cd87, "copy(front-door): agent-facing
// prose"), with two deliberate corrections against this repo's actual
// implementation: (1) that file's checks are phrased against LIVE manifests
// and a live HTTP 402 probe; this tool checks a BUNDLED, measured knowledge
// snapshot (knowledge/*.json) and never fetches the network at call time, so
// the prose below says "bundled snapshot" / "quoted at call time" instead;
// (2) that file's output schema still lists a `model` field to omit — per
// this repo's build brief, the field is dropped entirely rather than emitted
// as an omitted/placeholder value, and the productIds/tools/meters/priceRows/
// executes/next field names are this repo's own (not that file's
// utterance/products/callShape/priceShape/nextSuggestion names).
import { z } from "zod";
import { compose } from "./compose.js";
import { defineTool, textContent, type WaveToolDef } from "../shared.js";

export const waveAskTools: WaveToolDef[] = [
  defineTool({
    name: "wave.ask",
    description:
      "Propose a WAVE flow (product + MCP tool + price shape) for a media-processing goal stated in " +
      "plain language (captions/clips/dub/realtime/identity/x402/...). Reads only: checks a bundled, " +
      "measured snapshot of the product/skill/tool manifests (knowledge/*.json) — never the live network. " +
      "Never executes: calls no other tool, signs no payment, and makes no side-effecting or network " +
      "request. Returns a proposal object for you to call yourself; always carries the literal " +
      "`executes: false` and never a `model` field (no sourced Dispatch model catalog exists). See " +
      "skills/wave-ask/SKILL.md for the full contract.",
    inputSchema: {
      question: z
        .string()
        .trim()
        .min(1, "question must not be empty")
        .max(500, "question must be 500 characters or fewer")
        .describe(
          "The goal in plain language (e.g. \"live captions from my mic\"). Treated as untrusted text: " +
            "never echoed into a system-prompt-adjacent field, never used to construct a URL or tool call " +
            "directly — it only selects among a fixed, pre-grounded set of compositions.",
        ),
      budgetUsd: z
        .number()
        .finite()
        .nonnegative()
        .optional()
        .describe(
          "Optional USD budget ceiling. Never used to compute or invent a price — only reorders which " +
            "suggestion in `next[]` is surfaced first (a reminder to confirm the live 402 quote against " +
            "it before calling).",
        ),
    },
    handler: async ({ question, budgetUsd }) => {
      const proposal = compose(question, budgetUsd);
      return textContent(JSON.stringify(proposal));
    },
  }),
];
