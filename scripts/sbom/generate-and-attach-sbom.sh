#!/usr/bin/env bash
# SUPPLY-001 (cw #4803) — generate an SPDX SBOM for the REAL PUBLISHED npm
# tarball of a release and attach it to that release's GitHub Release assets.
#
# Runs from the `sbom` job in .github/workflows/release.yml on two paths:
#   1. tag push (after `publish` + `verify-publish` + `release` are green) —
#      TAG_NAME is the tag that was just released.
#   2. workflow_dispatch backfill — TAG_INPUT names an existing tag (or is
#      empty, meaning "the latest GitHub Release"), for versions published
#      before this SBOM job existed (starting with 0.3.0).
#
# Deliberately pulls the tarball from the npm REGISTRY (npm pack <name>@<ver>)
# rather than rebuilding from source — the SBOM must describe what a consumer
# actually installs, not a local rebuild that could drift from it.
#
# Inputs (env):
#   GH_TOKEN     - token with `contents: write` on this repo (release upload)
#   GH_REPO      - "owner/repo"
#   EVENT_NAME   - github.event_name ("push" or "workflow_dispatch")
#   REF_TAG      - github.ref_name (only meaningful when EVENT_NAME=push)
#   TAG_INPUT    - github.event.inputs.tag (only meaningful on workflow_dispatch)
#
# Exits non-zero on any failure; every external download is checksum-verified
# (syft) or pinned to a full commit SHA (the caller pins the sbom-action-free
# design: this script installs syft itself, mirroring the gitleaks install
# pattern already used by the secret-scan job).
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN required}"
: "${GH_REPO:?GH_REPO required}"
EVENT_NAME="${EVENT_NAME:-push}"
REF_TAG="${REF_TAG:-}"
TAG_INPUT="${TAG_INPUT:-}"

SYFT_VERSION="1.51.1"
SYFT_SHA256="8fcb33017a0dc1058298c923c436d19dfa68ae93968e0b423248542e3afb9fc3"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

# ---------------------------------------------------------------------------
# 1. Resolve which tag/release we're generating an SBOM for.
# ---------------------------------------------------------------------------
if [[ "$EVENT_NAME" == "workflow_dispatch" ]]; then
  if [[ -n "$TAG_INPUT" ]]; then
    TAG_NAME="$TAG_INPUT"
  else
    echo "no tag input given — resolving the latest GitHub Release"
    TAG_NAME="$(gh release view --json tagName --jq .tagName)"
  fi
else
  TAG_NAME="$REF_TAG"
fi
if [[ -z "$TAG_NAME" ]]; then
  echo "::error::could not resolve a tag to attach an SBOM to"
  exit 1
fi
echo "target tag: $TAG_NAME"

# ---------------------------------------------------------------------------
# 2. Ensure a GitHub Release exists for this tag (idempotent — create-or-use,
#    mirroring the `release` job's own pattern).
# ---------------------------------------------------------------------------
if gh release view "$TAG_NAME" >/dev/null 2>&1; then
  echo "release $TAG_NAME already exists — reusing it"
else
  echo "release $TAG_NAME does not exist — creating it (generated notes)"
  gh release create "$TAG_NAME" --title "$TAG_NAME" --generate-notes
fi

# ---------------------------------------------------------------------------
# 3. Pack the REAL PUBLISHED tarball from the npm registry.
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

# Resolve the real production dependency tree into node_modules (--omit=dev,
# --ignore-scripts: no lifecycle scripts run) so the SBOM covers what a
# consumer's `npm install` actually pulls in, not just the top-level artifact.
echo "resolving production dependencies for the SBOM"
( cd "$PKG_DIR" && npm install --omit=dev --ignore-scripts --no-audit --no-fund )

# ---------------------------------------------------------------------------
# 4. Install syft (pinned + checksum-verified — same discipline as the
#    secret-scan job's gitleaks install).
# ---------------------------------------------------------------------------
echo "installing syft v${SYFT_VERSION}"
curl -fsSL --proto '=https' --tlsv1.2 -o "$WORKDIR/syft.tar.gz" \
  "https://github.com/anchore/syft/releases/download/v${SYFT_VERSION}/syft_${SYFT_VERSION}_linux_amd64.tar.gz"
echo "${SYFT_SHA256}  $WORKDIR/syft.tar.gz" | sha256sum -c -
tar -xzf "$WORKDIR/syft.tar.gz" -C "$WORKDIR" syft
sudo install -m 0755 "$WORKDIR/syft" /usr/local/bin/syft
syft version

# ---------------------------------------------------------------------------
# 5. Generate SPDX JSON for the extracted (published) tarball contents.
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
# 6. Name + upload the asset to the release.
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
