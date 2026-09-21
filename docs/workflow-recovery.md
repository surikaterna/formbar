# Exact-SHA workflow recovery

Use this runbook only when GitHub accepts a reviewed merge to `main` but omits its
normal PushEvent fan-out. Recovery is one coordinated set of CI, Publish, and Pages
runs for the same current `main` SHA and the same open recovery issue.

## Preconditions

An operator with Actions permission must first record the incident, reviewed merge
SHA, and missing runs in an open GitHub issue. A pull request number is not valid.
Confirm that `main` is still protected and has not advanced:

```sh
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

## Dispatch the recovery set

Run CI first and wait for it to pass. Do not start Publish or Pages after a CI
failure.

```sh
gh workflow run ci.yml --repo "$REPO" --ref main \
  -f expected_main_sha="$SHA" -f recovery_issue="$ISSUE"
CI_RUN_ID="$(gh run list --repo "$REPO" --workflow ci.yml --event workflow_dispatch \
  --commit "$SHA" --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch --repo "$REPO" "$CI_RUN_ID" --exit-status
```

After CI succeeds, dispatch the unchanged direct publishing workflow and Pages
workflow with the same values:

```sh
gh workflow run release.yml --repo "$REPO" --ref main \
  -f expected_main_sha="$SHA" -f recovery_issue="$ISSUE"
PUBLISH_RUN_ID="$(gh run list --repo "$REPO" --workflow release.yml --event workflow_dispatch \
  --commit "$SHA" --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch --repo "$REPO" "$PUBLISH_RUN_ID" --exit-status

gh workflow run pages.yml --repo "$REPO" --ref main \
  -f expected_main_sha="$SHA" -f recovery_issue="$ISSUE"
PAGES_RUN_ID="$(gh run list --repo "$REPO" --workflow pages.yml --event workflow_dispatch \
  --commit "$SHA" --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch --repo "$REPO" "$PAGES_RUN_ID" --exit-status
```

Before watching each run, verify that the listed run was created by the command
just issued. Stop if the run ID, event, branch, or SHA is ambiguous.

## Record evidence

Collect immutable run metadata and the guard-step results:

```sh
for RUN_ID in "$CI_RUN_ID" "$PUBLISH_RUN_ID" "$PAGES_RUN_ID"; do
  gh run view --repo "$REPO" "$RUN_ID" \
    --json databaseId,workflowName,event,headBranch,headSha,conclusion,createdAt,updatedAt,url
  gh run view --repo "$REPO" "$RUN_ID" --json jobs \
    --jq '.jobs[].steps[] | select(.name == "Validate exact-SHA recovery") | {name,status,conclusion,number}'
done
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
  runs before any mutable work, then add the replacement run to the evidence record.
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
