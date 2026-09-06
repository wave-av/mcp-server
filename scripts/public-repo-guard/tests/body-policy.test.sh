#!/usr/bin/env bash
# Fixture tests for body-policy.sh.
#
# Deliberately fixture-only: the gate is NEVER proved by writing a real leak into a
# live public PR body, because doing so would publish the exact thing it guards.
#
# The negatives here are the load-bearing half. A leak gate that blocks everything
# is trivially "correct" and useless — it gets disabled within a week. The bare
# cross-reference case below is the one that keeps this gate deployable.
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/body-policy.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# The rules use -P (PCRE2), and not every rg build ships it (Ubuntu's apt package
# does not). On such a build the scanner's fail-closed posture turns EVERY fixture
# into "want exit 1, got 2" — dozens of opaque failures indistinguishable from a
# broken gate. Probe once up front, exactly like the workflow's install step, so
# the suite fails with the actual cause named instead.
command -v rg >/dev/null 2>&1 \
  || { echo "FAIL: ripgrep (rg) is required to run these fixtures" >&2; exit 1; }
echo probe | rg -qP 'p(?=robe)' \
  || { echo "FAIL: this ripgrep build lacks PCRE2 (-P) support, which the policy rules require — install a PCRE2-enabled rg (Ubuntu noble's apt package, brew, or cargo install ripgrep --features pcre2)" >&2; exit 1; }

# The names the real gate is configured with come from an org variable; the tests
# pin their own so they are hermetic and do not depend on CI configuration. The
# pinned names are deliberately SYNTHETIC: this file is public, and hardcoding a
# real private-repo name here would publish the very fact the gate suppresses.
# The rules are shape-based, so synthetic names exercise identical code paths.
export GUARD_PRIVATE_REPOS="example-priv-alpha, example-priv-beta, example-priv-gamma"

PASS=0; FAIL=0

# expect <exit-code> <name> <body-text>
expect() {
  local want="$1" name="$2" body="$3" out rc
  printf '%s\n' "$body" > "$TMP/body.txt"
  out="$(bash "$SCRIPT" "$TMP/body.txt" 2>&1)"; rc=$?
  if [[ "$rc" == "$want" ]]; then
    PASS=$((PASS+1)); printf '  ok   %s\n' "$name"
  else
    FAIL=$((FAIL+1)); printf '  FAIL %s — want exit %s, got %s\n%s\n' "$name" "$want" "$rc" "$out"
  fi
  # The annotation is world-readable; a hit must never echo the matched text.
  if [[ "$rc" == 1 ]] && printf '%s' "$out" | grep -qF "$body"; then
    FAIL=$((FAIL+1)); printf '  FAIL %s — LEAKED the matched text into the annotation\n' "$name"
  fi
}

echo "body-policy fixtures"

# --- must BLOCK ---------------------------------------------------------------
expect 1 'private repo + credential name' \
  'Flip is live: EXAMPLE_LEASE_SECRET is bound on example-priv-alpha now.'
expect 1 'private repo + credential name, reverse order' \
  'The EXAMPLE_JOIN_SECRET was added; example-priv-beta picks it up on deploy.'
expect 1 'private repo + secret count' \
  'example-priv-alpha went from 74 secrets to 75 after this change.'
expect 1 'repo name matches case-insensitively' \
  'Flip is live: EXAMPLE_LEASE_SECRET is bound on Example-Priv-Alpha now.'
expect 1 'private repo + service binding' \
  'This adds a service binding from the worker to example-priv-gamma for settlement.'
# Regression: a leading \b before the credential-name shape made multi-underscore
# names (only matchable from their inner segment, which follows a word character)
# unmatchable in name-then-detail order, silently exempting exactly these bodies.
expect 1 'private repo then multi-segment credential name' \
  'example-priv-alpha now reads EXAMPLE_LEASE_SECRET at boot.'
expect 1 'private repo then multi-segment token name' \
  'example-priv-alpha now reads WAVE_API_TOKEN at boot.'
expect 1 'operator home path' \
  'Repro: run it from /Users/someoperator/Documents/notes and it fails.'  # enforce-ignore (fixture)
expect 1 'operator home path, capitalized username' \
  'Logs land in /Users/Someone/Library/Logs/wave.log on my machine.'  # enforce-ignore (fixture)
expect 1 'operator home path, file directly under the home dir' \
  'The crash referenced /home/someoperator/wrangler.toml directly.'  # enforce-ignore (fixture)
expect 1 'internal-only marker' \
  'Attaching the internal-only rollout plan for context.'
# The marker rules are case-insensitive on purpose: sentence-initial and shouted
# forms are how these phrases are actually written.
expect 1 'capitalized internal-only marker' \
  'Internal-only rollout plan attached.'
expect 1 'shouted do-not-share marker' \
  'DO NOT SHARE outside the team.'
expect 1 'for-internal-use marker, sentence-initial' \
  'For internal use only; see the attached doc.'
# Assembled at run time rather than written as a literal: a fixture that LOOKS like
# a live AWS key trips this repo's own pre-commit secret scanners (it did, on the
# first draft). Splitting the prefix keeps the fixture exercising the real regex
# without parking a credential-shaped string in source.
AKID_FIXTURE="AKI""A1234567890ABCDEF"
expect 1 'AWS access key id' \
  "The failing job had ${AKID_FIXTURE} configured."
expect 1 'internal tailscale IP' \
  'It resolves to 100.71.4.19 from inside the fleet.'
# The same-line bypass: mentioning the gate must never launder a credential.
# ABOUT_THE_CONTROL is prose-rules-only; a key next to "public-repo-guard" blocks.
expect 1 'credential on a line that names the control still blocks' \
  "public-repo-guard flagged ${AKID_FIXTURE} in the run linked from SECURITY.md."
expect 1 'internal IP on a line that names the control still blocks' \
  'body-policy missed 100.71.4.19 on the first pass; fixed now.'

# --- must PASS (precision — these keep the gate deployable) -------------------
expect 0 'bare private-repo cross-reference' \
  'This is the companion change to example-priv-beta#260; merge that one first.'
# Case-insensitivity must stay scoped to the repo NAME: lowercase everyday words
# ending in key/token/secret are not operational detail.
expect 0 'lowercase key-ish word near a private repo is not ops detail' \
  'Companion to example-priv-beta#260; see docs/setup_key.md for the steps.'
expect 0 'lowercase env accessor near a private repo is not ops detail' \
  'example-priv-alpha now reads the value from process.env.api_token in dev.'
expect 0 'two private repos, no operational detail' \
  'Both example-priv-alpha and example-priv-beta will need a follow-up for this.'
expect 0 'credential NAME with no private repo nearby' \
  'The handler now reads SOME_API_TOKEN from the environment instead of a literal.'
expect 0 'public runner path is not an operator path' \
  'CI checks out to /home/runner/work/repo/repo before the scan runs.'  # enforce-ignore (fixture)
# Body text is prose, and prose contains app routes: /home/<word>/ is an ordinary
# URL path shape. Only username-plus-layout (or a dot-bearing file segment) fires.
expect 0 'app route under /home/ is not an operator path' \
  'See /home/dashboard/settings route for the new page.'
expect 0 'absolute URL with a deep /home/ path is not an operator path' \
  'Deep link: https://app.wave.online/home/dashboard/settings/profile works now.'
# RANGE-talk is not a fleet address: the documentation form of the CGNAT range
# (all-zero host, or any CIDR-suffixed subnet) appears in ordinary security
# discussion — including quotes of this gate's own comments — and must pass.
expect 0 'CGNAT range in documentation form (CIDR)' \
  'The internal-ip rule covers the Tailscale CGNAT range 100.64.0.0/10 by design.'
expect 0 'CGNAT range with all-zero host, no CIDR' \
  'The fleet overlay uses 100.64.0.0 as its network address.'
expect 0 'CIDR-suffixed subnet of the range' \
  'Traffic from 100.71.4.0/24 is routed through the tunnel.'
expect 0 'talking about the control' \
  'body-policy blocks a private repo named next to a SECRET_TOKEN; that is intended.'
# Prose rules DO consult ABOUT_THE_CONTROL: a sentence describing the gate's
# behaviour with a real repo name stays discussable.
expect 0 'prose rule discussing the gate (repo + credential name)' \
  'public-repo-guard fires when example-priv-alpha appears near EXAMPLE_SECRET; see the fixtures.'
expect 0 'unquoted marker on a line that names the control' \
  'public-repo-guard blocks internal-only markers wherever they appear in body text.'
expect 0 'explicit guard:allow with a reason' \
  'Example for the docs: example-priv-alpha holds EXAMPLE_SECRET — guard:allow documented-example'
expect 0 'ordinary clean body' \
  'Bumps the draft revision and regenerates the fixtures. No behaviour change.'
# Regression: the first CI run of this job failed on its own PR, because a review
# bot edited the body to summarize the change and quoted the marker verbatim.
expect 0 'marker MENTIONED in straight quotes is a description' \
  'Blocks infra identifiers and markers (account_id, home paths, "internal-only" text).'
expect 0 'marker MENTIONED in a code span' \
  'The rule matches `internal-only` and `for internal use` in body text.'
expect 0 'marker MENTIONED in smart quotes' \
  'Blocks operator home paths and “internal-only” text.'
expect 1 'marker USED unquoted still blocks' \
  'Attaching the internal-only rollout plan; do not share outside the team.'

# --- fail closed --------------------------------------------------------------
# Invoked directly, not through expect(): expect() always materializes a file, so
# it cannot reach these paths. A gate that returns "OK" when it was handed nothing
# to scan is the failure mode this whole file exists to prevent.
for case in "no argument at all::" "nonexistent path::$TMP/does-not-exist.txt"; do
  name="${case%%::*}"; arg="${case##*::}"
  if [[ -n "$arg" ]]; then bash "$SCRIPT" "$arg" >/dev/null 2>&1; else bash "$SCRIPT" >/dev/null 2>&1; fi
  rc=$?
  if [[ "$rc" == 2 ]]; then
    PASS=$((PASS+1)); printf '  ok   %s → exit 2 (fails closed)\n' "$name"
  else
    FAIL=$((FAIL+1)); printf '  FAIL %s — want exit 2, got %s\n' "$name" "$rc"
  fi
done

# Regression: the post-scan filter stages must fail CLOSED too. They once ran
# `rg ... || true`, so a filter error (exit >= 2, e.g. a PCRE2-less rg on the -P
# allowlist filter) emptied the match list and reported CLEAN on a body whose
# main scan had already found a leak. Simulate with an rg shim that errors on
# inverted-match (-v*) invocations and delegates everything else to the real rg:
# the main scan still hits, and the gate must exit 2, never 0.
REAL_RG="$(command -v rg)"
mkdir -p "$TMP/fakebin"
cat > "$TMP/fakebin/rg" <<SHIM
#!/usr/bin/env bash
for a in "\$@"; do
  [[ "\$a" == "--" ]] && break
  [[ "\$a" == -v* ]] && exit 2
done
exec "$REAL_RG" "\$@"
SHIM
chmod +x "$TMP/fakebin/rg"
printf '%s\n' 'Attaching the internal-only rollout plan for context.' > "$TMP/body.txt"
PATH="$TMP/fakebin:$PATH" bash "$SCRIPT" "$TMP/body.txt" >/dev/null 2>&1
rc=$?
if [[ "$rc" == 2 ]]; then
  PASS=$((PASS+1)); printf '  ok   broken filter stage → exit 2 (fails closed)\n'
else
  FAIL=$((FAIL+1)); printf '  FAIL broken filter stage — want exit 2, got %s\n' "$rc"
fi

echo "  ---"
if (( FAIL > 0 )); then
  echo "  $PASS passed, $FAIL FAILED"; exit 1
fi
echo "  $PASS passed, 0 failed"
