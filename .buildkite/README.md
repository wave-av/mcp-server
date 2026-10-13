# mcp-server on Buildkite (shadow mode)

This directory ports this repository's GitHub Actions CI to Buildkite. Steps run on self-hosted
agents, each inside a disposable, isolated guest VM.

**Nothing under `.github/` changes.** The GH workflows stay the gate until the Buildkite pipeline has
been green for 7 consecutive days; swapping the required checks is a separate, owner-gated change.
No Buildkite pipeline exists for this repository yet, and this change does not create one.

## Fork pull requests never build here

This repository is public, so anyone can open a pull request from a fork. **A fork PR never runs on
these agents.** That rests on one pipeline setting, backed by two more checks:

1. **Pipeline setting `build_pull_request_forks: false` (the boundary).** Buildkite never starts a build
   for a fork PR, so no fork-controlled file (including the shim script in this directory) ever
   executes. The setting must stay `false` for this pipeline, and the renderer's approved-fork path (a
   `ci:approved` label) must not be enabled for it either.
2. **Render refusal.** The settings declare `"visibility": "public"`. The renderer treats any PR whose
   head repository is not `wave-av/mcp-server` as a fork (unknown counts as a fork) and refuses to render it
   without the approval label.
3. **Every repo script refuses a fork PR** (`bk_refuse_fork_pr` in `scripts/lib/common.sh`). This only
   guards against a misconfigured pipeline: a fork could edit the script, which is why (1) is the boundary.

No step holds a secret, so a same-repository PR build has nothing to leak either.
`bk_refuse_credentials` ends any step whose environment carries a credential.

## Layout

| path | role |
|---|---|
| `pipeline.yml` | The thin uploader, identical in every templated repository. Its one step runs the shim with `WAVE_JOB_ACTION=upload`, which renders the pipeline from the settings, caps-lints it with the host's read-only linter, and only then uploads it. Do not edit it. |
| shim (`*.sh` next to `pipeline.yml`) | Fixed content, identical in every templated repository, mode 755. It accepts only a full 40-hex template pin and, inside a job, runs only the guest image's verified template checkout. Do not edit it. |
| settings (`*.json` next to `pipeline.yml`) | Template `node-lib`, `visibility: public`, node 20 (as `lint.yml` pins), the `lint` / `typecheck` / `test` built-ins, seven repo-script steps. The `wave_ci` key pins the template commit `296cc0cf4faf1f06d0acd4c2a767d6c111d2adf3`. |
| `parked.json` | NOT rendered. Every parked job, with its reason and what unblocks it. |
| `scripts/<step>.sh` | The checked-in scripts the steps run. `command:` is only ever a script path (agents run with no-command-eval). |
| `scripts/lib/common.sh` | Strict mode, the fork and credential refusals, toolchain selection from the guest image's mise (never a download), a deterministic public-registry `npm ci`, the gate runner. |

## Parity: every GitHub workflow job

10 workflow files, 17 jobs. Ported: 8 jobs, as 10 steps. Parked: 9 jobs, plus two secret-bearing legs
of ported jobs. Every parked item is recorded in `parked.json`.

| workflow | job | Buildkite | notes |
|---|---|---|---|
| `_checks.yml` (via `foundation-gate.yml`) | `checks` | `gate-checks` | secret scan + file-size gate (max 800). Prints `path:line` only, never the matched line |
| `_checks.yml` | `skill-validate` | `gate-skill-validate` | python 3.12 from the image; PyYAML is baked (pinned-wheel fallback in a job venv) |
| `_checks.yml` | `verify-routes` | `gate-checks` | URL-convention gate; a no-op today (no `wrangler.toml`) |
| `foundation-gate.yml` | `gate` | the three rows above | |
| `lint.yml` | `lint` | `lint`, `typecheck`, `test` | built-in steps on node 20: `npm run lint`, `npm run type-check`, then `npm test` and `npm run check:capabilities` (CAP-001) in one step |
| `smoke-install.yml` | `smoke` (node 20, 22) | `smoke-install-node-20`, `smoke-install-node-22` | build, pack, fresh install from the public registry, `--version`, stdio handshake + tools/list vs `capabilities.json`. The live `--all` leg is parked (needs `WAVE_GATEWAY_API_KEY`) |
| `version-surfaces.yml` | `version-surfaces` (node 20, 22) | `version-surfaces-node-20`, `version-surfaces-node-22` | built-tree arm and packed clean-room arm (binds a loopback port) |
| `public-repo-guard.yml` | `guard` | `secrets-content-policy` | gitleaks 8.30.1 (image binary, version checked), ripgrep PCRE2 probe, content-policy.sh, body-policy fixtures. The private-repo-name rule is parked (needs `GUARD_PRIVATE_REPOS`) |
| `public-repo-guard-body.yml` | `body-guard` | parked | scans PR/issue/comment/review TEXT from the GitHub event; waits on a GitHub-event bridge |
| `governance-enforce.yml` | `enforce` | parked | installs `@wave-av/governance` from GitHub Packages (E403, billing); waits on a self-hosted npm registry and a read credential |
| `release.yml` | `secret-scan`, `verify`, `publish`, `verify-publish`, `release`, `sbom` | parked | tag-triggered (`v*`) npm publish (`NPM_TOKEN`), live verify (`WAVE_GATEWAY_API_KEY`), GitHub Release + SBOM (contents: write). Publishing is deploy-class and stays off until the owner enables it. Its checks already run on every build: `secret-scan` = `secrets-content-policy`; `verify` = `lint` + `typecheck` + `test` + `smoke-install-*` |
| `issue-ops-triage.yml` | `triage` | parked | event bot (issues) with a PAT + App key; waits on the event bridge |

## Differences from GH, on purpose

- **Toolchains come from the guest image, never a download.** Node 20/22 and python 3.12 resolve
  through the image's mise (`mise where`, from `/`, repo config files ignored) and must sit under the
  image's root-owned installs. gitleaks and ripgrep are the image's pinned binaries.
- **No path filters.** No ported workflow has `on.paths`, so no step has `paths`.
- **Triggers.** Buildkite builds `main` pushes and same-repository PRs. The `master`/`staging` push
  triggers and `merge_group` are dropped (no such branches; no Buildkite merge queue).
  `workflow_dispatch` becomes a manual build of `main`.
- **One run reports every failure.** A gate script runs all of its gates and summarises, where GH
  stopped at the first failing step.
- **Secret-scan output.** `gate-checks` prints `path:line` for a hit, never the line.

## Guest-image prerequisites

- linux x86_64; node 20 and 22 in the image's mise; python 3.12 in mise, with PyYAML; gitleaks 8.30.1;
  ripgrep with PCRE2; `git`, `bash`, `grep`, `sed`, `cut`, `sort`, `tr`, `wc`; loopback ports for the
  version-surfaces User-Agent listener.
- Egress: `registry.npmjs.org`, and PyPI only if PyYAML is missing from the image.

## Credentials

None. No step declares a secret, so every step runs on the no-secrets queue and the renderer's
`--allowlist-rows` prints no row. The parked legs that would need one are listed in `parked.json` for
a decision; each would be a `main_only` step.

## Caps

caps-lint passes on the uploader and on every render (PR and main: 10 steps, at most 30 worst-case jobs, one file). Every step sets `agents.queue`,
`timeout_in_minutes` and the agent-loss-only retry; no plugins, no secret values, no
`cancel_on_build_failing`.

## Run locally

With the template repository checked out at the pin as `<tpl>`:

```sh
node <tpl>/bin/<render script> --settings <settings json> --context <ctx.json> --out-dir <dir>
node <tpl>/tools/caps-lint/bin/caps-lint.mjs --warnings-as-errors <dir>/part-1.yml
node <tpl>/tools/caps-lint/bin/caps-lint.mjs --warnings-as-errors .buildkite
.buildkite/scripts/gate-checks.sh            # no install, no network
.buildkite/scripts/secrets-content-policy.sh # needs gitleaks 8.30.1 and rg on PATH
```

Steps that select a toolchain need the guest image's mise layout. Off the image, point
`BK_TEST_MISE_INSTALLS` at a tree of `<tool>/<version>/bin` directories and put a `mise` on PATH whose
`mise where <tool>@<version>` prints the matching directory (the override is ignored inside any
Buildkite job). Run every script with a clean environment: each refuses to start when a credential
variable is set.
