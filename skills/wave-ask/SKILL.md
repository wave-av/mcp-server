---
name: wave-ask
description: "Propose a WAVE media pipeline (captions/clips/dub/realtime/identity) for a goal stated in plain language. Never executes — returns a proposal to call yourself."
---

# Skill: wave-ask / wave_compose

> **`wave_compose` is the registered successor to `wave.ask`** (mcp-server PR4-MCP). It takes the
> same kind of input and, when a `WAVE_API_KEY` is configured, also tries the live gateway
> `POST /v1/compose` route first (`grounding: "gateway"`), falling back to exactly the composition
> logic documented below (`grounding: "snapshot"`) when no key is set or the live call fails,
> errors, or times out after 3 seconds. `wave.ask` is kept, unchanged, as an offline-only alias for
> one release — everything below applies to both, except `wave_compose`'s input field is `intent`
> (not `question`) and its output additionally carries `grounding`.

## When to use

An agent has a media-processing goal (captions, clips, dub, identity, x402
rails) and wants the WAVE product/MCP tool/price shape for it before calling.
"Identity" resolves via the real `identity_resolve` MCP tool only — no
dedicated identity product exists in the catalog yet, so its proposal's
`productIds` is empty by design, never a fabricated id.

## When NOT to use

Already know the route — call it directly. Need the full contract — read
`https://api.wave.online/openapi.json` or this server's live `tools/list`
listing instead.

## How to call

MCP: `wave_compose({ intent: "<goal>", budgetUsd?: <number> })` — registered
alongside every other tool in this package's `src/tools/index.ts`. (The
deprecated `wave.ask({ question: "<goal>", budgetUsd?: <number> })` alias
still works identically for one release.)

```json
{ "intent": "live captions from my mic" }
```

`budgetUsd` is optional and never used to compute or invent a price — it only
reorders which suggestion in `next[]` is surfaced first (a reminder to
confirm the live 402 quote against it before calling).

## What you get back

A proposal object:

```json
{
  "intent": "live captions from my mic",
  "stages": ["realtime", "transcribe", "captions"],
  "productIds": ["realtime", "transcribe", "captions"],
  "tools": ["perception_subscribe", "wave_create_caption_job", "wave_list_captions", "wave_download_captions"],
  "meters": ["wave_realtime_video_minutes", "wave_transcription_minutes", "wave_caption_minutes"],
  "priceRows": [
    { "productId": "realtime", "meter": "wave_realtime_video_minutes", "priceShape": "x402 · USDC · base", "quote": "quote at call time" },
    { "productId": "transcribe", "meter": "wave_transcription_minutes", "priceShape": "x402 · USDC · base", "quote": "quote at call time" },
    { "productId": "captions", "meter": "wave_caption_minutes", "priceShape": "x402 · USDC · base", "quote": "quote at call time" }
  ],
  "executes": false,
  "next": [
    "adjacent capability: translated captions in a second language",
    "agent path via MCP: call perception_subscribe directly once you're ready to execute this yourself",
    "saved-flow signup: keep this composition for next time (post-GA)"
  ],
  "grounding": "snapshot"
}
```

(`grounding` only appears on `wave_compose`'s output, not `wave.ask`'s — `"snapshot"` above, or
`"gateway"` plus whatever other fields the live `POST /v1/compose` route answers with, verbatim,
when a `WAVE_API_KEY` is configured and that call succeeds within 3 seconds.)

- `productIds` ⊆ `knowledge/products.json` `products[].id` (59 measured products).
- `tools` ⊆ the live `/mcp` tool listing bundled at `knowledge/mcp-tools.json` (93 measured tools).
- `meters` ⊆ non-null `pricing.meter` values in `knowledge/skills.json` (179 measured skills).
- There is **no `model` field** — no sourced Dispatch model catalog exists yet (see
  `designs/front-door/FRONT-DOOR-SYSTEM.md` §3b knowledge-set table in `wave-pen-register-wt`).
- `priceRows[].quote` is always `"quote at call time"` in the snapshot path — this path never
  fetches the gateway's live 402 endpoint, so it never guesses a number.

## Guarantees

- **Proposes, never executes** — neither tool calls any other tool or signs any payment;
  `wave_compose`'s one outbound call is the single `POST /v1/compose` request itself, never a
  chained call. `executes` is always the literal `false`.
- **The API key never goes anywhere but the gateway** — `wave_compose` attaches `WAVE_API_KEY`
  only to the `Authorization` header of its one `POST /v1/compose` request; it is never logged and
  never echoed into the tool's returned content, including on a failed/timed-out call (which falls
  back to the snapshot path silently rather than surfacing a network error).
- **Grounded, not generated, in the snapshot path** — every `productIds`/`tools`/`meters` entry is
  checked against the bundled knowledge snapshot at both rule-table-load time
  and per-call time (`src/tools/wave-ask/compose.ts`); a question naming
  something outside that snapshot never causes a fake name to appear in the
  output, and always falls back to a real, grounded composition instead of a
  dead end.
- **Deterministic in the snapshot path** — the same `intent`/`budgetUsd` always produce the same
  fallback proposal; no model call is in the loop for that path. The live gateway path's
  determinism is the gateway's own contract, not this repo's.
