// WAVE's agent-payment rails: x402 and MPP.
//
// These routes are PUBLIC BY DESIGN — the gateway serves them with no key auth, only a per-IP rate
// limit (`wave-gateway/src/facilitator-routes.ts`), because a paying agent has to be able to discover
// what it can buy and which payment schemes are supported BEFORE it holds a WAVE key. So these tools
// call the gateway front door directly rather than through the authenticated helper.
//
//   GET /v1/mpp/services              semantic search over WAVE's MPP service records (Vectorize)
//   GET /v1/x402/facilitator/supported  payment schemes/networks the x402 facilitator supports
//   GET /v1/mpp/facilitator/supported   the same, for MPP
//
// Only the read/discovery half is exposed. The facilitator's `verify` and `settle` endpoints are the
// money-moving side of the rail and are intentionally NOT wrapped as agent tools.
import { z } from "zod";
import { defineTool, errorContent, textContent, type WaveToolDef } from "./shared.js";
import { getApiBaseUrl } from "../auth.js";

/** Unauthenticated GET against the gateway's public plane. No Authorization header on purpose —
 *  these routes take none, and sending a key to a public endpoint leaks it for no benefit. */
async function publicGet(path: string): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    headers: { "User-Agent": "wave-mcp-server/0.1.0" },
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

export const paymentTools: WaveToolDef[] = [
  defineTool({
    name: "wave_find_paid_services",
    description:
      "Search WAVE's MPP service directory for machine-payable services an agent can buy from. " +
      "Semantic search — describe what you need in plain language. Public: no API key required.",
    inputSchema: {
      q: z.string().min(1).describe("What you're looking for, in plain language"),
      protocol: z.string().optional().describe("Filter by payment protocol, e.g. 'x402'"),
      tag: z.string().optional().describe("Filter by service tag"),
      topK: z.number().int().positive().max(50).optional().describe("How many results to return"),
    },
    handler: async ({ q, protocol, tag, topK }) => {
      const p = new URLSearchParams({ q });
      if (protocol) p.set("protocol", protocol);
      if (tag) p.set("tag", tag);
      if (topK !== undefined) p.set("topK", String(topK));

      const res = await publicGet(`/v1/mpp/services?${p.toString()}`);
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body);
    },
  }),

  defineTool({
    name: "wave_payment_schemes",
    description:
      "List the payment schemes and networks WAVE's facilitator supports, for x402 or MPP. Call " +
      "this before constructing a payment so you settle on a scheme WAVE actually accepts. " +
      "Public: no API key required.",
    inputSchema: {
      rail: z.enum(["x402", "mpp"]).describe("Which payment rail to query"),
    },
    handler: async ({ rail }) => {
      const res = await publicGet(`/v1/${rail}/facilitator/supported`);
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body);
    },
  }),
];
