// `wave.ask` — the agent rendering of the WAVE conversational front door
// composer. Registered as tool #70 in the gateway's MCP listing per
// designs/front-door/AGENT-MANIFEST-PLAN-2026-09-05.md §3(c): it PROPOSES a
// composition of WAVE products/tools/meters for a plain-language goal and
// NEVER executes anything — it calls no other tool, fetches no network
// resource, and its output always carries the literal `executes: false`.
import { z } from "zod";
import { compose } from "./compose.js";
import { defineTool, textContent, type WaveToolDef } from "../shared.js";

export const waveAskTools: WaveToolDef[] = [
  defineTool({
    name: "wave.ask",
    description:
      "Propose a WAVE media pipeline (captions/clips/dub/realtime/identity/...) for a goal stated in " +
      "plain language. Grounded ONLY in the bundled products/skills/mcp-tools snapshot — never names a " +
      "product, tool, or meter outside that snapshot, and never a model (no sourced Dispatch catalog " +
      "exists). Returns a proposal object; NEVER executes — it calls no other tool and makes no network " +
      "request. See SKILL.md `wave-ask` for the full contract.",
    inputSchema: {
      question: z
        .string()
        .min(1, "question must not be empty")
        .max(500, "question must be 500 characters or fewer")
        .describe("The goal, stated in plain language (e.g. \"live captions from my mic\")."),
      budgetUsd: z
        .number()
        .finite()
        .nonnegative()
        .optional()
        .describe(
          "Optional USD budget ceiling. Never used to compute or invent a price — only reorders which " +
            "proposal suggestion is surfaced first (a reminder to confirm the live 402 quote against it).",
        ),
    },
    handler: async ({ question, budgetUsd }) => {
      const proposal = compose(question, budgetUsd);
      return textContent(JSON.stringify(proposal));
    },
  }),
];
