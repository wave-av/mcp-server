// The voice-agent tool — drive a full headless conversation (bind → audio-in → TTS-out) from the shell.
//
// This is the agent-facing rendering of the voice agent: a human uses the CLI (harness/voice-cli.mjs in
// wave-realtime-edge), an agent uses this tool. Both ride the SAME headless transport (audio-in WS in,
// TTS WS out) with no browser and no WebRTC — so the agent can exercise the voice loop from anywhere.
//
// Auth is the edge's INTERNAL seal (WAVE_INTERNAL_SECRET / WAVE_REALTIME_EDGE), NOT the customer key —
// the headless bind talks to the edge directly, mirroring the harness (leg3.mjs). Reference-only; never
// returned.
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { parseSecureOrigin } from "../auth.js";
import { failureContent, textContent, type WaveToolDef } from "./shared.js";

const DEFAULT_REALTIME_EDGE = "https://rt.wave.online";

/**
 * The only message a refused WAVE_REALTIME_EDGE produces. Fixed text, never the configured value:
 * this string reaches the calling agent's transcript, and a URL can carry userinfo.
 */
export const EDGE_REFUSED_MESSAGE =
  "WAVE_REALTIME_EDGE must be a bare https:// origin (http:// only for a loopback host), with no " +
  "path, query or fragment. The bind sends the edge-internal secret to it. Unset it to use " +
  DEFAULT_REALTIME_EDGE;

/**
 * The edge origin the bind may be sent to. WAVE_REALTIME_EDGE is validated like WAVE_BASE_URL
 * (../auth.ts parseSecureOrigin), because the bind carries the `x-wave-internal` seal: a cleartext
 * remote edge would put the seal on the wire, and a path or query would be silently folded into
 * the request URL. Unset or blank means the default edge.
 */
export function resolveRealtimeEdge(configured: string | undefined): string {
  if (configured === undefined || configured.trim() === "") return DEFAULT_REALTIME_EDGE;
  const result = parseSecureOrigin(configured.trim());
  if (!result.ok) throw new Error(EDGE_REFUSED_MESSAGE);
  return result.origin;
}

/**
 * The edge config, read from process.env at CALL time — the same process.env the registry's
 * {@link voiceAvailable} check reads. Captured at import instead, a secret set after this module
 * loaded (an Agent SDK host that sets it before building the server) would register the tool and
 * then fail every call with "not set". The edge is validated on every call, so no configuration,
 * however it changed after startup, sends the seal anywhere {@link resolveRealtimeEdge} refuses.
 */
function edgeConfig(): { edge: string; seal: string; org: string } {
  return {
    edge: resolveRealtimeEdge(process.env["WAVE_REALTIME_EDGE"]),
    seal: process.env["WAVE_INTERNAL_SECRET"] ?? "",
    org: process.env["WAVE_VOICE_ORG"] ?? "mcp",
  };
}

function varint(v: number): number[] {
  const o: number[] = [];
  while (v >= 0x80) { o.push((v & 0x7f) | 0x80); v = Math.floor(v / 128); }
  o.push(v & 0x7f);
  return o;
}
function encodePacket(payload: Buffer, seq: number, ts: number): Buffer {
  const head = [...varint(0x08), ...varint(seq), ...varint(0x10), ...varint(ts), ...varint(0x2a), ...varint(payload.length)];
  return Buffer.concat([Buffer.from(head), payload]);
}
function decodePacket(frame: Buffer): Buffer {
  const b = frame; let i = 0;
  while (i < b.length) {
    const tag = b[i++]!; const wire = tag & 7;
    if (wire === 0) { while (i < b.length && (b[i]! & 0x80) !== 0) i++; i++; }
    else if (wire === 2) {
      let len = 0, s = 0;
      while (i < b.length) { const byte = b[i++]!; len |= (byte & 0x7f) << s; if ((byte & 0x80) === 0) break; s += 7; }
      if ((tag >> 3) === 5) return b.subarray(i, i + len);
      i += len;
    } else break;
  }
  return Buffer.alloc(0);
}
function decodeWav(buf: Buffer): { pcm: Buffer } {
  let off = 12, data: Buffer | null = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4); const size = buf.readUInt32LE(off + 4);
    if (id === "data") { data = buf.subarray(off + 8, off + 8 + size); break; }
    off += 8 + size + (size % 2);
  }
  if (!data) throw new Error("WAV has no data chunk");
  return { pcm: Buffer.from(data) };
}
function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error("WS connect failed"));
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function converse(room: string, audioPath: string, outPath: string): Promise<string> {
  const { edge, seal, org } = edgeConfig();
  if (!seal) throw new Error("WAVE_INTERNAL_SECRET is not set on this MCP server");
  const { readFileSync, writeFileSync } = await import("node:fs");
  const participantSessionId = `mcp_${randomUUID()}`;

  const res = await fetch(`${edge}/v1/realtime/agents/bind`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-wave-internal": seal, "x-wave-org": org },
    body: JSON.stringify({ config: { roomId: room, agentId: "voice-agent", participantSessionId, participantTrackName: "mic", headless: true } }),
    // The bind carries the edge-internal seal: one POST to the configured edge, never a redirect.
    redirect: "error",
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; audioInEndpoint?: string; ttsEndpoint?: string };
  if (res.status !== 200 || !json.ok || !json.audioInEndpoint || !json.ttsEndpoint) {
    // Status only. The bind body can carry session endpoints and ids; none of it goes to the caller.
    throw new Error(`bind failed: HTTP ${res.status}`);
  }

  const pcm = decodeWav(readFileSync(audioPath)).pcm;
  const [audioIn, tts] = await Promise.all([connect(json.audioInEndpoint), connect(json.ttsEndpoint)]);

  const outChunks: Buffer[] = [];
  let closed = false;
  tts.onmessage = (ev) => { const p = decodePacket(Buffer.from(ev.data as ArrayBuffer)); if (p.length > 0) outChunks.push(p); };
  tts.onclose = () => { closed = true; };

  const CHUNK = 32000;
  const bytesPerMs = 48000 * 2 * 2 / 1000;
  let seq = 0, ts = 0;
  const started = Date.now();
  for (let off = 0; off < pcm.length; off += CHUNK) {
    const chunk = pcm.subarray(off, off + CHUNK);
    audioIn.send(encodePacket(chunk, seq++, ts));
    ts += Math.floor(chunk.length / 4);
    const target = (off + chunk.length) / bytesPerMs;
    const elapsed = Date.now() - started;
    if (target > elapsed) await sleep(target - elapsed);
  }
  // trailing silence for VAD endpointing (hangover 12 frames ≈ 2s)
  const silence = Buffer.alloc(CHUNK);
  for (let i = 0; i < 15; i++) { audioIn.send(encodePacket(silence, seq++, ts)); ts += Math.floor(CHUNK / 4); await sleep(CHUNK / bytesPerMs); }

  const ttl = Date.now() + 60000;
  while (!closed && Date.now() < ttl) await sleep(250);

  const total = Buffer.concat(outChunks);
  if (total.length === 0) throw new Error("no TTS received (agent did not reply)");
  writeFileSync(outPath, total);
  return `TTS received: ${total.length} bytes (${Math.round(total.length / bytesPerMs)} ms) → ${outPath}`;
}

/**
 * What a failed converse() may say to the caller. A plain `Error` is either one converse() threw
 * itself (a fixed string or the status line above) or a Node filesystem error on the caller's own
 * audioPath/outPath (ENOENT and the like), which the caller needs verbatim. Anything else — a
 * fetch TypeError, a WebSocket failure, whose message or cause could echo request details — is
 * reduced to its class name.
 */
export function voiceFailureMessage(e: unknown): string {
  if (!(e instanceof Error)) return "unknown error";
  return e.constructor === Error ? e.message : e.name;
}

/**
 * True when this process holds the edge's internal seal. The registry (./index.ts) registers
 * wave_voice_converse only then: the tool authenticates with the edge-internal secret, not a
 * customer WAVE_API_KEY, so on a customer machine it could never succeed. Presence check only; the
 * value is never logged or returned.
 */
export function voiceAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  const seal = env["WAVE_INTERNAL_SECRET"];
  return typeof seal === "string" && seal.length > 0;
}

export const voiceTools: WaveToolDef[] = [
  {
    name: "wave_voice_converse",
    description:
      "Drive a full headless conversation with the WAVE voice agent: bind the agent to a room, send a WAV " +
      "of the caller's speech (16-bit LE 48 kHz PCM, mono or stereo), and receive the agent's spoken reply " +
      "as raw 16-bit LE 48 kHz stereo PCM written to outPath. No browser, no WebRTC.",
    inputSchema: {
      room: z.string().min(1).max(128).describe("Room id the agent is bound to"),
      audioPath: z.string().min(1).describe("Path to the input WAV (16-bit LE 48 kHz PCM)"),
      outPath: z.string().min(1).describe("Path to write the agent's reply PCM to (raw, no WAV header)"),
    },
    handler: async ({ room, audioPath, outPath }) => {
      try {
        const summary = await converse(String(room), String(audioPath), String(outPath));
        return textContent(summary);
      } catch (e) {
        // Every message converse() throws is a fixed string or a status line built above; a
        // fetch/WebSocket/fs failure is reported by its class, not by whatever it echoed.
        return failureContent(`voice_converse failed: ${voiceFailureMessage(e)}`);
      }
    },
  },
];
