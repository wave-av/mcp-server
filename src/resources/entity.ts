// cspell:ignore modelcontextprotocol
// Shared registration for the `wave://<family>/{id}` resources (./streams.ts, ./productions.ts).
//
// Through 0.3.0 these were registered with `server.resource(name, "wave://streams/{id}", ...)` — a
// plain STRING, which the MCP SDK registers as ONE fixed resource whose URI literally contains
// "{id}". resources/templates/list came back empty and resources/read for any real id failed with
// -32602 "Resource ... not found". A `ResourceTemplate` is what makes `{id}` a variable.
//
// A non-2xx upstream answer is thrown, not returned as content: the SDK turns the throw into a
// JSON-RPC error, so a client never mistakes "Error 404: ..." text for the resource body.
import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAuthHeaders, getBaseUrl } from "../auth.js";

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
      });
      const body = await res.text();
      if (!res.ok) throw new Error(`WAVE API ${res.status} for ${uri.href}: ${body}`);

      let text = body;
      try {
        text = JSON.stringify(JSON.parse(body), null, 2);
      } catch {
        // Not JSON: hand the body back verbatim rather than failing a 2xx read.
      }
      return { contents: [{ uri: uri.href, text, mimeType: "application/json" }] };
    },
  );
}
