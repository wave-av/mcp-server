#!/usr/bin/env bash
# Shared helpers for .buildkite/scripts/*.sh. SOURCED by every step script, never run directly.
#
# Contract every step script inherits from here:
#   - `set -euo pipefail`, and never `set -x` (xtrace would print expanded values into the build log).
#   - Never print an environment variable's VALUE. Errors name the variable, never its contents.
#   - BUILDKITE_BRANCH / BUILDKITE_MESSAGE / PR titles are untrusted data: never eval'd, never
#     interpolated into a command string.
#   - Temp dirs are job-local and removed on exit, so a disposable guest has nothing left to leak.
#   - This repository is PUBLIC. A pull request from a fork never runs here: the pipeline setting
#     `build_pull_request_forks` is false (first fence), the renderer refuses an unapproved fork PR
#     (second fence), and bk_refuse_fork_pr below refuses one again (third fence).
#   - No step in this pipeline holds a secret. bk_refuse_credentials ends the job if one leaked in.
set -euo pipefail

BK_REPO_SLUG="wave-av/mcp-server"
BK_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
export BK_REPO_ROOT

_bk_cleanup_paths=()
_bk_failed_gates=()

# The guest image's root-owned mise installs. BK_TEST_MISE_INSTALLS is a local-test override (a fake
# install tree for running these scripts off the image); it is ignored inside any Buildkite job.
BK_MISE_INSTALLS=/usr/local/share/mise/installs
if [[ -n "${BK_TEST_MISE_INSTALLS:-}" && "${BUILDKITE:-}" != "true" && -z "${BUILDKITE_JOB_ID:-}" ]]; then
  BK_MISE_INSTALLS="$BK_TEST_MISE_INSTALLS"
fi

bk_cleanup_on_exit() {
  local p
  for p in "${_bk_cleanup_paths[@]+"${_bk_cleanup_paths[@]}"}"; do
    rm -rf -- "$p"
  done
}
trap bk_cleanup_on_exit EXIT

# Buildkite log group. `---` is collapsed; bk_gate expands the group again when its gate fails.
bk_section() {
  printf -- '--- %s\n' "$*"
}

bk_err() {
  printf 'error: %s\n' "$*" >&2
}

# bk_mktemp_dir <var>: create a job-local temp dir, register it for cleanup and store its path in <var>.
# It sets a variable instead of printing the path, because a $(...) subshell would lose the cleanup
# registration.
bk_mktemp_dir() {
  local __dir
  __dir="$(mktemp -d "${TMPDIR:-/tmp}/bk.XXXXXX")"
  _bk_cleanup_paths+=("$__dir")
  printf -v "$1" '%s' "$__dir"
}

bk_require_tools() {
  local tool missing=0
  for tool in "$@"; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      bk_err "required tool '$tool' is not on PATH (guest-image prerequisite, see .buildkite/README.md)"
      missing=1
    fi
  done
  return "$missing"
}

# Third fork fence. Buildkite sets BUILDKITE_PULL_REQUEST to "false" on non-PR builds and
# BUILDKITE_PULL_REQUEST_REPO to the head repository's clone URL on PR builds. An unknown or foreign
# head repository counts as a fork, and the job ends before any repository code runs.
bk_refuse_fork_pr() {
  local pr="${BUILDKITE_PULL_REQUEST:-false}" head="${BUILDKITE_PULL_REQUEST_REPO:-}" re
  [[ "$pr" == "false" ]] && return 0
  re="^(https://|git://|ssh://git@|git@)github\.com[:/]${BK_REPO_SLUG//./\\.}(\.git)?$"
  if [[ ! "$head" =~ $re ]]; then
    bk_err "this PR's head repository is not ${BK_REPO_SLUG}; fork pull requests never build on these agents"
    return 1
  fi
}

# No step of this pipeline is allowed a credential. If the agent environment leaked one in, stop.
bk_refuse_credentials() {
  local name leaked=0
  for name in NODE_AUTH_TOKEN NPM_TOKEN GITHUB_TOKEN GH_TOKEN DOPPLER_TOKEN CLOUDFLARE_API_TOKEN \
    CLOUDFLARE_ACCOUNT_ID CF_API_TOKEN CF_ACCOUNT_ID WAVE_GATEWAY_API_KEY WAVE_API_KEY GUARD_PRIVATE_REPOS; do
    if [[ -n "${!name+x}" ]]; then
      bk_err "$name is set in this job's environment; no step of this public repository's pipeline may hold it. Remove it from the agent environment."
      leaked=1
    fi
  done
  return "$leaked"
}

# Every step script calls this first.
bk_preflight() {
  bk_refuse_fork_pr
  bk_refuse_credentials
  cd "$BK_REPO_ROOT"
}

# bk_mise_dir <tool> <version> <var>: the image's install dir for <tool>@<version>, resolved by the
# image's mise from `/` with every mise config file pointed at an empty file, so a repository
# .mise.toml or .tool-versions cannot steer it. `mise where` never installs anything. The result must
# sit under the image's root-owned mise installs.
bk_mise_dir() {
  local __tool="$1" __ver="$2" __cfg_dir __cfg __dir
  bk_require_tools mise
  bk_mktemp_dir __cfg_dir
  __cfg="${__cfg_dir}/empty.toml"
  : >"$__cfg"
  if ! __dir="$(cd / && MISE_CEILING_PATHS=/ MISE_CONFIG_FILE="$__cfg" MISE_GLOBAL_CONFIG_FILE="$__cfg" \
    MISE_SYSTEM_CONFIG_FILE="$__cfg" mise where "${__tool}@${__ver}" 2>/dev/null)"; then
    bk_err "${__tool} ${__ver} is not installed in the guest image's mise"
    return 1
  fi
  case "$__dir" in
    "${BK_MISE_INSTALLS}/${__tool}/"*) ;;
    *) bk_err "${__tool} ${__ver} resolved outside the image's mise installs; refusing"; return 1 ;;
  esac
  printf -v "$3" '%s' "$__dir"
}

# bk_use_node <major>: put the image's node <major>.x first on PATH and check it.
bk_use_node() {
  local want="$1" dir major
  bk_mise_dir node "$want" dir
  PATH="${dir}/bin:${PATH}"
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [[ "$major" != "$want" ]]; then
    bk_err "node ${want}.x was requested but node ${major} is on PATH"
    return 1
  fi
  printf 'node %s, npm %s\n' "$(node --version)" "$(npm --version)"
}

# bk_npm_ci [dir]: deterministic install from package-lock.json, public registry only, no auth.
# The job-local npmrc pins the registry, so an image-level or repository npmrc cannot redirect it.
bk_npm_ci() {
  local dir="${1:-$BK_REPO_ROOT}" npm_dir
  if [[ ! -f "${dir}/package-lock.json" ]]; then
    bk_err "package-lock.json is missing; refusing a non-deterministic install"
    return 1
  fi
  bk_mktemp_dir npm_dir
  printf '%s\n' 'registry=https://registry.npmjs.org/' >"${npm_dir}/npmrc"
  bk_section "npm ci (package-lock.json, public registry)"
  (cd "$dir" && NPM_CONFIG_USERCONFIG="${npm_dir}/npmrc" NPM_CONFIG_GLOBALCONFIG=/dev/null \
    npm ci --no-audit --no-fund)
  # npm can crash with "Exit handler never called!" and still exit 0 after failed fetches; never
  # build on a tree that is not complete.
  if ! (cd "$dir" && npm ls --depth=0 >/dev/null); then
    bk_err "npm ci left an incomplete node_modules tree (npm ls --depth=0 failed)"
    return 1
  fi
}

# bk_gate <name> <command...>: run one gate in its own log group and record a failure without
# stopping, so a single build reports every failing gate. Each gate is one external command, because
# errexit is suspended inside `||` and a multi-command body would hide an early failure.
bk_gate() {
  local name="$1"
  shift
  bk_section "$name"
  local rc=0
  "$@" || rc=$?
  if ((rc != 0)); then
    printf '^^^ +++\n'
    bk_err "gate failed: ${name} (exit ${rc})"
    _bk_failed_gates+=("${name} (exit ${rc})")
  fi
}

# Last call of a gate-running script: exits non-zero when any bk_gate failed, listing each one.
bk_gates_summary() {
  if ((${#_bk_failed_gates[@]} > 0)); then
    printf '+++ %s gate(s) failed\n' "${#_bk_failed_gates[@]}"
    printf '  - %s\n' "${_bk_failed_gates[@]}"
    return 1
  fi
  printf '+++ all gates passed\n'
}
