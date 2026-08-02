#!/usr/bin/env bash
# Pin the diagnostic classification in run-arm.sh.
#
# The bug this drill exists for: the excuse bucket used to be keyed on "the line
# carries a file location", on the belief that tsc reports setup errors without
# one. It does not -- `tsconfig.base.json(4,5): error TS5023` has a location --
# so a mis-wired arm that compiled nothing was downgraded to a warning and the
# gate exited 0 claiming "type resolution ok". Case 2 is that bug; it fails
# against the old regex and passes against the current one.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Mirror the two patterns under test, read straight out of run-arm.sh so this
# drill cannot drift away from the thing it pins.
eval "$(grep -E '^readonly (OURS_RE|DEP_DIAG_RE)=' "$HERE/run-arm.sh")"

fails=0

# classify <output-line> -> ours | dep | global
classify() {
  local line="$1"
  if printf '%s\n' "$line" | grep -qE "$OURS_RE"; then echo ours; return; fi
  if printf '%s\n' "$line" | grep -qE "$DEP_DIAG_RE"; then echo dep; return; fi
  echo global
}

check() {
  local want="$1" line="$2" why="$3" got
  got="$(classify "$line")"
  if [ "$got" = "$want" ]; then
    printf 'ok    %-6s %s\n' "$got" "$why"
  else
    printf 'FAIL  want=%-6s got=%-6s %s\n      line: %s\n' "$want" "$got" "$why" "$line"
    fails=$((fails + 1))
  fi
}

# 1. Our own tarball's declarations -- always fatal.
check ours "node_modules/@wave-av/mcp-server/dist/index.d.ts(3,1): error TS2304: Cannot find name 'Foo'." \
  "diagnostic inside the packed tarball"
check ours "root.ts(1,10): error TS2305: Module has no exported member 'X'." \
  "diagnostic in a probe file"

# 2. THE REGRESSION. A mis-wired tsconfig reports WITH a location and must not
#    be excused -- this is what shipped a green gate that verified nothing.
check global "tsconfig.base.json(4,5): error TS5023: Unknown compiler option 'totallyBogusOption'." \
  "unknown compiler option in the arm's own tsconfig (the fail-open bug)"
check global "tsconfig.root.json(2,3): error TS5024: Compiler option 'x' requires a value." \
  "TS5024 against the arm's own tsconfig"
check global "tsconfig.sdk-server.json(1,1): error TS6046: Argument for '--module' must be a string." \
  "TS6046 against the arm's own tsconfig"

# 3. Negative control -- a genuine third-party regression is still excused, so
#    the fix tightens the gate without simply making it fail always.
check dep "node_modules/zod/lib/types.d.ts(120,5): error TS2344: Type does not satisfy the constraint." \
  "dependency declaration, relative path"
check dep "/home/runner/work/mcp-server/arm/node_modules/@modelcontextprotocol/sdk/dist/x.d.ts(9,1): error TS2307: Cannot find module." \
  "dependency declaration, absolute runner path"

# 4. The bypass Corridor flagged: a directory that merely ENDS in the name is
#    not node_modules, and must not buy an excuse.
check global "my-node_modules/app.ts(1,1): error TS2304: Cannot find name 'Foo'." \
  "sibling dir ending in the literal name must not be excused"
check global "vendor/notnode_modules/pkg/index.d.ts(4,2): error TS2345: Argument type mismatch." \
  "path segment merely containing the name must not be excused"

# 5. Location-less global errors -- unchanged behaviour, still fatal.
check global "error TS18003: No inputs were found in config file 'tsconfig.base.json'." \
  "TS18003 with no file location"
check global "error TS5083: Cannot read file 'tsconfig.missing.json'." \
  "TS5083 with no file location"

echo
if [ "$fails" -ne 0 ]; then
  echo "classifier drill: $fails case(s) FAILED"
  exit 1
fi
echo "classifier drill: all cases pass"
