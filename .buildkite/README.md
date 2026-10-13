# mcp-server on Buildkite (shadow mode)

This directory ports this repository's GitHub Actions CI to Buildkite (wave-ci migration issue #57).
Steps run on self-hosted agents, each inside a disposable, isolated guest VM.

**Nothing under `.github/` changes.** The GH workflows stay the gate until the Buildkite pipeline has
been green for 7 consecutive days; swapping the required checks is a separate, operator-gated change.
No Buildkite pipeline exists for this repository yet, and this PR does not create one.

## Fork pull requests never build here

This repository is public, so anyone can open a pull request from a fork. **A fork PR never runs on
these agents.** That rests on one pipeline setting, backed by two more checks:

1. **Pipeline setting `build_pull_request_forks: false` (the boundary).** Buildkite never starts a build
   for a fork PR, so no fork-controlled file (including `.buildkite/wave-ci.sh` itself) ever executes.
   The wave-ci pipeline wrapper sends this setting explicitly and re-verifies it after every write; it
   must stay `false` for this pipeline. The wave-ci approved-fork path (a `ci:approved` label) must not
   be enabled for this pipeline either. (The wrapper refuses public repositories today, so it needs a
   reviewed change before it can create this pipeline at all.)
2. **Render refusal.** `wave-ci.json` declares `"visibility": "public"`. The renderer treats any PR whose
   head repository is not `wave-av/mcp-server` as a fork (unknown counts as a fork) and refuses to render
   it without the approval label.
3. **Every repo script refuses a fork PR** (`bk_refuse_fork_pr` in `scripts/lib/common.sh`). This only
   guards against a misconfigured pipeline: a fork could edit the script, which is why (1) is the boundary.

No step holds a secret, so a same-repository PR build has nothing to leak either.
`bk_refuse_credentials` ends any step whose environment carries a credential.

## Layout

| path | role |
|---|---|
| `pipeline.yml` | The wave-ci thin uploader, byte-identical to the wave-ci repo-kit copy. Its one step runs `wave-ci.sh` with `WAVE_JOB_ACTION=upload`, which renders the pipeline from `wave-ci.json`, caps-lints it with the host's read-only linter, and only then uploads it. Do not edit it. |
| `wave-ci.sh` | The fixed wave-ci shim, byte-identical to the repo-kit copy, mode 755. It accepts only a full 40-hex `wave_ci` pin and, inside a job, runs only the image's verified wave-ci checkout. Do not edit it. |
| `wave-ci.json` | The settings: template `node-lib`, `visibility: public`, node 20 (as `lint.yml` pins), the `lint` / `typecheck` / `test` built-ins, seven `extra_steps`. Pinned to wave-ci main `296cc0cf4faf1f06d0acd4c2a767d6c111d2adf3`. |
| `wave-ci.deferred.json` | NOT rendered. Every parked job, with its reason and blocker. |
| `scripts/<step>.sh` | The checked-in scripts the `extra_steps` run. `command:` is only ever a script path (agents run with no-command-eval). |
| `scripts/lib/common.sh` | Strict mode, the fork and credential refusals, toolchain selection from the image's mise (never a download), a deterministic public-registry `npm ci`, the gate runner. |

## Parity: every GitHub workflow job

10 workflow files, 17 jobs. Ported: 8 jobs, as 10 steps. Parked: 9 jobs, plus two secret-bearing legs
of ported jobs. Every parked item is recorded in `wave-ci.deferred.json`.

| workflow | job | Buildkite | notes |
|---|---|---|---|
| `_checks.yml` (via `foundation-gate.yml`) | `checks` | `gate-checks` | secret scan + file-size gate (max 800). Prints `path:line` only, never the matched line |
| `_checks.yml` | `skill-validate` | `gate-skill-validate` | python 3.12 from the image; PyYAML is baked (pinned-wheel fallback in a job venv) |
| `_checks.yml` | `verify-routes` | `gate-checks` | URL-convention gate; a no-op today (no `wrangler.toml`) |
| `foundation-gate.yml` | `gate` | the three rows above | |
| `lint.yml` | `lint` | `lint`, `typecheck`, `test` | wave-ci built-ins on node 20: `npm run lint`, `npm run type-check`, then `npm test` and `npm run check:capabilities` (CAP-001) in one step |
| `smoke-install.yml` | `smoke` (node 20, 22) | `smoke-install-node-20`, `smoke-install-node-22` | build, pack, fresh install from the public registry, `--version`, stdio handshake + tools/list vs `capabilities.json`. The live `--all` leg is parked (needs `WAVE_GATEWAY_API_KEY`) |
| `version-surfaces.yml` | `version-surfaces` (node 20, 22) | `version-surfaces-node-20`, `version-surfaces-node-22` | built-tree arm and packed clean-room arm (binds a loopback port) |
| `public-repo-guard.yml` | `guard` | `secrets-content-policy` | gitleaks 8.30.1 (image binary, version checked), ripgrep PCRE2 probe, content-policy.sh, body-policy fixtures. The private-repo-name rule is parked (needs `GUARD_PRIVATE_REPOS`) |
| `public-repo-guard-body.yml` | `body-guard` | parked | scans PR/issue/comment/review TEXT from the GitHub event; waits on the GitHub-event bridge (RUN-231, wave-ci #132) |
| `governance-enforce.yml` | `enforce` | parked | installs `@wave-av/governance` from GitHub Packages (E403, billing); waits on the self-hosted registry (ruling WGL-0928-18) and a read credential |
| `release.yml` | `secret-scan`, `verify`, `publish`, `verify-publish`, `release`, `sbom` | parked | tag-triggered (`v*`) npm publish (`NPM_TOKEN`), live verify (`WAVE_GATEWAY_API_KEY`), GitHub Release + SBOM (contents: write). Publishing is deploy-class and waits for Jake to name it (ruling WGL-0928-00 allows public SDK publishing; not enabled now). Its checks already run on every build: `secret-scan` = `secrets-content-policy`; `verify` = `lint` + `typecheck` + `test` + `smoke-install-*` |
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

None. No step declares a secret, so every step runs on the no-secrets queue and
`wave-ci-render.mjs --allowlist-rows` prints no row. The parked legs that would need one are listed in
`wave-ci.deferred.json` for a decision; each would be a `main_only` step.

## Caps

caps-lint passes on the uploader and on every render (PR, main): 10 steps, at most 30 worst-case jobs,
one file. Every step sets `agents.queue`, `timeout_in_minutes` (5 to 15) and the agent-loss-only retry;
no plugins, no secret values, no `cancel_on_build_failing`.

## Run locally

```sh
node <wave-ci>/bin/wave-ci-render.mjs --settings .buildkite/wave-ci.json --context <ctx.json> --out-dir <dir>
node <wave-ci>/tools/caps-lint/bin/caps-lint.mjs --warnings-as-errors <dir>/part-1.yml
node <wave-ci>/tools/caps-lint/bin/caps-lint.mjs --warnings-as-errors .buildkite
.buildkite/scripts/gate-checks.sh            # no install, no network
.buildkite/scripts/secrets-content-policy.sh # needs gitleaks 8.30.1 and rg on PATH
```

Steps that select a toolchain need the image's mise layout. Off the image, point
`BK_TEST_MISE_INSTALLS` at a tree of `<tool>/<version>/bin` directories and put a `mise` on PATH whose
`mise where <tool>@<version>` prints the matching directory (the override is ignored inside any
Buildkite job). Run every script with a clean environment: each refuses to start when a credential
variable is set.
