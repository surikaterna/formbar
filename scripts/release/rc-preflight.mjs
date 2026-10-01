var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);

// scripts/release/rc-reviewed-plan.ts
import { createHash } from "node:crypto";
function checkPre(pre) {
  const state = pre;
  if (!state || state.mode !== "pre" || state.tag !== "rc" || !same(state.changesets, consumed) || !same(Object.entries(state.initialVersions ?? {}).sort(), Object.entries(initialVersions).sort()))
    throw new Error("Unexpected Changesets prerelease state or consumed IDs");
}
function checkManifest(name, value) {
  const pkg = value;
  if (!rcPackages.includes(name) || !pkg || pkg.name !== `@formbar/${name}` || pkg.version !== rcVersion || pkg.private !== undefined || pkg.publishConfig !== undefined)
    throw new Error(`invalid RC manifest ${name}`);
  const deps = pkg.dependencies;
  const peers = pkg.peerDependencies;
  const actual = Object.entries(deps ?? {}).filter(([key]) => key.startsWith("@formbar/"));
  const expected = rcEdges[name].map((edge) => [`@formbar/${edge}`, `^${rcVersion}`]);
  if (!same(actual.sort(), expected.sort()) || Object.keys(peers ?? {}).some((key) => key.startsWith("@formbar/")))
    throw new Error(`invalid RC dependency graph: ${name}`);
}
function checkChangelog(name, text) {
  const data = Buffer.from(text);
  const blob = createHash("sha1").update(`blob ${data.length}\x00`).update(data).digest("hex");
  if (blob !== changelogBlobs[name])
    throw new Error(`changelog ${name} drift`);
}
var rcVersion = "0.23.0-rc.0", rcPackages, rcEdges, initialVersions, consumed, changelogBlobs, same = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
var init_rc_reviewed_plan = __esm(() => {
  rcPackages = [
    "expressions",
    "core",
    "declarative",
    "from-schema",
    "react",
    "arbiter",
    "react-schema"
  ];
  rcEdges = {
    expressions: [],
    core: ["expressions"],
    declarative: ["core", "expressions"],
    "from-schema": ["core", "declarative", "expressions"],
    react: ["core", "expressions"],
    arbiter: ["core", "expressions"],
    "react-schema": ["core", "declarative", "from-schema", "react"]
  };
  initialVersions = {
    "@formbar/demos": "0.0.0",
    "@formbar/arbiter": "0.22.0",
    "@formbar/core": "0.22.3",
    "@formbar/declarative": "0.22.1",
    "@formbar/expressions": "0.14.3",
    "@formbar/from-schema": "0.22.0",
    "@formbar/react": "0.22.0",
    "@formbar/react-schema": "0.22.0"
  };
  consumed = [
    "bound-noop-witness",
    "certified-object-descendants",
    "checked-bound-handler",
    "final-owned-generation",
    "final-retained-attempt-gate",
    "original-bound-attempt-receipt",
    "owned-disposal-settlement",
    "owned-scheduling-boundary",
    "owned-semantic-epoch",
    "public-bound-omission",
    "react-omission-attempt-ui",
    "real-bound-guarded-bridge",
    "real-bound-omission-supplier",
    "reference-codec",
    "scoped-async-core",
    "scoped-async-declarative",
    "scoped-async-from-schema",
    "scoped-async-react-schema",
    "scoped-final-async",
    "scoped-ownership-receipt",
    "scoped-validation-public-types",
    "unified-issue-ownership",
    "validated-hidden-submission-policy"
  ];
  changelogBlobs = {
    expressions: "be08f4e1336173f88cd3d935831f54f7255cba0e",
    core: "7bedaf047cdfca22ea671c24852bbce304be0384",
    arbiter: "2b7e0c86afb713009762be3b720f04431b8915b5",
    declarative: "32394386b02997398384b925c6a204909f5a23ff",
    "from-schema": "8afd4c3f2c1aa351263d59b61b2d7a01d50f42cc",
    react: "79d8556af213b8b072b8fcb6768ac40ce093eeb5",
    "react-schema": "f66832eddc616c87a6f5fe593bb55bd4906e169c"
  };
});

// scripts/release/live-evidence-shape.ts
function object(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Missing GitHub object");
  return value;
}
function array(value) {
  if (!Array.isArray(value))
    throw new Error("Missing GitHub array");
  return value;
}
function requireThat(condition, message) {
  if (!condition)
    throw new Error(`RC evidence denied: ${message}`);
}
function sameSet(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((item) => typeof item === "string" && expected.includes(item)) && new Set(actual).size === actual.length;
}
var repo = "repos/surikaterna/formbar", sha;
var init_live_evidence_shape = __esm(() => {
  init_rc_reviewed_plan();
  sha = /^[0-9a-f]{40}$/;
});

// scripts/release/github-read.ts
function createGitHubRead(token, fetcher = fetch) {
  requireThat(token.length > 0, "missing GitHub read token");
  return {
    async get(path) {
      requireThat(path.startsWith(`${repo}/`) && /^[a-zA-Z0-9_/?=&.\-]+$/.test(path), "invalid GitHub REST path");
      const response = await fetcher(`https://api.github.com/${path}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28"
        }
      });
      requireThat(response.ok, `GitHub REST ${response.status} for ${path}`);
      return response.json();
    }
  };
}
var init_github_read = __esm(() => {
  init_live_evidence_shape();
});

// scripts/release/live-policy.ts
async function verifyMainRules(api) {
  const ruleset = object(await api.get(`${repo}/rulesets/24103769`));
  requireThat(ruleset.id === 24103769, "main ruleset identity not verified");
  requireThat(ruleset.enforcement === "active", "main ruleset enforcement not active");
  requireThat(ruleset.target === "branch", "main ruleset target not branch");
  requireThat(ruleset.source_type === "Repository", "main ruleset source not repository");
  requireThat(ruleset.conditions !== null && typeof ruleset.conditions === "object" && !Array.isArray(ruleset.conditions), "main ruleset ref scope unreadable");
  const refName = object(ruleset.conditions).ref_name;
  requireThat(refName !== null && typeof refName === "object" && !Array.isArray(refName), "main ruleset ref scope unreadable");
  const conditions = object(refName);
  requireThat(sameSet(conditions.include, ["refs/heads/main"]) && sameSet(conditions.exclude, []), "main ruleset ref scope not verified");
  const bypass = ruleset.bypass_actors;
  if (bypass === null || !("bypass_actors" in ruleset)) {
    console.warn("main ruleset bypass actors UNVERIFIABLE (redacted); external admin proof required");
  } else {
    requireThat(Array.isArray(bypass), "main ruleset bypass actors malformed");
    requireThat(bypass.length === 0, "main ruleset bypass actors changed");
  }
  requireThat(ruleset.current_user_can_bypass === "never", "main ruleset caller bypass not verified");
  await verifyRuleDetails(api, ruleset);
}
async function verifyRuleDetails(api, ruleset) {
  const rules = array(ruleset.rules).map(object);
  const required = ["deletion", "non_fast_forward", "pull_request", "required_status_checks"];
  requireThat(sameSet(rules.map((rule) => rule.type), required), "main ruleset types changed");
  const pr = object(rules.find((rule) => rule.type === "pull_request")?.parameters);
  requireThat(pr.required_approving_review_count === 0 && sameSet(pr.required_reviewers, []) && sameSet(pr.allowed_merge_methods, ["merge", "squash", "rebase"]), "PR-only main policy changed");
  const checks = object(rules.find((rule) => rule.type === "required_status_checks")?.parameters);
  requireThat(array(checks.required_status_checks).length === 1 && object(array(checks.required_status_checks)[0]).context === "ci" && object(array(checks.required_status_checks)[0]).integration_id === 15368, "required ci app changed");
  const effective = array(await api.get(`${repo}/rules/branches/main`)).map(object);
  requireThat(sameSet(effective.filter((rule) => rule.ruleset_id === 24103769).map((rule) => rule.type), required), "main ruleset not effective");
  const effectivePr = object(effective.find((rule) => rule.ruleset_id === 24103769 && rule.type === "pull_request")?.parameters);
  const effectiveChecks = object(effective.find((rule) => rule.ruleset_id === 24103769 && rule.type === "required_status_checks")?.parameters);
  requireThat(JSON.stringify(effectivePr) === JSON.stringify(pr) && JSON.stringify(effectiveChecks) === JSON.stringify(checks), "effective main parameters differ");
}
async function verifyLivePolicy(api) {
  await verifyMainRules(api);
}
async function verifyEligibleActors(api) {
  const permission = object(await api.get(`${repo}/collaborators/spralle/permission`));
  requireThat(object(permission.user).id === 806157 && permission.permission === "admin", "actor eligibility changed");
}
async function verifyCi(api, commit) {
  const checks = [];
  for (let page = 1;page <= 20; page++) {
    const response = object(await api.get(`${repo}/commits/${commit}/check-runs?per_page=100&page=${page}`));
    const batch = array(response.check_runs);
    checks.push(...batch);
    requireThat(typeof response.total_count === "number" && response.total_count >= checks.length, "ambiguous ci pagination");
    if (checks.length === response.total_count)
      break;
    requireThat(batch.length === 100 && page < 20, "incomplete ci pagination");
  }
  const matching = checks.map(object).filter((check) => check.name === "ci" && object(check.app).id === 15368);
  requireThat(matching.length === 1 && matching[0].head_sha === commit && matching[0].status === "completed" && matching[0].conclusion === "success", "exact-SHA ci not uniquely green");
}
var init_live_policy = __esm(() => {
  init_live_evidence_shape();
});

// scripts/release/live-evidence.ts
async function fetchRcEvidence(api, witness) {
  verifyWitness(witness);
  await verifyRunAndMain(api, witness);
  await verifyEligibleActors(api);
  await verifyLivePolicy(api);
  await verifyCi(api, witness.expectedSha);
}
function verifyWitness(witness) {
  requireThat(Number.isSafeInteger(witness.runId) && witness.runId > 0 && witness.attempt === 1 && witness.actor === "spralle" && witness.senderId === 806157 && witness.repository === "surikaterna/formbar" && witness.repositoryId === "1245476636" && witness.repositoryOwnerId === "9478205" && witness.event === "workflow_dispatch" && witness.ref === "refs/heads/main" && witness.refProtected === "true" && witness.workflowRef === "surikaterna/formbar/.github/workflows/release.yml@refs/heads/main" && sha.test(witness.expectedSha) && sha.test(witness.checkoutTree) && [witness.workflowSha, witness.eventSha, witness.checkoutSha].every((s) => s === witness.expectedSha), "runtime actor, sender, workflow, ref or checkout differs");
}
async function verifyRunAndMain(api, witness) {
  const run = object(await api.get(`${repo}/actions/runs/${witness.runId}`));
  const repository = object(run.repository);
  const owner = object(repository.owner);
  requireThat(run.id === witness.runId && repository.full_name === witness.repository && repository.id === 1245476636 && owner.login === "surikaterna" && owner.id === 9478205 && run.event === "workflow_dispatch" && run.run_attempt === 1 && object(run.actor).id === 806157 && object(run.triggering_actor).id === 806157 && run.head_sha === witness.expectedSha && run.head_branch === "main" && run.path === ".github/workflows/release.yml" && run.workflow_id === 349257014 && object(run.head_commit).tree_id === witness.checkoutTree, "GitHub run identity changed");
  const main = object(await api.get(`${repo}/branches/main`));
  requireThat(object(main.commit).sha === witness.expectedSha, "main advanced");
  const gitCommit = object(await api.get(`${repo}/git/commits/${witness.expectedSha}`));
  requireThat(object(gitCommit.tree).sha === witness.checkoutTree, "main tree changed");
}
var init_live_evidence = __esm(() => {
  init_live_evidence_shape();
  init_live_policy();
});

// scripts/release/rc-attempt-fence.ts
var init_rc_attempt_fence = () => {};

// scripts/release/rc-registry-proof.ts
function requireProof(condition, reason) {
  if (!condition)
    throw new Error(reason);
}
function sourceCheck(source) {
  requireProof(sha2.test(source.commit) && sha2.test(source.tree), "invalid audited commit/tree");
  checkPre(source.pre);
  for (const entries of [source.manifests, source.changelogs, source.artifacts, source.initialLatest])
    requireProof(JSON.stringify(Object.keys(entries).sort()) === JSON.stringify([...names].sort()), "unexpected RC package set");
  for (const name of names) {
    checkManifest(name, source.manifests[name]);
    requireProof(source.initialLatest[name] === initialVersions[`@formbar/${name}`], `stable latest ${name} drift`);
    requireProof(source.changelogs[name]?.startsWith(`# @formbar/${name}

## ${version}
`), `changelog ${name} drift`);
  }
}
var names, sha2, version;
var init_rc_registry_proof = __esm(() => {
  init_rc_reviewed_plan();
  names = rcPackages;
  sha2 = /^[a-f0-9]{40}$/;
  version = rcVersion;
});

// scripts/release/rc-source-local.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
function json(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function loadRcSource(root, sha3, tree) {
  const manifests = {};
  const changelogs = {};
  for (const name of rcPackages) {
    const directory = resolve(root, "packages", name);
    const manifest = json(resolve(directory, "package.json"));
    if (["prepack", "prepare", "postpack", "publish", "prepublishOnly"].some((key) => manifest.scripts?.[key]))
      throw new Error("unexpected npm pack lifecycle script");
    manifests[name] = manifest;
    changelogs[name] = readFileSync(resolve(directory, "CHANGELOG.md"), "utf8");
    checkChangelog(name, changelogs[name]);
  }
  const pre = json(resolve(root, ".changeset/pre.json"));
  const source = {
    commit: sha3,
    tree,
    pre,
    manifests,
    changelogs,
    artifacts: Object.fromEntries(rcPackages.map((name) => [name, undefined])),
    initialLatest: Object.fromEntries(rcPackages.map((name) => [name, pre.initialVersions[`@formbar/${name}`]]))
  };
  sourceCheck(source);
  return source;
}
var init_rc_source_local = __esm(() => {
  init_rc_registry_proof();
  init_rc_reviewed_plan();
});

// scripts/release/rc-run-authority.ts
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 1e4, maxBuffer: 1e5 }).trim();
}
function checkout(root) {
  const commit = git(root, "rev-parse", "HEAD");
  const tree = git(root, "rev-parse", "HEAD^{tree}");
  if (!sha3.test(commit) || !sha3.test(tree) || git(root, "status", "--porcelain") !== "")
    throw new Error("RC checkout is not clean and pinned");
  return { sha: commit, tree };
}
async function witness(root) {
  const env = process.env;
  if (!env.GITHUB_EVENT_PATH)
    throw new Error("GitHub-generated event path missing");
  const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, "utf8"));
  const source = checkout(root);
  const runId = Number(env.GITHUB_RUN_ID);
  if (!Number.isSafeInteger(runId) || runId <= 0 || !sha3.test(event.inputs?.expected_main_sha ?? "") || event.inputs?.expected_main_sha !== source.sha)
    throw new Error("run ID or expected_main_sha differs from checkout");
  return {
    runId,
    attempt: Number(env.GITHUB_RUN_ATTEMPT),
    actor: env.GITHUB_ACTOR ?? "",
    senderId: event.sender?.id ?? -1,
    repository: env.GITHUB_REPOSITORY ?? "",
    repositoryId: env.GITHUB_REPOSITORY_ID ?? "",
    repositoryOwnerId: env.GITHUB_REPOSITORY_OWNER_ID ?? "",
    event: env.GITHUB_EVENT_NAME ?? "",
    ref: env.GITHUB_REF ?? "",
    refProtected: env.GITHUB_REF_PROTECTED ?? "",
    workflowRef: env.GITHUB_WORKFLOW_REF ?? "",
    workflowSha: env.GITHUB_WORKFLOW_SHA ?? "",
    eventSha: env.GITHUB_SHA ?? "",
    checkoutSha: source.sha,
    checkoutTree: source.tree,
    expectedSha: source.sha
  };
}
async function validate(root, token) {
  const run = await witness(root);
  loadRcSource(root, run.expectedSha, run.checkoutTree);
  await fetchRcEvidence(createGitHubRead(token), run);
  const again = await witness(root);
  if (JSON.stringify(run) !== JSON.stringify(again))
    throw new Error("RC checkout or run changed during validation");
  return run;
}
async function verifyProtectedRun(root, githubReadToken) {
  const run = await validate(root, githubReadToken);
  const authority = Object.freeze({});
  bindings.set(authority, {
    root,
    token: githubReadToken,
    runId: run.runId,
    sha: run.expectedSha,
    tree: run.checkoutTree
  });
  return authority;
}
var bindings, sha3;
var init_rc_run_authority = __esm(() => {
  init_github_read();
  init_live_evidence();
  init_rc_attempt_fence();
  init_rc_reviewed_plan();
  init_rc_source_local();
  bindings = new WeakMap;
  sha3 = /^[0-9a-f]{40}$/;
});

// scripts/release/rc-preflight-entry.ts
init_rc_run_authority();
async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token)
    throw new Error("read-only GitHub credential required");
  await verifyProtectedRun(process.cwd(), token);
}
main().catch((error) => {
  console.error("RC preflight DENIED:", error);
  process.exitCode = 1;
});
