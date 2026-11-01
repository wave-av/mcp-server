// Consumer-side probe for the ./sdk-server subpath.
//
// This arm runs WITH the optional peer `@anthropic-ai/claude-agent-sdk`
// installed, because dist/sdk-server.d.ts references a type from it and that
// is the documented contract: the subpath exists to hand a config object to
// the Agent SDK, so a consumer using it necessarily has the SDK (#77, option
// (a)).
//
// The root arm covers the other half -- that consumers who do NOT install the
// peer are unaffected.
export type SdkServer = typeof import("@wave-av/mcp-server/sdk-server");
