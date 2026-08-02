#!/usr/bin/env bash
# Run one consumer-side type-resolution arm of the release e2e-smoke.
#
#   run-arm.sh <arm-dir> <tsconfig-name> <label>
#
# <arm-dir> is a throwaway project that already has the packed tarball
# installed (plus, for the ./sdk-server arm, the optional peer) and a
# `typecheck/` copy of this directory.
#
# Scope of the failure signal: this gate fails ONLY on diagnostics that name
# @wave-av/mcp-server or one of the probe files. tsconfig.base.json turns
# skipLibCheck OFF -- which is the whole point, it is what makes tsc look
# inside the tarball's declarations -- but that also makes it visit the
# declarations of @modelcontextprotocol/sdk and zod. An upstream regression in
# THEIR .d.ts is not this package's release gate to enforce, and a gate that
# blocks a release on somebody else's dependency is a gate that gets switched
# off. Those are reported as warnings instead.
set -uo pipefail

ARM_DIR="${1:?arm dir required}"
TSCONFIG="${2:?tsconfig name required}"
LABEL="${3:?label required}"

# Anchor the pattern on the package directory and on the probe files so a
# diagnostic inside the tarball is always ours, and one in a sibling package
# never is.
readonly OURS_RE='node_modules/@wave-av/mcp-server/|(^|/)(root|sdk-server)\.ts\('

TSC="$ARM_DIR/node_modules/.bin/tsc"
if [ ! -x "$TSC" ]; then
  echo "::error title=type-resolution arm cannot run::$LABEL: no executable tsc at $TSC - the arm never type-checked anything"
  exit 1
fi

CONFIG="$ARM_DIR/typecheck/$TSCONFIG"
if [ ! -f "$CONFIG" ]; then
  echo "::error title=type-resolution arm cannot run::$LABEL: no tsconfig at $CONFIG"
  exit 1
fi

OUT="$("$TSC" -p "$CONFIG" --pretty false 2>&1)"
RC=$?

OURS="$(printf '%s\n' "$OUT" | grep -E "$OURS_RE" || true)"

# A dependency diagnostic carries a file location ("path(line,col): error TS").
# A global error does not (TS18003 no inputs found, TS5083 cannot read file, an
# unknown compiler option): those mean the arm itself is mis-wired, not that
# somebody else's declarations regressed, and they must never be excused.
readonly DEP_DIAG_RE='^[^(]+\([0-9]+,[0-9]+\): error TS'
OTHERS="$(printf '%s\n' "$OUT" | grep -vE "$OURS_RE" | grep -E "$DEP_DIAG_RE" || true)"
GLOBAL="$(printf '%s\n' "$OUT" | grep -vE "$OURS_RE" | grep -E 'error TS' | grep -vE "$DEP_DIAG_RE" || true)"

if [ -n "$OTHERS" ]; then
  COUNT="$(printf '%s\n' "$OTHERS" | wc -l | tr -d ' ')"
  echo "::warning title=type errors outside this package ($LABEL)::$COUNT diagnostic(s) in dependencies' declarations, not in @wave-av/mcp-server - not failing the release on them"
  printf '%s\n' "$OTHERS" | head -n 20
fi

if [ -n "$OURS" ]; then
  echo "::error title=$LABEL does not type-check for a consumer::the tarball ships declarations that do not resolve in this install shape"
  printf '%s\n' "$OURS"
  exit 1
fi

# tsc can still be non-zero purely from the dependency noise above. Only
# excuse a red exit code when every reported error was attributable to a
# dependency's declarations. A global error, or a crash that produced no
# classifiable diagnostics at all, means the arm verified nothing and must
# not be reported as a pass.
if [ "$RC" -ne 0 ]; then
  if [ -n "$GLOBAL" ] || [ -z "$OTHERS" ]; then
    echo "::error title=type-resolution arm failed unclassified::$LABEL: tsc exited $RC for reasons not attributable to this package or its dependencies - the arm verified nothing"
    printf '%s\n' "$OUT" | head -n 40
    exit 1
  fi
  echo "type resolution ok: $LABEL (tsc exited $RC, entirely on declarations outside this package)"
  exit 0
fi

echo "type resolution ok: $LABEL"
