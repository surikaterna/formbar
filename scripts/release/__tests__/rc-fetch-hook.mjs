import { appendFileSync, readFileSync } from "node:fs";

// Test-only pre-import transport. Never loaded by the workflow or production code.
globalThis.fetch = async (input, options) => {
	const url = String(input);
	const config = JSON.parse(readFileSync(process.env.RC_TEST_RESPONSES, "utf8"));
	const oidc = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
	if (url === oidc) {
		appendFileSync(process.env.RC_TEST_REQUESTS, "OIDC\n");
		return new Response(JSON.stringify({ value: "fake" }), { status: 200 });
	}
	if (!url.startsWith("https://api.github.com/repos/surikaterna/formbar/") || options?.method !== "GET")
		throw new Error(`unexpected transport: ${url}`);
	appendFileSync(process.env.RC_TEST_REQUESTS, `${url}\n`);
	const path = url.slice("https://api.github.com/".length);
	return new Response(JSON.stringify(config[path] ?? null), {
		status: path === config.deny ? (config.denyStatus ?? 403) : path in config ? 200 : 404,
		headers: { "Content-Type": "application/json" },
	});
};
