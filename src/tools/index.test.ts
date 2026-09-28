// Tool-list snapshot + drop guard for the ME-MCP-transport-tools go-live lane.
//
// Two things this test protects:
//   1. The stream/phone tools named in the go-live brief (wave_list_streams,
//      wave_create_stream, wave_start_stream, wave_stop_stream,
//      wave_get_stream_health, wave_get_stream_metrics, wave_mark_highlight,
//      wave_list_phone_lines, wave_provision_phone_line) are GONE from the
//      registered surface — not merely renamed or re-exported elsewhere.
//   2. No registered tool's name or description routes through /v1/streams or
//      /v1/phone at all (a stronger check than the name list above: it also
//      catches a *new* tool accidentally re-adding that surface under a
//      different name).
import { test } from "node:test";
import assert from "node:assert/strict";
import { allTools } from "./index.js";

const DROPPED_TOOL_NAMES = [
  "wave_list_streams",
  "wave_create_stream",
  "wave_get_stream",
  "wave_start_stream",
  "wave_stop_stream",
  "wave_get_stream_status",
  "wave_get_stream_health",
  "wave_get_stream_analytics",
  "wave_get_stream_metrics",
  "wave_mark_highlight",
  "wave_list_phone_lines",
  "wave_provision_phone_line",
];

const REQUIRED_TRANSPORT_TOOL_NAMES = [
  "wave_mint_moq_publish_token",
  "wave_mint_moq_subscribe_token",
  "wave_publish_braid_audio",
  "wave_stop_braid_audio",
  "wave_engine_capabilities",
  "wave_create_srt_input",
  "wave_list_srt_inputs",
  "wave_delete_srt_input",
  "wave_whip_publish",
  "wave_whep_subscribe",
  "wave_create_listen_session",
  "wave_create_crest_session",
  "wave_get_dante_observe_state",
];

test("allTools does not register any dropped stream/phone tool", () => {
  const names = allTools.map((t) => t.name);
  for (const dropped of DROPPED_TOOL_NAMES) {
    assert.ok(!names.includes(dropped), `${dropped} must not be registered (GA-scope drop, see ME-MCP-transport-tools)`);
  }
});

test("allTools registers every required transport tool exactly once", () => {
  const names = allTools.map((t) => t.name);
  for (const required of REQUIRED_TRANSPORT_TOOL_NAMES) {
    const count = names.filter((n) => n === required).length;
    assert.equal(count, 1, `${required} must be registered exactly once, found ${count}`);
  }
});

test("no registered tool routes through /v1/streams or /v1/phone", () => {
  const offenders = allTools.filter(
    (t) => /\/v1\/streams\b/.test(t.description) || /\/v1\/phone\b/.test(t.description) || /\/v1\/streams\b/.test(t.name) || /\/v1\/phone\b/.test(t.name),
  );
  assert.deepEqual(
    offenders.map((t) => t.name),
    [],
    "no tool description/name may reference /v1/streams or /v1/phone — those routes are preview, not GA",
  );
});

test("tool-name snapshot: no duplicate names, every name starts with wave_ or wave.", () => {
  const names = allTools.map((t) => t.name);
  const unique = new Set(names);
  assert.equal(unique.size, names.length, "duplicate tool name registered");
  for (const name of names) {
    assert.ok(/^wave[._]/.test(name), `tool name "${name}" does not follow the wave_ / wave. naming convention`);
  }
});
