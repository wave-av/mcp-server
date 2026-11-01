// Pure classification of one MCP tools/call result into a smoke-table row.
//
// Split out of scripts/smoke-mcp.mjs (which spawns a server as soon as it is imported) so that
// src/smoke-classify.test.ts can test every row class without a server, a key or the network.
//
// OUTPUT NEVER CARRIES A RESPONSE BODY. A row's `marker` is built only from the HTTP status, the
// gateway's identifier-shaped error code and a byte count. The smoke runs in a PUBLIC repo's CI logs,
// and a 2xx body from GET /v1/billing is the caller's organization id and plan.

/** An identifier-shaped code (or problem-type URL) — safe to print; anything else is not. */
const SAFE_CODE = /^[A-Za-z0-9_.:/-]{1,160}$/;

/**
 * The fixed refusal src/auth.ts getApiKey() throws when WAVE_API_KEY is unset. Matched, never echoed,
 * so the most common local failure gets a precise label.
 */
const MISSING_KEY = /^WAVE_API_KEY environment variable is required\./;

/**
 * The gateway's error code from a JSON body — `error.code` (WAVE envelope), `type` (problem+json),
 * or "x402" for a payment-required challenge — or undefined. Never any other part of the body.
 */
export function errorCodeOf(json) {
  if (json === null || typeof json !== "object") return undefined;
  const candidates = [json.error?.code, json.code, json.type];
  const code = candidates.find((c) => typeof c === "string" && SAFE_CODE.test(c));
  if (code !== undefined) return code;
  return json.x402Version !== undefined ? "x402" : undefined;
}

/**
 * Classify a tools/call result into a smoke-table row. Tool handlers return one of:
 *   - the raw passthrough JSON (a 2xx answer), never with `isError`;
 *   - the "Error <status>: <body>" text errorContent() produces (a non-2xx answer), which since
 *     0.4.0 MUST carry `isError: true`;
 *   - a failureContent() text with `isError: true` and NO status, when the tool failed before any
 *     HTTP answer existed (WAVE_API_KEY unset, a refused origin, a missing local library). Such a
 *     row has status "none": no request was answered, so it must not be reported as a 2xx.
 *
 *   reachedGateway — the answer is the gateway's own: a 2xx JSON document, or a
 *                    non-2xx JSON error envelope with a code. (Not an HTML page,
 *                    not a transport failure, not a local failure.)
 *   pass           — the tool WORKS for this key: reachedGateway, the isError
 *                    flag is right, and the status is 2xx, 402 (served and
 *                    priced), or a 4xx validation answer from a served route
 *                    (e.g. a 404 about the NIL_UUID resource). 401/403 mean this
 *                    key cannot use the tool; 429 means it cannot use it right
 *                    now (rate-limited, after the client's own retries);
 *                    ROUTE_NOT_FOUND/ROUTE_NOT_MAPPED mean nothing serves the
 *                    route; 5xx is an outage; a local failure never reached
 *                    the gateway. All fail.
 */
export function classify(call) {
  if (call.error) {
    const code = typeof call.error.code === "number" ? call.error.code : "?";
    return { status: "ERR", marker: `jsonrpc-error ${code}`, pass: false, reachedGateway: false };
  }
  const text = call.result?.content?.[0]?.text ?? "";
  const isError = call.result?.isError === true;
  const m = /^Error (\d+): ([\s\S]*)$/.exec(text);

  if (!m && isError) {
    // Through the first 0.4.0 drafts this fell through as status "2xx" with the marker
    // "isError=true on a 2xx result", so a keyless run printed a smoke table claiming
    // GET /v1/billing had answered 2xx when no request was ever sent.
    const reason = MISSING_KEY.test(text) ? "WAVE_API_KEY is not set" : `${Buffer.byteLength(text)} bytes`;
    return { status: "none", marker: `local failure, no HTTP answer (${reason})`, pass: false, reachedGateway: false };
  }

  const numStatus = m ? Number(m[1]) : 200;
  const status = m ? m[1] : "2xx";
  const body = m ? m[2] : text;
  const bytes = Buffer.byteLength(body);

  let json;
  try {
    json = JSON.parse(body);
  } catch {
    json = undefined;
  }
  const isJson = json !== undefined && json !== null && typeof json === "object";
  // Only an ERROR envelope's code is read; a 2xx document is the caller's data and is never mined.
  const code = m && isJson ? errorCodeOf(json) : undefined;
  const isHtml = /<!DOCTYPE|<html/i.test(body);
  const unservedRoute = code === "ROUTE_NOT_FOUND" || code === "ROUTE_NOT_MAPPED";
  // A non-2xx without isError is the 0.3.0 bug. (isError on a statusless result is handled above.)
  const errorFlagWrong = m !== null && !isError;

  const reachedGateway = !isHtml && (m ? isJson && code !== undefined : isJson);
  // A 4xx from a served route is a validation answer, except the ones that say this key cannot use
  // the tool: 401/403 (not allowed) and 429 (rate-limited — a green run must not hide that).
  const keyCannotUse = numStatus === 401 || numStatus === 403 || numStatus === 429;
  const servedAnswer =
    !m || numStatus === 402 || (numStatus >= 400 && numStatus < 500 && !keyCannotUse && !unservedRoute);
  const pass = reachedGateway && !errorFlagWrong && servedAnswer;

  const marker = errorFlagWrong
    ? `isError=${isError} on a ${status} result`
    : isHtml
      ? "HTML page"
      : `${code ?? (isJson ? "json" : "non-json")} (${bytes} bytes)`;
  return { status, marker, pass, reachedGateway };
}
