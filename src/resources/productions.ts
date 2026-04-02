// cspell:ignore modelcontextprotocol
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAuthHeaders, getBaseUrl } from "../auth.js";

export function registerProductionResources(server: McpServer): void {
  server.resource(
    "production",
    "wave://productions/{id}",
    { description: "A WAVE studio production session", mimeType: "application/json" },
    async (uri) => {
      const id = uri.pathname.split("/").pop();
      if (!id) {
        return {
          contents: [
            { uri: uri.href, text: "Error: Missing production ID", mimeType: "text/plain" },
          ],
        };
      }

      const res = await fetch(`${getBaseUrl()}/api/v1/productions/${id}`, {
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
