# Front-door knowledge set — sources

> **Scope note for this checkout (wave-av/mcp-server):** this file is copied verbatim from
> `wave-pen-register-wt` `designs/front-door/knowledge/SOURCES.md` (source repo, not part of this
> checkout) for full fetch provenance. Only THREE of the artifacts described below are actually
> bundled here, alongside this file, under this repo's own `knowledge/`: `products.json`,
> `skills.json`, `mcp-tools.json` (each with its `.meta.json` sidecar) — these are exactly what
> `src/knowledge.ts` loads and `src/tools/wave-ask/compose.ts` grounds against. The other rows
> (`openapi-paths.json`, `models.json`, `catalog-projection.json`) and the `git -C api-spec` /
> `git -C wave-www` reproduction commands below describe the SOURCE repo's broader knowledge set
> and are kept for context/provenance only — they are not files in this repo and their commands
> cannot be re-run from here. `front-door.copy.json` and `tools/front-door-parity.mjs` (mentioned
> below) are likewise source-repo-only artifacts, not present in this checkout.

Every file in `designs/front-door/knowledge/` is a real, fetched-or-git-shown artifact with a
sidecar `<name>.meta.json` (fetchedAt, url/command, sha256, counts). Nothing here is re-derived
from memory or from the design doc's prose — the design doc (`FRONT-DOOR-SYSTEM.md`) now cites
these files, not the other way around. Re-run any row below with its exact command to reproduce.

## Index

| Artifact | Source | Count | Fetched | Notes |
|---|---|---|---|---|
| `products.json` | `curl https://api.wave.online/.well-known/wave-products.json` | 53 total (9 live, 44 preview) | 2026-09-05T23:06:00Z | Matches `FRONT-DOOR-SYSTEM.md`'s prior "53 total: 9 live, 44 preview" claim exactly. |
| `skills.json` | `curl https://gateway.wave.online/.well-known/wave-skills.json` | 179 (40 priced, 176 x402-shaped, 2 free, 1 metered-non-x402) | 2026-09-05T23:06:00Z | "priced" = `pricing.meter` non-null; "x402-shaped" = `pricing.model === "x402"`. Both match the doc's prior claims exactly. |
| `mcp-tools.json` | `curl https://api.wave.online/mcp` | 69 (`toolCount` === `tools.length`) | 2026-09-05T23:06:00Z | A plain `GET` returns the full manifest (`name`, `description`, `version`, `toolCount`, `tools[]`) — no JSON-RPC `initialize`/`tools/list` body was needed, contrary to the brief's fallback assumption. |
| `openapi-paths.json` | `git -C api-spec fetch -q origin && git -C api-spec show origin/main:openapi.yaml` | 252 path+method rows, 227 unique paths, 180 unique tag groups | 2026-09-05T23:04:00Z (git show, not HTTP) | **Measured against `origin/main`**, not the parked branch the design doc originally cited. See "REST paths: 44→227" below — this is the single biggest number change in this pass. |
| `models.json` | See `.probed[]` in the file itself | 0 real models found | 2026-09-05T23:06:35Z | `source: "NO REAL SOURCE FOUND"`. Re-probed `api.wave.online/v1/models` (403 `ROUTE_NOT_MAPPED`), `dispatch.wave.online/v1/models` (404, marketing site not an API host), and the `wave-dispatch` repo tree on `origin/main` (a Metronome billing-meter snapshot and a local dev-assistant router — neither is a public model catalog). |
| `catalog-projection.json` | `git -C wave-www fetch -q origin && git -C wave-www show origin/main:content/capabilities.generated.ts` | `counts.products: 53`, `counts.renderings.api: 16` | 2026-09-05T23:10:00Z | Not one of the five artifacts the brief named; added because the parity checks and this reconciliation both need a real hashed source, not prose. |

## The REST-path count: 44 → 227 (and why)

`FRONT-DOOR-SYSTEM.md` originally measured `api-spec`'s `openapi.yaml` against a **parked local
branch** (`feat/identity-resolve`), got 44 paths / 18 tag groups, and explicitly caveated that
count as provisional pending a re-measure against `origin/main`. This pass did that re-measure:

```
git -C "$HOME/wave-av/api-spec" fetch -q origin
git -C "$HOME/wave-av/api-spec" show origin/main:openapi.yaml
```

Result: **227 unique paths, 252 path+method operations, 180 tag groups.** The gap is real, not a
parsing bug — `origin/main`'s spec is both newer (more paths added since the parked branch) and
much wider in scope: 180 tags include operator/internal-plane groups the parked branch's 18-tag
figure never covered (`Compliance`, `Zero Trust Vault`, `Argus`, `Aegis`, `Billing`, `Fleet`,
`Dsar`, `Cro`, `Ci`, etc.) alongside the customer-facing product tags (`Clips`, `Voice`,
`Captions`, `Podcast`, `Realtime`, `Bridge`, `MoQ`, ...). **This raw count is not directly usable
for what the front door renders** — a visitor should never see "180 tag groups" as if that were
WAVE's product surface. OWED: a defined customer-facing subset (most likely: tags matching the
product roster in `products.json`, dropping operator/internal-only tags) before this number is
rendered anywhere a visitor sees it. `openapi-paths.json` carries the full raw list (path, method,
tag, summary) so that filter can be built and re-validated against a real artifact, not prose.

## The 53-vs-16 reconciliation

Three different "16"s and "53"s exist across this system, and they are NOT the same number twice
by coincidence — they measure different things:

1. **`products.json` (live manifest, `api.wave.online/.well-known/wave-products.json`): 53
   products, 9 live + 44 preview.** This is the actual live platform catalog. Ground truth.
2. **`capabilities.generated.ts` (`wave-www`, `origin/main`) `counts.products`: 53.** This
   generated projection's own `products[]` array literal now holds all 53 entries — it is **not**
   stale relative to the live manifest; `manifestHash` in the file
   (`sha256:e2bdb9df87de956430b81e6d57d712236d30c71d72b594c5279e7c89ddf78045`) differs from the
   hash `FRONT-DOOR-SYSTEM.md` originally cited (`sha256:35d6fa4f...`), meaning the file has been
   regenerated since that doc was written, and the regeneration already resolved the 53-vs-16 gap
   at the `counts.products` level. **The discrepancy the doc flagged for reconciliation no longer
   exists at that level — it exists one level down, in `counts.renderings.api`.**
3. **`capabilities.generated.ts` `counts.renderings.api`: 16.** This counts products that have at
   least one non-empty `renderings.api[]` entry in the generated file — i.e., products this
   projection has wired concrete REST call examples for. It is a **mechanical** count, not a
   curated list: `productsWithApiRenderings` in `catalog-projection.json` is `gateway, clips, moq,
   realtime, voice, captions, chapters, editor, collab, podcast, studio-ai, transcribe, sentiment,
   search, audio, engine`.
4. **The front-door copy pack's own 16-product roster** (`front-door.copy.json` `products{}` keys):
   `gateway, dispatch, clips, moq, bridge, realtime, voice, captions, chapters, editor, collab,
   podcast, studio-ai, transcribe, sentiment, search`. This is a **hand-curated** front-door
   roster, built independently of `renderings.api`. It differs from set (3) by exactly two swaps:
   - **Only in `renderings.api` (not in the copy pack): `audio`, `engine`** — lower-level/infra
     products (audio mux/demux plumbing, the generic engine-capability surface), reasonably
     excluded from a customer-facing front-door pitch.
   - **Only in the copy pack (not in `renderings.api`): `dispatch`, `bridge`** — both real,
     both present in `capabilities.generated.ts` `products[]` (`dispatch: live`, `bridge:
     preview`, confirmed directly), but both have an empty `renderings.api: []` in that file —
     this generated projection hasn't wired a concrete REST call example for either product yet.

   Both the "16" in set (3) and the "16" in set (4) are internally consistent (16 items each) but
   are **not the same 16 products**. `tools/front-door-parity.mjs`'s `statline-counts` check
   compares the copy pack's numeric claim (16) against `catalog-projection.json`'s
   `counts.renderings.api` (also 16) — the counts match, but a reviewer should not assume the
   *membership* matches without reading `diffApiRenderingsVsCopyPack` in that file.

5. **The other 37** (53 total − 16 copy-pack products): 6 live (`docs`, `inference`, `listen`,
   `receipts`, `runtime`, `seo`) + 31 preview (`aes67`, `agents`, `audio`, `blog`, `changelog`,
   `crest`, `dante`, `decode`, `developer`, `encode`, `engine`, `enhance`, `flow`, `mcp`, `mesh`,
   `metrics`, `ndi`, `omt`, `partners`, `pulse`, `rt`, `sandbox`, `sdk`, `srt`, `st2110`,
   `transcode`, `trust`, `vision`, `visual-qa`, `webhook`, `zoom`). All 37 are tagged
   `engine: "media"` in `capabilities.generated.ts`, which looks like a default/fallback value
   rather than a meaningful engine classification (e.g. `sdk`, `blog`, `docs`, `developer` are not
   media-engine products by any reasonable definition) — flagged, not silently trusted.

### Recommendation

The front door **must never show a product the catalog does not carry as live/preview without its
status** (brief's own constraint) — `tools/front-door-parity.mjs`'s `product-slugs-and-status`
check enforces exactly this for whatever roster the copy pack ships with. Beyond that mechanical
floor:

- **Keep the copy pack's 16-product roster as the front door's primary composition surface.** It
  is a deliberate, reviewed curation (matches the three worked proposals in §3b(f): captions,
  clips, podcast+voice), not an accidental subset — and it already passes status-parity against
  the live manifest.
- **Do not describe "16" as "the platform"** anywhere the statLine or a similar summary line is
  user-facing — it is 16 of 53. If a "see everything WAVE does" surface ships later (e.g. a full
  product directory), it should read all 53 from `products.json` directly, with `status` shown per
  product, not silently promote a preview product to look live or silently drop the other 37.
- **`dispatch` and `bridge` (in the copy pack, not yet in `renderings.api`)** should get a real
  `renderings.api[]` example in the next `capabilities.generated.ts` regen, so the "wired REST
  example" projection and the front door's actual product roster converge instead of drifting by
  a fixed two-item offset indefinitely.
- **The 37 excluded products are mostly infra/internal-facing** (`sdk`, `docs`, `mesh`, `metrics`,
  `trust`, `zero-trust`-adjacent) or narrow-transport plumbing (`ndi`, `srt`, `dante`, `aes67`,
  `omt`, `st2110`) that a general "what are you trying to do" chat visitor is unlikely to ask for
  directly — reasonable to exclude from the primary composer, but they should still resolve
  correctly (with real status) if a visitor's utterance names one by name (e.g. "I need NDI
  ingest") rather than silently treating it as unknown.

## What the parity script (`tools/front-door-parity.mjs`) catches

- Every copy-pack product slug + status against `products.json` (catches a stale/fabricated
  status, e.g. showing a preview product as live).
- The copy pack's `statLine` numeric claims (`N products`, `N ways in`) against `skills.json`
  length and `catalog-projection.json`'s `counts.renderings.api` (catches a stale count surviving
  a manifest regeneration).
- Every MCP tool name referenced in `FRONT-DOOR-SYSTEM.md` §3b's worked proposals against the live
  `mcp-tools.json` listing — the schema/template block's placeholder text (`<MCP tool name>`) is
  explicitly excluded so the check is never vacuous once real tools are filled in.
- The copy pack's `priceRow` pricing-shape claim (x402 · USDC · Base) against the actual dominant
  pricing shape in `skills.json` (catches a price-shape claim the manifest doesn't back up, or
  one that used to be dominant and no longer is).
- The 15 seeded eval intents in `FRONT-DOOR-SYSTEM.md` §3 — every intent's arrow-target must
  resolve to a real product id or skill name (catches a dead-end intent with no real product to
  route to, and catches the eval set silently shrinking below 15).

Run: `node tools/front-door-parity.mjs` (exits non-zero, prints a pass/fail table). Tests:
`node --test tools/front-door-parity.test.mjs` (one fixture per failure class plus the pass case).
