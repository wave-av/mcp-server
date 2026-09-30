// cspell:ignore modelcontextprotocol
// Shared registration for the `wave://<family>/{id}` resources (./streams.ts, ./productions.ts).
//
// Through 0.3.0 these were registered with `server.resource(name, "wave://streams/{id}", ...)` — a
// plain STRING, which the MCP SDK registers as ONE fixed resource whose URI literally contains
// "{id}". resources/templates/list came back empty and resources/read for any real id failed with
// -32602 "Resource ... not found". A `ResourceTemplate` is what makes `{id}` a variable.
//
// A non-2xx upstream answer is thrown, not returned as content: the SDK turns the throw into a
// JSON-RPC error, so a client never mistakes "Error 404: ..." text for the resource body. The error
// names the status and the gateway's own error code + request id — never the raw upstream body,
// because a JSON-RPC error travels further (client logs, error reporters) than a resource does.
// A 2xx that is not JSON is thrown too: the resource is declared application/json, and a holding
// page or empty body is not an entity.
import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAuthHeaders, getBaseUrl } from "../auth.js";

/** A gateway error code / request id is an identifier, not prose: anything else is dropped. */
const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,128}$/;

/**
 * `WAVE API <status>`, plus the gateway's `error.code` and `error.request_id` when the body is the
 * gateway's JSON error envelope and they are plain identifiers. Nothing else from the body.
 */
export function describeUpstreamFailure(status: number, body: string): string {
  let code: unknown;
  let requestId: unknown;
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown; request_id?: unknown } };
    code = parsed?.error?.code;
    requestId = parsed?.error?.request_id;
  } catch {
    // Not the JSON envelope: the status alone is what the caller gets.
  }
  let text = `WAVE API ${status}`;
  if (typeof code === "string" && SAFE_TOKEN.test(code)) text += ` ${code}`;
  if (typeof requestId === "string" && SAFE_TOKEN.test(requestId)) text += ` (request_id ${requestId})`;
  return text;
}

export interface EntityResourceSpec {
  /** Registered resource name, e.g. "stream". */
  readonly name: string;
  /** URI template with exactly one `{id}` variable, e.g. "wave://streams/{id}". */
  readonly uriTemplate: string;
  /** API path prefix the id is appended to, e.g. "/v1/streams". */
  readonly apiPath: string;
  readonly description: string;
}

export function registerEntityResource(server: McpServer, spec: EntityResourceSpec): void {
  server.registerResource(
    spec.name,
    new ResourceTemplate(spec.uriTemplate, { list: undefined }),
    { description: spec.description, mimeType: "application/json" },
    async (uri, variables) => {
      const raw = variables["id"];
      const id = Array.isArray(raw) ? raw[0] : raw;
      if (!id) throw new Error(`${spec.uriTemplate}: missing {id} in ${uri.href}`);

      const res = await fetch(`${getBaseUrl()}${spec.apiPath}/${encodeURIComponent(id)}`, {
        headers: getAuthHeaders(),
        // The request carries the bearer key. One GET to the validated origin and path; a redirect
        // is refused rather than followed to wherever the responder points.
        redirect: "error",
      });
      const body = await res.text();
      if (!res.ok) throw new Error(`${describeUpstreamFailure(res.status, body)} for ${uri.href}`);

      let text: string;
      try {
        text = JSON.stringify(JSON.parse(body), null, 2);
      } catch {
        throw new Error(`WAVE API ${res.status} for ${uri.href} returned a body that is not JSON`);
      }
      return { contents: [{ uri: uri.href, text, mimeType: "application/json" }] };
    },
  );
}
