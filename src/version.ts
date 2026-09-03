import { createRequire } from "node:module";

// One source of truth for the version the server advertises (MCP serverInfo,
// User-Agent, --version). Read from package.json at runtime so a release bump
// cannot drift from what the wire reports. From src/ and from the bundled dist/
// the relative path resolves to the package root in both cases.
const require = createRequire(import.meta.url);

export const PKG_VERSION: string = (require("../package.json") as { version: string }).version;
