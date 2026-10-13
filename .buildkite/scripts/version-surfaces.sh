#!/usr/bin/env bash
# Steps `version-surfaces-node-20` and `version-surfaces-node-22`: .github/workflows/version-surfaces.yml
# job `version-surfaces` (matrix node 20, 22; fail-fast off, so each leg is its own step). The node major
# comes from the agent-set BUILDKITE_STEP_KEY, checked against the two legs.
#
# Two arms, as in the workflow:
#   built  -> scripts/check-version-surfaces.mjs on this working tree
#   packed -> npm pack, a clean-room install outside the checkout, the same check on the installed copy
set -euo pipefail
# shellcheck source-path=SCRIPTDIR source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

bk_preflight
case "${BUILDKITE_STEP_KEY:-}" in
  version-surfaces-node-20) node_major=20 ;;
  version-surfaces-node-22) node_major=22 ;;
  *) bk_err "run this script as step version-surfaces-node-20 or version-surfaces-node-22 (BUILDKITE_STEP_KEY)"; exit 2 ;;
esac
bk_use_node "$node_major"

bk_npm_ci
bk_section "build"
npm run build

bk_section "version surfaces (built tree)"
node scripts/check-version-surfaces.mjs

bk_section "pack and install into a clean room"
work=""
bk_mktemp_dir work
tarball_name="$(npm pack --json --pack-destination "$work" |
  node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8'))[0].filename)")"
case "$tarball_name" in
  *.tgz) ;;
  *) bk_err "npm pack --json did not report a .tgz filename"; exit 1 ;;
esac
tarball="${work}/${tarball_name}"
[[ -f "$tarball" ]] || { bk_err "npm pack did not produce a tarball"; exit 1; }
verspace="${work}/verspace"
mkdir -p "$verspace"
npmrc="${work}/npmrc"
printf '%s\n' 'registry=https://registry.npmjs.org/' >"$npmrc"
(cd "$verspace" && npm init -y >/dev/null &&
  NPM_CONFIG_USERCONFIG="$npmrc" NPM_CONFIG_GLOBALCONFIG=/dev/null \
    npm install --no-audit --no-fund "$tarball" --registry=https://registry.npmjs.org &&
  npm ls @wave-av/mcp-server)

bk_section "version surfaces (installed artifact)"
node scripts/check-version-surfaces.mjs "${verspace}/node_modules/@wave-av/mcp-server"
