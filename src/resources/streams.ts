// cspell:ignore modelcontextprotocol
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAuthHeaders, getBaseUrl } from "../auth.js";

export function registerStreamResources(server: McpServer): void {
  server.resource(
    "stream",
    "wave://streams/{id}",
    {
      description: "A WAVE stream with its configuration and status",
      mimeType: "application/json",
    },
    async (uri) => {
      const id = uri.pathname.split("/").pop();
      if (!id) {
        return {
          contents: [{ uri: uri.href, text: "Error: Missing stream ID", mimeType: "text/plain" }],
        };
      }

      const res = await fetch(`${getBaseUrl()}/api/v1/streams/${id}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        return {
          contents: [
            {
              uri: uri.href,
              text: `Error ${res.status}: ${await res.text()}`,
              mimeType: "text/plain",
            },
          ],
        };
      }

      const data = await res.json();
      return {
        contents: [
          { uri: uri.href, text: JSON.stringify(data, null, 2), mimeType: "application/json" },
        ],
      };
    },
  );
}
