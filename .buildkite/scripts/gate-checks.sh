#!/usr/bin/env bash
# Step `gate-checks`: the GitHub "gate / checks" and "gate / verify-routes" contexts, i.e. jobs `checks`
# and `verify-routes` of .github/workflows/_checks.yml (called by foundation-gate.yml with
# max_lines: 800). Three gates, each in its own log group, and one build reports every failure:
#   1. secret scan: the same regex, exclude dirs and allowlist plumbing as _checks.yml. It prints only
#      `path:line` for a hit, never the matched line, so a real credential that survives the regex and
#      the allowlist never lands in the build log (the GH step prints the full line).
#   2. file-size gate: tracked .ts/.tsx/.js/.py files at most MAX lines (*.d.ts and *.types.ts excluded).
#   3. verify-routes: the URL-convention gate over wrangler.toml route patterns; a no-op without one.
set -euo pipefail
# shellcheck source-path=SCRIPTDIR source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

bk_preflight
bk_require_tools grep git wc sed cut sort tr

MAX=800

# shellcheck disable=SC2016 # single-quoted on purpose: expansion happens in the inner bash -c
bk_gate "secret scan (fail-closed, allowlist-aware)" bash -c '
  HITS=$(grep -rIEn "(sk-[A-Za-z0-9]{20}|sk_(live|test)_[A-Za-z0-9]{20}|npm_[A-Za-z0-9]{30}|sbp_[a-f0-9]{40}|github_pat_[A-Za-z0-9_]{40}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30}|AIzaSy[A-Za-z0-9_-]{20}|xai-[A-Za-z0-9]{40}|xoxb-[A-Za-z0-9-]+|-----BEGIN [A-Z ]*PRIVATE KEY)" \
      --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist . | grep -v "allowlist secret" \
      | { [ -f .github/.secret-allowlist ] && grep -vFf .github/.secret-allowlist || cat; } || true)
  if [ -n "$HITS" ]; then
    echo "secret-like pattern found; do not commit credentials (value redacted, path:line below)"
    printf "%s\n" "$HITS" | cut -d: -f1,2 | sed "s/^/  - /"
    exit 1
  fi
  echo "secret-scan clean"
'

# shellcheck disable=SC2016 # single-quoted on purpose: expansion happens in the inner bash -c
bk_gate "file-size gate (<= ${MAX} lines)" env MAX="$MAX" bash -c '
  fail=0
  while IFS= read -r -d "" f; do
    grep -qxF "$f" .github/.filesize-allowlist 2>/dev/null && continue
    if ! n=$(wc -l < "$f"); then
      echo "unable to read $f"
      fail=1
      continue
    fi
    if [ "$n" -gt "$MAX" ]; then echo "$f has $n lines (> $MAX)"; fail=1; fi
  done < <(git ls-files -z "*.ts" "*.tsx" "*.js" "*.py" | grep -zvE "\.(types|d)\.ts$")
  if [ "$fail" = 0 ]; then echo "file-size gate passed (all <= $MAX lines)"; fi
  exit "$fail"
'

# shellcheck disable=SC2016 # single-quoted on purpose: expansion happens in the inner bash -c
bk_gate "verify-routes (URL convention gate)" bash -c '
  fail=0
  any=0
  while IFS= read -r f; do
    any=1
    while IFS= read -r h; do
      [ -z "$h" ] && continue
      case "$h" in
        *-edge.wave.online) echo "$f: URL $h uses the banned -edge suffix"; fail=1 ;;
        *.production.wave.online) echo "$f: URL $h uses the banned .production. label"; fail=1 ;;
        wave-*.wave.online) echo "$f: URL $h uses the banned wave- prefix"; fail=1 ;;
        *-staging.wave.online) echo "$f: URL $h uses the banned -staging suffix"; fail=1 ;;
        *.staging.wave.online | *.dev.wave.online | *.wave.online) echo "$f: URL $h ok" ;;
        *) echo "$f: URL $h unrecognized (warning)" ;;
      esac
    done < <(grep -oE "\"[a-zA-Z0-9._-]+\.wave\.online[^\"]*\"" "$f" 2>/dev/null | tr -d "\"" | cut -d/ -f1 | sort -u)
  done < <(git ls-files "*wrangler.toml" "wrangler*.toml")
  if [ "$any" = 0 ]; then echo "no wrangler.toml; verify-routes is a no-op"; exit 0; fi
  if [ "$fail" = 0 ]; then echo "verify-routes passed"; fi
  exit "$fail"
'

bk_gates_summary
