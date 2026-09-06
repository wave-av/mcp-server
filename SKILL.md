---
name: wave-ask
description: "Propose a WAVE media pipeline (captions/clips/dub/realtime/identity) for a goal stated in plain language. Never executes — returns a proposal to call yourself."
---

# Skill: wave-ask

## When to use

An agent has a media-processing goal (captions, clips, dub, identity, x402
rails) and wants the WAVE product/MCP tool/price shape for it before calling.

## When NOT to use

Already know the route — call it directly. Need the full contract — read
`https://api.wave.online/openapi.json` or this server's live `tools/list`
listing instead.

## How to call

MCP: `wave.ask({ question: "<goal>", budgetUsd?: <number> })` — registered
alongside every other tool in this package's `src/tools/index.ts`.

```json
{ "question": "live captions from my mic" }
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
    { "productId": "transcribe", "meter": "wave_transcription_minutes", "priceShape": "x402 · pathUSD · tempo", "quote": "quote at call time" },
    { "productId": "captions", "meter": "wave_caption_minutes", "priceShape": "x402 · USDC · base", "quote": "quote at call time" }
  ],
  "executes": false,
  "next": [
    "adjacent capability: translated captions in a second language",
    "agent path via MCP: call perception_subscribe directly once you're ready to execute this yourself",
    "saved-flow signup: keep this composition for next time (post-GA)"
  ]
}
```

- `productIds` ⊆ `knowledge/products.json` `products[].id` (53 measured products).
- `tools` ⊆ the live `/mcp` tool listing bundled at `knowledge/mcp-tools.json` (69 measured tools).
- `meters` ⊆ non-null `pricing.meter` values in `knowledge/skills.json` (179 measured skills).
- There is **no `model` field** — no sourced Dispatch model catalog exists yet (see
  `designs/front-door/FRONT-DOOR-SYSTEM.md` §3b knowledge-set table in `wave-pen-register-wt`).
- `priceRows[].quote` is always `"quote at call time"` — this tool never fetches
  the gateway's live 402 endpoint, so it never guesses a number.

## Guarantees

- **Proposes, never executes** — `wave.ask` calls no other tool and makes no
  network request. `executes` is always the literal `false`.
- **Grounded, not generated** — every `productIds`/`tools`/`meters` entry is
  checked against the bundled knowledge snapshot at both rule-table-load time
  and per-call time (`src/tools/wave-ask/compose.ts`); a question naming
  something outside that snapshot never causes a fake name to appear in the
  output, and always falls back to a real, grounded composition instead of a
  dead end.
- **Deterministic** — the same `question`/`budgetUsd` always produce the same
  proposal; no model call is in the loop.
