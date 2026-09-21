# Exact-SHA workflow recovery

Use this runbook only when GitHub accepts a reviewed merge to `main` but omits its
normal PushEvent fan-out. Recovery is one coordinated set of CI, Publish, and Pages
runs for the same current `main` SHA and the same open recovery issue.

## Preconditions

An operator with Actions permission must first record the incident, reviewed merge
SHA, and missing runs in an open GitHub issue. A pull request number is not valid.
Run every command below in Bash with GitHub CLI 2.100.0 or newer. That version asks
the dispatch API for the created run and, in command substitution, writes only its
exact URL to standard output. GitHub can still omit run details; the commands fail
closed rather than searching a run list when that happens.

Confirm the CLI version and that `main` is still protected and has not advanced:

```bash
set -euo pipefail

GH_VERSION_OUTPUT="$(gh --version)"
[[ "$GH_VERSION_OUTPUT" =~ ^gh\ version\ ([0-9]+)\.([0-9]+)\.([0-9]+) ]] || exit 1
GH_MAJOR="${BASH_REMATCH[1]}"
GH_MINOR="${BASH_REMATCH[2]}"
(( GH_MAJOR > 2 || (GH_MAJOR == 2 && GH_MINOR >= 100) )) || exit 1

REPO=surikaterna/formbar
SHA=cce4eccf52738e5d2666c3fb734b2e76f531d514
ISSUE=103

test "$(gh api "repos/$REPO" --jq .default_branch)" = main
test "$(gh api "repos/$REPO/branches/main" --jq .protected)" = true
test "$(gh api "repos/$REPO/git/ref/heads/main" --jq .object.sha)" = "$SHA"
test "$(gh api "repos/$REPO/issues/$ISSUE" --jq .state)" = open
test "$(gh api "repos/$REPO/issues/$ISSUE" --jq 'has("pull_request")')" = false
```

Use a full 40-character lowercase SHA. Each workflow independently checks these
facts before checkout and fails closed if the workflow file, event, or live branch
does not resolve to that exact SHA.

Define helpers that reject a missing/malformed dispatch URL and validate metadata
from that exact run ID. No command in this runbook selects from a list of runs.

```bash
dispatch_run() {
  local workflow="$1"
  local run_url
  run_url="$(gh workflow run "$workflow" --repo "$REPO" --ref main \
    -f expected_main_sha="$SHA" -f recovery_issue="$ISSUE")"
  [[ "$run_url" =~ ^https://github\.com/surikaterna/formbar/actions/runs/[1-9][0-9]*$ ]] || {
    printf 'Dispatch returned no unambiguous run URL; stop recovery: %s\n' "$run_url" >&2
    return 1
  }
  printf '%s\n' "$run_url"
}

validate_run() {
  local expected_id="$1" expected_url="$2" expected_workflow="$3"
  local metadata actual_id actual_url event branch sha workflow status
  metadata="$(gh run view --repo "$REPO" "$expected_id" \
    --json databaseId,url,event,headBranch,headSha,workflowName,status \
    --jq '[.databaseId,.url,.event,.headBranch,.headSha,.workflowName,.status] | @tsv')"
  IFS=$'\t' read -r actual_id actual_url event branch sha workflow status <<<"$metadata"

  [[ "$actual_id" == "$expected_id" ]] || return 1
  [[ "$actual_url" == "$expected_url" ]] || return 1
  [[ "$event" == workflow_dispatch ]] || return 1
  [[ "$branch" == main ]] || return 1
  [[ "$sha" == "$SHA" ]] || return 1
  [[ "$workflow" == "$expected_workflow" ]] || return 1
  case "$status" in
    queued | in_progress | waiting | requested | pending | completed) ;;
    *) return 1 ;;
  esac
}
```

## Dispatch the recovery set

Run CI first and wait for it to pass. Do not start Publish or Pages after a CI
failure.

```bash
CI_RUN_URL="$(dispatch_run ci.yml)"
CI_RUN_ID="${CI_RUN_URL##*/}"
validate_run "$CI_RUN_ID" "$CI_RUN_URL" CI
gh run watch --repo "$REPO" "$CI_RUN_ID" --exit-status
```

After CI succeeds, dispatch the unchanged direct publishing workflow and Pages
workflow with the same values:

```bash
PUBLISH_RUN_URL="$(dispatch_run release.yml)"
PUBLISH_RUN_ID="${PUBLISH_RUN_URL##*/}"
validate_run "$PUBLISH_RUN_ID" "$PUBLISH_RUN_URL" Publish
gh run watch --repo "$REPO" "$PUBLISH_RUN_ID" --exit-status

PAGES_RUN_URL="$(dispatch_run pages.yml)"
PAGES_RUN_ID="${PAGES_RUN_URL##*/}"
validate_run "$PAGES_RUN_ID" "$PAGES_RUN_URL" "Deploy to GitHub Pages"
gh run watch --repo "$REPO" "$PAGES_RUN_ID" --exit-status
```

The assignment, metadata validation, and watch for each run are one uninterrupted
sequence. Stop immediately if URL capture, validation, or watching fails.

## Record evidence

After all three exact runs succeed, verify their final metadata and the successful
guard step. The guard emits `RECOVERY_EVIDENCE` only after validating its issue and
SHA, so the exact log match binds otherwise-unavailable dispatch inputs to the run.

```bash
record_run() {
  local run_id="$1" run_url="$2" workflow="$3"
  validate_run "$run_id" "$run_url" "$workflow"
  [[ "$(gh run view --repo "$REPO" "$run_id" --json conclusion --jq .conclusion)" == success ]]
  [[ "$(gh run view --repo "$REPO" "$run_id" --json jobs \
    --jq '[.jobs[].steps[] | select(.name == "Validate exact-SHA recovery") | .conclusion] | unique | join(",")')" \
    == success ]]
  gh run view --repo "$REPO" "$run_id" \
    --json databaseId,workflowName,event,headBranch,headSha,conclusion,createdAt,updatedAt,url
  gh run view --repo "$REPO" "$run_id" --log \
    | grep -F -- "RECOVERY_EVIDENCE recovery_issue=$ISSUE expected_main_sha=$SHA"
}

record_run "$CI_RUN_ID" "$CI_RUN_URL" CI
record_run "$PUBLISH_RUN_ID" "$PUBLISH_RUN_URL" Publish
record_run "$PAGES_RUN_ID" "$PAGES_RUN_URL" "Deploy to GitHub Pages"
```

Comment on the recovery issue with the three dispatch commands, the common SHA and
issue number, each run ID and URL, and each final conclusion. Also record the
Publish outcome: whether Changesets created or updated the standard release PR, or
whether preflight, OIDC publication with provenance, and reconciliation completed.
Record the Pages deployment URL. This issue comment is the audit record binding the
three independently dispatched runs into one recovery set.

## Failure and partial retry

- If a workflow fails, leave successful workflows untouched. Investigate and
  dispatch only the failed or missing workflow again with the same issue and SHA.
- Repeat all precondition commands before a retry. Use a fresh dispatch so its guard
  runs before any mutable work, capture and validate its directly returned URL with
  the same helpers, then add that exact replacement run to the evidence record.
- For a partial Publish run, inspect the release plan and npm state before retrying
  the standard workflow. Let Changesets and reconciliation handle already-published
  packages; never fill gaps with a local or token-based publish. Track delayed npm
  visibility and reconciliation hardening separately in issue #96.
- Do not close the recovery issue until all three workflows have successful,
  auditable runs.

If `main` advances, the old SHA is invalid and its guard must fail. Do not recover or
deploy the stale SHA. Abandon that recovery set and verify the newer push's normal
CI, Publish, and Pages fan-out. If the newer event is also omitted, authorize a new
recovery set for the new exact SHA and record why.

## Prohibited actions

Do not bypass this process with an arbitrary ref, input-derived checkout, rerun of an
old-SHA push workflow, force push, amended or synthetic commit, empty commit, manual
npm publish, `NPM_TOKEN`/`NODE_AUTH_TOKEN`, manual tag or GitHub release, isolated
Pages deployment, or a replacement coordinator/reusable workflow. Never dispatch
Publish or Pages before the recovery CI succeeds.

This recovery implementation changes workflows, tests, and documentation only. It
does not change a publishable package, so it intentionally has no changeset.
