// wave-dispatch routing tools.
//
// Dispatch is NOT behind the product gateway: it runs on its own host and takes a plain bearer, so
// these tools use `getDispatchUrl()` rather than the gateway helpers in ./shared.ts. Paths come from
// wave-dispatch's own committed facts (`.wave/repo.json` endpoints, resolver-verified):
//
//   POST /            classify a prompt → { route, decision }
//   GET  /profiles    named routing profiles (Fast/Expert/Heavy/Code) — flag-gated
//   GET  /sovereign   sovereign-tier routing profile — flag-gated
//
// Both GETs are behind a server-side feature flag (WAVE_PROFILES), so they can legitimately return a
// not-enabled response in a given environment. That is surfaced to the caller rather than hidden.
import { z } from "zod";
import { defineTool, errorContent, textContent, type WaveToolDef } from "./shared.js";
import { getApiKey, getDispatchUrl } from "../auth.js";

async function dispatchFetch(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(`${getDispatchUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "User-Agent": "wave-mcp-server/0.1.0",
      ...init?.headers,
    },
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

export const dispatchTools: WaveToolDef[] = [
  defineTool({
    name: "wave_route",
    description:
      "Classify a prompt with WAVE Dispatch and get back the model route it selected plus the " +
      "reasoning behind that decision. Use this to pick the cheapest capable model for a task " +
      "instead of hardcoding one.",
    inputSchema: {
      prompt: z.string().min(1).describe("The prompt to classify and route"),
      profile: z
        .string()
        .optional()
        .describe("Named routing profile to route under (see wave_list_routing_profiles)"),
    },
    handler: async ({ prompt, profile }) => {
      const body: Record<string, string> = { prompt };
      if (profile) body["profile"] = profile;

      const res = await dispatchFetch("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body);
    },
  }),

  defineTool({
    name: "wave_list_routing_profiles",
    description:
      "List WAVE Dispatch's named routing profiles (Fast / Expert / Heavy / Code chains). This is " +
      "feature-flagged server-side and may report as unavailable in some environments.",
    inputSchema: {},
    handler: async () => {
      const res = await dispatchFetch("/profiles");
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body);
    },
  }),
];
