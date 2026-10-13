#!/usr/bin/env bash
# Step `gate-skill-validate`: the GitHub "gate / skill-validate" context, job `skill-validate` of
# .github/workflows/_checks.yml. Validates every tracked *SKILL.md's frontmatter: name equals the
# directory name, a non-empty description, no empty allowed-tools/hooks, no duplicate keys. A no-op
# pass when the repository has none. The validator body is the workflow's inline python, unchanged.
#
# Python comes from the guest image's mise at the version the workflow pins (PY_VERSION). PyYAML is
# baked into every image python; when it is missing, a job-local venv installs the pinned wheel
# (binary only) instead of the workflow's unpinned `pip install pyyaml`.
set -euo pipefail
# shellcheck source-path=SCRIPTDIR source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

PY_VERSION="3.12"
PYYAML_VERSION="6.0.3"

bk_preflight
bk_require_tools git

py_dir=""
bk_mise_dir python "$PY_VERSION" py_dir
py="${py_dir}/bin/python3"
"$py" --version

if ! "$py" -c 'import yaml' >/dev/null 2>&1; then
  bk_section "PyYAML not in the image python; job-local venv with pyyaml==${PYYAML_VERSION} (wheel only)"
  venv=""
  bk_mktemp_dir venv
  "$py" -m venv "${venv}/py"
  "${venv}/py/bin/python" -m pip install --quiet --disable-pip-version-check --only-binary=:all: \
    "pyyaml==${PYYAML_VERSION}"
  py="${venv}/py/bin/python"
fi

bk_gate "skill frontmatter gate" "$py" - <<'PY'
import sys, os, re, subprocess
import yaml
allf = subprocess.run(["git","ls-files","*SKILL.md"], capture_output=True, text=True).stdout.splitlines()
# Only validate invocable skills; skip nested reference/vendored SKILL.md.
skip = ("/references/", "/_external/", "/_consolidated", "/_archived", "/node_modules/", "/dist/")
files = [f for f in allf if not any(s in "/" + f for s in skip)]
if not files:
    print("no SKILL.md in repo — skill gate is a no-op"); sys.exit(0)
errs = []
for p in files:
    d = os.path.basename(os.path.dirname(p))
    t = open(p, encoding="utf-8", errors="replace").read()
    m = re.match(r"^---\s*\n(.*?)\n---", t, re.S)
    if not m:
        errs.append(f"{p}: no frontmatter block"); continue
    fm = m.group(1)
    seen, dup = set(), set()
    for line in fm.split("\n"):
        k = re.match(r"^([A-Za-z_][\w-]*):", line)
        if k: (dup if k.group(1) in seen else seen).add(k.group(1))
    if dup: errs.append(f"{p}: duplicate frontmatter keys: {', '.join(sorted(dup))}")
    try:
        data = yaml.safe_load(fm) or {}
    except yaml.YAMLError as e:
        errs.append(f"{p}: invalid YAML frontmatter: {e}"); continue
    if not isinstance(data, dict):
        errs.append(f"{p}: frontmatter is not a mapping"); continue
    if data.get("name") != d:
        errs.append(f"{p}: name '{data.get('name')}' != directory '{d}'")
    if not str(data.get("description") or "").strip():
        errs.append(f"{p}: missing/empty description")
    for key in ("allowed-tools", "hooks"):
        if key in data:
            v = data[key]
            if v is None or (isinstance(v, (list, dict, str)) and len(v) == 0):
                errs.append(f"{p}: '{key}' present but EMPTY")
for e in errs:
    print(f"::error::{e}")
print(f"validated {len(files)} skills — {len(errs)} errors")
sys.exit(1 if errs else 0)
PY

bk_gates_summary
