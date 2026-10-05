const { appendFileSync, readFileSync, writeFileSync } = require("node:fs");
const { basename } = require("node:path");

const args = process.argv.slice(2);
const state = JSON.parse(readFileSync(process.env.TEST_STATE, "utf8"));
const metadata = ["GITHUB_EVENT_NAME", "GITHUB_REPOSITORY_ID", "GITHUB_REPOSITORY_OWNER_ID"].map(
	(key) => process.env[key],
);
appendFileSync(process.env.TEST_LOG, `${JSON.stringify({ args, cwd: basename(process.cwd()), metadata })}\n`);
const output = (value) => console.log(JSON.stringify(value));
const name = args[1]?.split("@").slice(0, 2).join("@");
const version = state.versions[name?.slice(9)] ?? state.version;

if (["install", "run"].includes(args[0])) {
	if (state.scenario === `${args[1]}-failure`) process.exit(19);
} else if (args[0] === "publish") {
	console.log("normal npm publish stdout");
	console.error("normal npm publish stderr");
	if (state.scenario === "publish-failure" && basename(process.cwd()) === "core") process.exit(17);
	if (state.scenario === "fsx-bootstrap-failure" && basename(process.cwd()) === "fsx-authoring") process.exit(17);
	if (state.scenario === "editor-bootstrap-failure" && basename(process.cwd()) === "fsx-editor") process.exit(17);
	state.published.push(`@formbar/${basename(process.cwd())}`);
	writeFileSync(process.env.TEST_STATE, JSON.stringify(state));
} else if (args[2] === "dist-tags") {
	const firstRead = !state.tagReads.includes(name);
	state.tagReads.push(name);
	writeFileSync(process.env.TEST_STATE, JSON.stringify(state));
	if (firstRead && ["latest-error", "unexpected-absence"].includes(state.scenario)) {
		output({ error: { code: state.scenario === "unexpected-absence" ? "E404" : "E403" } });
		process.exit(1);
	}
	if (firstRead && state.scenario === "latest-malformed") {
		output(null);
		process.exit(0);
	}
	if (
		firstRead &&
		["@formbar/fsx-authoring", "@formbar/fsx-editor"].includes(name) &&
		state.scenario !== "existing" &&
		state.scenario !== "empty-fsx-tags"
	) {
		const denied =
			(name === "@formbar/fsx-authoring" && state.scenario === "fsx-auth") ||
			(name === "@formbar/fsx-editor" && state.scenario === "editor-auth");
		output({ error: { code: denied ? "E403" : "E404" } });
		process.exit(1);
	}
	output({
		rc: !firstRead && state.scenario === "wrong-rc" ? "0.23.0-rc.1" : version,
		...(!firstRead && state.scenario === "moved-latest"
			? { latest: version }
			: ["@formbar/fsx-authoring", "@formbar/fsx-editor"].includes(name)
				? {}
				: { latest: "0.22.0" }),
	});
} else if (state.scenario === "existing" || state.published.includes(name)) {
	output({
		name: state.scenario === "wrong-post-name" ? "@formbar/other" : name,
		version: state.scenario === "wrong-post-version" ? "0.23.0-rc.1" : version,
	});
} else if (state.scenario === "wrong-existing-name" || state.scenario === "wrong-existing-version") {
	output({
		name: state.scenario === "wrong-existing-name" ? "@formbar/other" : name,
		version: state.scenario === "wrong-existing-version" ? "0.23.0-rc.1" : version,
	});
} else {
	const errors = { E403: "E403", E500: "E500", unknown: "UNKNOWN", network: "ECONNRESET" };
	console.error("normal npm view error");
	if (state.scenario === "malformed") console.log("not JSON");
	else if (state.scenario === "unstructured-404") output({ code: "E404" });
	else output({ error: { code: errors[state.scenario] || "E404" } });
	process.exit(1);
}
