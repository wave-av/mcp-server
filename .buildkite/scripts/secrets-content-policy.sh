#!/usr/bin/env bash
# Step `secrets-content-policy`: the GitHub "Secrets + content policy" context, job `guard` of
# .github/workflows/public-repo-guard.yml. The TREE scan only:
#   1. gitleaks over the published working tree (--no-git), with the repository's .gitleaks.toml.
#   2. scripts/public-repo-guard/content-policy.sh, the WAVE-specific leak gate, run from the checkout
#      exactly as the GH job runs it (after checking that the image's ripgrep has PCRE2).
#   3. Where the workflow has it, the body-policy fixture self-test.
#
# Differences from the GH job, on purpose:
#   - gitleaks is the guest image's baked binary, which must report exactly GITLEAKS_VERSION (the same
#     pin and sha256-checked release the workflow downloads). Nothing is downloaded in the job.
#   - GUARD_PRIVATE_REPOS is NOT provided. On GH it is an org-level Actions variable; here it would be a
#     job secret, and this public repository's steps hold none. content-policy.sh skips that one rule
#     when the variable is unset (the same behaviour as a fork PR on GH). The rule's main-only leg is
#     parked in .buildkite/wave-ci.deferred.json until a secrets-allowlist row is decided.
#   - The body scan of PR, issue, comment and review TEXT (the workflow's event-driven body guard) has
#     no Buildkite trigger; it waits on the GitHub-event bridge (see README, "Parked").
set -euo pipefail
# shellcheck source-path=SCRIPTDIR source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

GITLEAKS_VERSION="8.30.1"
# 1 where the workflow's guard job runs scripts/public-repo-guard/tests/body-policy.test.sh.
BODY_POLICY_SELFTEST=1

bk_preflight
bk_require_tools gitleaks rg bash

got="$(gitleaks version 2>/dev/null || true)"
if [[ "${got#v}" != "$GITLEAKS_VERSION" ]]; then
  bk_err "gitleaks ${GITLEAKS_VERSION} is required (the workflow's pin); the image reports '${got}'"
  exit 1
fi
printf 'gitleaks %s\n' "$got"

bk_gate "gitleaks (secret scan, published tree)" \
  gitleaks detect --no-git --source . --config .gitleaks.toml --redact --no-banner --exit-code 1

# The policy rules need ripgrep with PCRE2 (-P); the image's static rg is built with it.
bk_gate "ripgrep PCRE2 support" bash -c "echo probe | rg -qP 'p(?=robe)'"

bk_gate "content policy (WAVE trade-secret / internal-leak gate)" \
  bash scripts/public-repo-guard/content-policy.sh .

# The workflow's last guard step: the body-policy fixtures (the body scanner itself is event-driven).
if [[ "$BODY_POLICY_SELFTEST" == 1 ]]; then
  bk_gate "body policy self-test (fixtures)" bash scripts/public-repo-guard/tests/body-policy.test.sh
fi

bk_gates_summary
