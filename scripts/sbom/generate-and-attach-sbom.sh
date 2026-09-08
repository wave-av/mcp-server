#!/usr/bin/env bash
# SUPPLY-001 (cw #4803) — generate an SPDX SBOM for the REAL PUBLISHED npm
# tarball of a release and attach it to that release's GitHub Release assets.
#
# Runs from the `sbom` job in .github/workflows/release.yml on two paths:
#   1. tag push (after `publish` + `verify-publish` + `release` are green) —
#      TAG_NAME is the tag that was just released.
#   2. workflow_dispatch backfill — for versions published before this SBOM
#      job existed (starting with 0.3.0).
#
# TAG_NAME is resolved and validated (semver-tag shape) by the caller's
# "Resolve target tag" step BEFORE this script runs, and the job checks out
# that exact tag before invoking this script -- so `package.json` /
# `package-lock.json` read below reflect the HISTORICAL tag being SBOM'd, not
# whatever `main` currently is (those can differ on a backfill: name/scope/
# deps change over time).
#
# Deliberately pulls the tarball from the npm REGISTRY (npm pack <name>@<ver>)
# rather than rebuilding from source — the SBOM must describe what a consumer
# actually installs, not a local rebuild that could drift from it. The
# registry lookup (step 2 below) is what actually PROVES the version exists;
# the release is only created/reused AFTER that proof, never before, so a bad
# backfill input can't mint an orphan tag/release with no SBOM asset.
#
# Inputs (env):
#   GH_TOKEN  - token with `contents: write` on this repo (release upload)
#   GH_REPO   - "owner/repo"
#   TAG_NAME  - the exact tag to SBOM (e.g. "v0.3.0"), already validated
#
# Exits non-zero on any failure. Scoped supply-chain guarantees: the syft
# binary is pinned to an exact version and SHA-256 checksum-verified before
# use; every production dependency pulled into node_modules is verified
# against the SRI integrity hash recorded in the tag's own package-lock.json
# via `npm ci` (falls back to unverified `npm install` only when that tag has
# no lockfile, logged as a warning). The top-level tarball itself is fetched
# over HTTPS from the npm registry by package name + exact version (no local
# checksum pin) -- the same trust boundary this workflow's `publish` job
# already relies on (OIDC trusted publishing + `--provenance`).
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN required}"
: "${GH_REPO:?GH_REPO required}"
: "${TAG_NAME:?TAG_NAME required (resolve + validate it before calling this script)}"

if [[ ! "$TAG_NAME" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([-+.][0-9A-Za-z.-]+)?$ ]]; then
  echo "::error::TAG_NAME '$TAG_NAME' does not look like a semver tag (expected vX.Y.Z)"
  exit 1
fi

SYFT_VERSION="1.51.1"
SYFT_SHA256="8fcb33017a0dc1058298c923c436d19dfa68ae93968e0b423248542e3afb9fc3"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "target tag: $TAG_NAME"

# ---------------------------------------------------------------------------
# 1. Pack the REAL PUBLISHED tarball from the npm registry. This IS the
#    registry-existence check: if this version was never published, this
#    fails here, before anything touches the GitHub Release for this tag.
# ---------------------------------------------------------------------------
PKG_VERSION="${TAG_NAME#v}"
PKG_NAME="$(node -p "require('./package.json').name")"
echo "packing $PKG_NAME@$PKG_VERSION from the npm registry"

PACK_JSON="$(npm pack "${PKG_NAME}@${PKG_VERSION}" --json --pack-destination "$WORKDIR")"
TARBALL="$(node -e "process.stdout.write(JSON.parse(process.argv[1])[0].filename)" "$PACK_JSON")"
case "$TARBALL" in
  *.tgz) ;;
  *) echo "::error::npm pack --json reported '$TARBALL', not a .tgz filename"; exit 1 ;;
esac
TARBALL_PATH="$WORKDIR/$TARBALL"
if [[ ! -f "$TARBALL_PATH" ]]; then
  echo "::error::npm pack reported '$TARBALL' but no such file exists at $TARBALL_PATH"
  exit 1
fi
echo "packed: $TARBALL_PATH"

EXTRACT_DIR="$WORKDIR/extracted"
mkdir -p "$EXTRACT_DIR"
tar -xzf "$TARBALL_PATH" -C "$EXTRACT_DIR"
# npm tarballs always extract into a top-level "package/" directory.
PKG_DIR="$EXTRACT_DIR/package"
if [[ ! -f "$PKG_DIR/package.json" ]]; then
  echo "::error::extracted tarball has no package/package.json at $PKG_DIR"
  exit 1
fi

# Defense in depth: `npm pack "name@X.Y.Z"` is an exact version spec (never a
# dist-tag/range) because PKG_VERSION was already validated as a plain
# semver string above -- but confirm the manifest we actually got matches,
# so a registry/npm-client edge case surfaces as a loud error here instead of
# silently SBOM'ing the wrong version.
EXTRACTED_VERSION="$(node -p "require('${PKG_DIR}/package.json').version")"
if [[ "$EXTRACTED_VERSION" != "$PKG_VERSION" ]]; then
  echo "::error::extracted package.json version '$EXTRACTED_VERSION' does not match requested '$PKG_VERSION'"
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. NOW that the version is proven to exist on the registry AND the packed
#    manifest's version is confirmed, ensure a GitHub Release exists for this
#    tag (idempotent — create-or-reuse, mirroring the `release` job's own
#    pattern). Never create one BEFORE step 1: a bad backfill tag must fail
#    loud, not mint an orphan tag/release.
# ---------------------------------------------------------------------------
RELEASE_VIEW_ERR="$WORKDIR/release-view.err"
if gh release view "$TAG_NAME" >/dev/null 2>"$RELEASE_VIEW_ERR"; then
  echo "release $TAG_NAME already exists — reusing it"
  # A draft release's assets are not visible on the public release page;
  # publish it so the SBOM we're about to upload is actually reachable.
  IS_DRAFT="$(gh release view "$TAG_NAME" --json isDraft --jq .isDraft)"
  if [[ "$IS_DRAFT" == "true" ]]; then
    echo "release $TAG_NAME is a draft — publishing it before attaching the SBOM"
    gh release edit "$TAG_NAME" --draft=false
  fi
elif grep -qi "release not found" "$RELEASE_VIEW_ERR"; then
  echo "release $TAG_NAME does not exist — creating it (generated notes, tag verified)"
  PRERELEASE_FLAGS=()
  if [[ "$PKG_VERSION" == *-* ]]; then
    PRERELEASE_FLAGS=(--prerelease)
  fi
  # --verify-tag: refuse to invent a git tag out of the current ref. A
  # backfill targets an EXISTING release/tag; if the tag itself is missing,
  # fail loud instead of minting a new tag at whatever commit this job
  # happens to be checked out to.
  gh release create "$TAG_NAME" --verify-tag --title "$TAG_NAME" --generate-notes "${PRERELEASE_FLAGS[@]}"
else
  echo "::error::gh release view failed for a reason other than 'release not found' — see stderr below"
  cat "$RELEASE_VIEW_ERR" >&2
  exit 1
fi

# Resolve the real production dependency tree into node_modules so the SBOM
# covers what a consumer's `npm install` actually pulls in, not just the
# top-level artifact. Prefer `npm ci` against the LOCKFILE FROM THIS EXACT
# TAG (checked out by the caller alongside this script) for exact, reproducible
# version pins -- the same lockfile the `publish` job itself used -- rather
# than re-resolving the package.json's semver RANGES against whatever the
# registry's latest-satisfying versions are today, which would let a later
# backfill run describe different (newer) dependency versions than the ones
# consumers actually received for this release.
echo "resolving production dependencies for the SBOM"
if [[ -f "package-lock.json" ]]; then
  cp "package-lock.json" "$PKG_DIR/package-lock.json"
  ( cd "$PKG_DIR" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund )
else
  echo "::warning title=no lockfile at $TAG_NAME::falling back to npm install against semver ranges — resolved versions may drift from what was originally published"
  ( cd "$PKG_DIR" && npm install --omit=dev --ignore-scripts --no-audit --no-fund )
fi

# ---------------------------------------------------------------------------
# 3. Install syft (pinned + checksum-verified — same discipline as the
#    secret-scan job's gitleaks install). Bounded retries/timeouts so a
#    stalled connection fails fast instead of blocking until the job timeout.
# ---------------------------------------------------------------------------
echo "installing syft v${SYFT_VERSION}"
curl -fsSL --proto '=https' --tlsv1.2 \
  --retry 3 --retry-delay 2 --retry-all-errors \
  --connect-timeout 10 --max-time 120 \
  -o "$WORKDIR/syft.tar.gz" \
  "https://github.com/anchore/syft/releases/download/v${SYFT_VERSION}/syft_${SYFT_VERSION}_linux_amd64.tar.gz"
echo "${SYFT_SHA256}  $WORKDIR/syft.tar.gz" | sha256sum -c -
tar -xzf "$WORKDIR/syft.tar.gz" -C "$WORKDIR" syft
sudo install -m 0755 "$WORKDIR/syft" /usr/local/bin/syft
syft version

# ---------------------------------------------------------------------------
# 4. Generate SPDX JSON for the extracted (published) tarball contents.
# ---------------------------------------------------------------------------
SPDX_RAW="$WORKDIR/raw.spdx.json"
syft scan "dir:${PKG_DIR}" -o "spdx-json=${SPDX_RAW}"

PKG_COUNT="$(node -e "const s=require(process.argv[1]); process.stdout.write(String((s.packages||[]).length))" "$SPDX_RAW")"
if [[ "$PKG_COUNT" -lt 1 ]]; then
  echo "::error::generated SPDX has an empty packages[] array — refusing to publish an empty SBOM"
  exit 1
fi
echo "SPDX packages[] count: $PKG_COUNT"

# ---------------------------------------------------------------------------
# 5. Name + upload the asset to the release.
# ---------------------------------------------------------------------------
BASENAME="$(basename "$PKG_NAME")"
ASSET_NAME="${BASENAME}-${PKG_VERSION}.spdx.json"
cp "$SPDX_RAW" "$WORKDIR/$ASSET_NAME"

echo "uploading $ASSET_NAME to release $TAG_NAME"
gh release upload "$TAG_NAME" "$WORKDIR/$ASSET_NAME" --clobber

ASSETS="$(gh release view "$TAG_NAME" --json assets --jq '[.assets[].name] | join(" ")')"
case "$ASSETS" in
  *"$ASSET_NAME"*) ;;
  *)
    echo "::error::$ASSET_NAME missing from release $TAG_NAME after upload"
    exit 1
    ;;
esac
echo "SUPPLY-001: $ASSET_NAME attached to release $TAG_NAME."
