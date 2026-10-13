#!/usr/bin/env bash
# Steps `smoke-install-node-20` and `smoke-install-node-22`: .github/workflows/smoke-install.yml job
# `smoke` (matrix node 20, 22; fail-fast off, so each leg is its own step). The node major comes from the
# agent-set BUILDKITE_STEP_KEY, checked against the two legs, never from the build's env.
#
#   npm ci, build, npm pack, a fresh install of the tarball from the public registry into an empty
#   project, `wave-mcp-server --version` equals the package version, and the stdio handshake +
#   tools/list matches capabilities.json (scripts/smoke-mcp.mjs ... capabilities).
#
# The workflow's last step (`--all` against the live gateway) needs WAVE_GATEWAY_API_KEY and skips itself
# when the key is absent (forks, unset). This step holds no secret, so it always takes that skip; the live
# leg is parked in .buildkite/wave-ci.deferred.json (see README, "Parked").
set -euo pipefail
# shellcheck source-path=SCRIPTDIR source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

bk_preflight
case "${BUILDKITE_STEP_KEY:-}" in
  smoke-install-node-20) node_major=20 ;;
  smoke-install-node-22) node_major=22 ;;
  *) bk_err "run this script as step smoke-install-node-20 or smoke-install-node-22 (BUILDKITE_STEP_KEY)"; exit 2 ;;
esac
bk_use_node "$node_major"

bk_npm_ci
bk_section "build and pack"
npm run build
work=""
bk_mktemp_dir work
tarball_name="$(npm pack --json --pack-destination "$work" |
  node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8'))[0].filename)")"
tarball="${work}/${tarball_name}"
[[ -f "$tarball" ]] || { bk_err "npm pack did not produce a tarball"; exit 1; }

bk_section "fresh install from tarball"
smoke="${work}/smoke"
mkdir -p "$smoke"
npmrc="${work}/npmrc"
printf '%s\n' 'registry=https://registry.npmjs.org/' >"$npmrc"
(cd "$smoke" && npm init -y >/dev/null &&
  NPM_CONFIG_USERCONFIG="$npmrc" NPM_CONFIG_GLOBALCONFIG=/dev/null \
    npm install --no-audit --no-fund "$tarball" --registry=https://registry.npmjs.org &&
  npm ls @wave-av/mcp-server)

bk_section "--version prints the package version"
expected="$(cd "$smoke" && node -p "require('./node_modules/@wave-av/mcp-server/package.json').version")"
got="$(cd "$smoke" && node node_modules/.bin/wave-mcp-server --version)"
printf 'expected=%s got=%s\n' "$expected" "$got"
[[ "$got" == "$expected" ]] || { bk_err "--version does not match package.json"; exit 1; }

bk_section "stdio handshake and tools/list"
(cd "$smoke" && node "${BK_REPO_ROOT}/scripts/smoke-mcp.mjs" node_modules/@wave-av/mcp-server/dist/index.js capabilities)

bk_section "live --all against the gateway"
printf 'skipped: WAVE_GATEWAY_API_KEY is not provided to this public pipeline (parked; see README)\n'
