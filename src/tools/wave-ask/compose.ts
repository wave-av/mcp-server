// The deterministic composer behind the `wave.ask` MCP tool.
//
// Per designs/front-door/FRONT-DOOR-SYSTEM.md §3 ("The composition planner: a
// deterministic function, not a model decision") and §3b(e) ("the composer
// proposes, never executes... tool-less proposer"): `compose()` is a pure
// function over a fixed table of goal signatures, each of which is verified
// against the bundled knowledge snapshot (../../knowledge.ts) at IMPORT time,
// not per call. No product id, MCP tool name, or meter name in this file's
// output can ever be one this module didn't already know about before the
// question arrived — the same question always produces the same composition
// (determinism), and the output is filtered through the knowledge Sets again
// at call time as a second, defense-in-depth grounding check (see
// `groundProductIds`/`groundTools` below) in case a future edit to this table
// introduces a typo.
//
// This module makes NO network calls and calls NO other tool — `executes` is
// always the literal `false`, never derived from input.
import { MCP_TOOL_NAMES, METER_NAMES, PRODUCT_IDS, SKILLS_BY_NAME } from "../../knowledge.js";

export interface PriceRow {
  readonly productId: string;
  /** `pricing.meter` from the skills manifest, or null when the skill is flat-x402-priced only. */
  readonly meter: string | null;
  /** `${pricing.model} · ${pricing.currency} · ${pricing.network}`, read verbatim off the skill. */
  readonly priceShape: string;
  /**
   * Always the literal "quote at call time" here — this tool never fetches a live 402 quote, so
   * no specific amount is ever a stored or model-authored number (adapted from wave-pen-register-wt
   * designs/front-door/AGENT-COPY-2026-09-05/wave-ask-descriptions.json's `priceShape` field doc).
   */
  readonly quote: string;
}

export interface AskProposal {
  /**
   * The goal restated in one line — a direct trim of the caller's own `question` text, UNVALIDATED
   * and untrusted. This is a display label only; it is never checked against the knowledge set and
   * MUST NOT be read as a grounded fact or an endorsement of any name it happens to contain (a
   * caller can put anything here, including a fabricated product/tool name). Only `productIds`,
   * `tools`, and `meters` are grounding-checked — never `intent`.
   */
  readonly intent: string;
  /** The pipeline steps for the proposed flow, e.g. `["realtime", "captions"]`. */
  readonly stages: readonly string[];
  /** Product ids for the flow, checked against the bundled `knowledge/products.json` snapshot; an id not found there is dropped, never rendered. */
  readonly productIds: readonly string[];
  /** MCP tool names for the flow, checked against the bundled `knowledge/mcp-tools.json` snapshot; a name not found there is dropped, never rendered. */
  readonly tools: readonly string[];
  /** Deduplicated, non-null `pricing.meter` values from `priceRows`, checked against the bundled `knowledge/skills.json` snapshot. */
  readonly meters: readonly string[];
  /** One row per grounded productId with a matching skill entry — see {@link PriceRow}. */
  readonly priceRows: readonly PriceRow[];
  /** Always the literal `false` — this tool proposes, never executes; no other tool is ever called. */
  readonly executes: false;
  /** Adjacent-step suggestions (a related capability, a cheaper route, the same flow via MCP, a saved-flow signup) — never fabricated, always grounded in this same composition. */
  readonly next: readonly string[];
}

interface GoalSignature {
  readonly id: string;
  /** Lowercase substrings; the first signature with any trigger present in the (lowercased) question wins. */
  readonly triggers: readonly string[];
  readonly productIds: readonly string[];
  readonly tools: readonly string[];
  readonly adjacent: string;
}

// Every productId/tool below is a real, measured id/name from
// knowledge/products.json (53 products) and knowledge/mcp-tools.json (69 live
// gateway tools) — see the module-load assertion at the bottom of this file,
// which throws if any of them ever drift out of the bundled snapshot.
const GOAL_SIGNATURES: readonly GoalSignature[] = [
  {
    id: "captions",
    triggers: ["caption"],
    // Matches designs/front-door/front-door.copy.json `flows.captions.products`
    // (cited verbatim in src/tools/wave-ask/wave-ask.test.ts).
    productIds: ["realtime", "transcribe", "captions"],
    tools: ["perception_subscribe", "wave_create_caption_job", "wave_list_captions", "wave_download_captions"],
    adjacent: "translated captions in a second language",
  },
  {
    id: "transcribe",
    triggers: ["transcript", "timestamps"],
    productIds: ["transcribe"],
    tools: ["wave_create_transcription", "wave_get_transcription", "wave_list_transcriptions"],
    adjacent: "chapters generated from the same transcript",
  },
  {
    id: "clips",
    triggers: ["clip", "highlight"],
    // Matches designs/front-door/front-door.copy.json `flows.clips.products`
    // (cited verbatim in src/tools/wave-ask/wave-ask.test.ts).
    productIds: ["sentiment", "search", "clips"],
    tools: ["wave_detect_clips", "wave_create_clip", "wave_list_clips"],
    adjacent: "captions burned into each clip before it is shared",
  },
  {
    id: "sentiment",
    triggers: ["sentiment", "how the room feels", "audience reaction"],
    productIds: ["realtime", "sentiment"],
    tools: ["wave_create_sentiment_analysis", "wave_list_sentiment_analyses"],
    adjacent: "clip the exact moment sentiment spikes",
  },
  {
    id: "podcast",
    triggers: ["podcast", "dub ", "rss feed"],
    // Matches designs/front-door/front-door.copy.json `flows.dub.products`
    // (cited verbatim in src/tools/wave-ask/wave-ask.test.ts) — the copy pack's
    // "dub a podcast into Spanish" chip and "turn a recording into a podcast"
    // resolve to the same transcribe -> voice -> podcast pipeline.
    productIds: ["transcribe", "voice", "podcast"],
    tools: ["wave_create_transcription", "wave_generate_speech", "wave_create_podcast_episode", "wave_create_podcast_show"],
    adjacent: "chapters generated from the same transcript for the episode description",
  },
  {
    id: "chapters",
    triggers: ["chapter", "table of contents"],
    productIds: ["chapters"],
    tools: ["wave_detect_chapters", "wave_create_chapter", "wave_list_chapters"],
    adjacent: "search across the same recording by chapter",
  },
  {
    id: "search",
    triggers: ["search"],
    productIds: ["search"],
    tools: ["wave_search", "wave_search_index"],
    adjacent: "clip the exact timestamp a search hit lands on",
  },
  {
    id: "bridge",
    triggers: ["bridge", "srt", "rist"],
    productIds: ["bridge", "moq"],
    tools: ["wave_mint_moq_publish_token", "wave_mint_moq_subscribe_token"],
    adjacent: "publish the same feed as a low-latency MoQ track",
  },
  {
    id: "moq",
    triggers: ["moq", "low-latency live track"],
    productIds: ["moq"],
    tools: ["wave_mint_moq_publish_token", "wave_mint_moq_subscribe_token"],
    adjacent: "bridge the same feed to SRT/RIST simultaneously",
  },
  {
    id: "studio-ai",
    triggers: ["switch cameras", "studio-ai", "ai switch"],
    productIds: ["studio-ai"],
    tools: [],
    adjacent: "render the finished switch as a downloadable video",
  },
  {
    id: "voice",
    triggers: ["clone a voice", "clone voice", "read this script"],
    productIds: ["voice"],
    tools: ["wave_clone_voice", "wave_generate_speech", "wave_list_voices"],
    adjacent: "publish the cloned narration as a podcast episode",
  },
  {
    id: "collab",
    triggers: ["control room", "shared control room", "remote crew"],
    productIds: ["collab"],
    tools: ["wave_create_collab_room", "wave_get_collab_room", "wave_list_collab_rooms"],
    adjacent: "record the shared control room session for later editing",
  },
  {
    id: "editor",
    triggers: ["describe a cut", "finished video back", "no editor"],
    productIds: ["editor"],
    tools: ["wave_render_video", "wave_render_poll"],
    adjacent: "auto-chapter the finished cut before publishing",
  },
  {
    id: "identity",
    triggers: ["resolve identity", "verify identity", "identity resolution", "verify a wallet", "who is this caller"],
    // No dedicated "identity" product exists in knowledge/products.json today (verified against
    // the 53-entry snapshot) — grounded via the real identity_resolve MCP tool only, never a
    // fabricated product id. See skills/wave-ask/SKILL.md's note on this.
    productIds: [],
    tools: ["identity_resolve"],
    adjacent: "check facilitator/x402 rail status alongside identity resolution",
  },
  {
    id: "gateway",
    triggers: ["pay per call", "x402", "without an account", "pay-per-use"],
    productIds: ["gateway"],
    tools: ["facilitator_status", "list_supported_protocols"],
    adjacent: "resolve the caller's identity before the first paid call",
  },
];

const FALLBACK_SIGNATURE: GoalSignature = {
  id: "general",
  triggers: [],
  productIds: ["gateway"],
  tools: ["facilitator_status", "list_supported_protocols"],
  adjacent: "ask wave.ask again with the product, format, or duration for a tailored composition",
};

function assertGrounded(signature: GoalSignature): void {
  for (const productId of signature.productIds) {
    if (!PRODUCT_IDS.has(productId)) {
      throw new Error(
        `wave.ask goal signature "${signature.id}" names productId "${productId}", which is not in ` +
          "the bundled knowledge/products.json snapshot — fix the signature or refresh the snapshot",
      );
    }
  }
  for (const tool of signature.tools) {
    if (!MCP_TOOL_NAMES.has(tool)) {
      throw new Error(
        `wave.ask goal signature "${signature.id}" names tool "${tool}", which is not in the bundled ` +
          "knowledge/mcp-tools.json snapshot — fix the signature or refresh the snapshot",
      );
    }
  }
}

for (const signature of [...GOAL_SIGNATURES, FALLBACK_SIGNATURE]) {
  assertGrounded(signature);
}

function matchSignature(question: string): GoalSignature {
  const normalized = question.toLowerCase();
  for (const signature of GOAL_SIGNATURES) {
    if (signature.triggers.some((trigger) => normalized.includes(trigger))) {
      return signature;
    }
  }
  return FALLBACK_SIGNATURE;
}

/** Runtime grounding filter — defense-in-depth on top of the import-time assertion above. */
function groundProductIds(ids: readonly string[]): string[] {
  return ids.filter((id) => PRODUCT_IDS.has(id));
}

function groundTools(names: readonly string[]): string[] {
  return names.filter((name) => MCP_TOOL_NAMES.has(name));
}

function buildPriceRows(productIds: readonly string[]): PriceRow[] {
  const rows: PriceRow[] = [];
  for (const productId of productIds) {
    const skill = SKILLS_BY_NAME.get(productId);
    if (!skill) continue; // no skill entry (e.g. "gateway") -> no priceRow, never a fabricated one
    rows.push({
      productId,
      meter: skill.pricing.meter,
      priceShape: `${skill.pricing.model} · ${skill.pricing.currency} · ${skill.pricing.network}`,
      quote: "quote at call time",
    });
  }
  return rows;
}

function buildMeters(priceRows: readonly PriceRow[]): string[] {
  const meters = new Set<string>();
  for (const row of priceRows) {
    if (row.meter !== null && METER_NAMES.has(row.meter)) meters.add(row.meter);
  }
  return [...meters];
}

function buildNext(
  signature: GoalSignature,
  priceRows: readonly PriceRow[],
  tools: readonly string[],
  budgetUsd: number | undefined,
): string[] {
  const rungs: string[] = [];
  if (typeof budgetUsd === "number") {
    rungs.push(
      `budget check: confirm the live 402 quote for each priceRow against your $${budgetUsd.toFixed(2)} ` +
        "budget before calling — quotes are only accurate at call time, never pre-computed here",
    );
  }
  rungs.push(`adjacent capability: ${signature.adjacent}`);
  const flatRow = priceRows.find((row) => row.meter === null);
  if (flatRow) {
    // Labeled by pricing SHAPE, not by cost: this module never fetches a live quote, so it never
    // compares flatRow's price against a metered alternative and must not claim it is "cheaper".
    rungs.push(
      `flat-priced route: ${flatRow.productId} bills a flat x402 floor price with no per-unit meter ` +
        "— confirm the live 402 quote before calling",
    );
  }
  if (tools.length > 0) {
    rungs.push(`agent path via MCP: call ${tools[0]} directly once you're ready to execute this yourself`);
  }
  rungs.push("saved-flow signup: keep this composition for next time (post-GA)");
  return rungs;
}

/**
 * Compose a proposal for `question`. Pure and deterministic: the same question
 * (and budgetUsd) always yields the same output. Never executes, never fetches
 * the network, never names a product/tool/meter outside the bundled snapshot.
 */
export function compose(question: string, budgetUsd?: number): AskProposal {
  const signature = matchSignature(question);
  const productIds = groundProductIds(signature.productIds);
  const tools = groundTools(signature.tools);
  const priceRows = buildPriceRows(productIds);
  const meters = buildMeters(priceRows);
  const next = buildNext(signature, priceRows, tools, budgetUsd);

  return {
    intent: question.trim(),
    stages: productIds,
    productIds,
    tools,
    meters,
    priceRows,
    executes: false,
    next,
  };
}
