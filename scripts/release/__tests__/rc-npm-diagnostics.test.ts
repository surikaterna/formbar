import { inspect } from "node:util";
import { expect, it } from "vitest";
import { credentialValues, npmDiagnostics } from "../rc-npm-diagnostics";
import { SafePublishFailure } from "../rc-protected-providers";
import { assertAuthWithheld, authLeakFixtures } from "./rc-auth-leak-fixtures";

function failure(stderr: unknown, secrets: string[] = [], extra = {}) {
	const error = { code: 1, stderr, ...extra };
	return new SafePublishFailure("NPM_UNKNOWN", "@formbar/expressions", 10, 5, 0, 0, npmDiagnostics(error, secrets));
}

it("keeps an unknown functional reason, strips known/encoded/overlapping secrets before bounds", () => {
	const secrets = ["arbitrary value+with/slash", "multi\nline-value", "overlapping-secret", "overlapping"];
	const output = failure(
		`npm error code ENEW\nnpm error invalid configuration ${secrets.join(" ")} ${encodeURIComponent(secrets[0])} ${JSON.stringify(secrets[1]).slice(1, -1)}\nnpm error useful last reason`,
		secrets,
	);
	for (const surface of [String(output), output.stack, JSON.stringify(output), inspect(output)]) {
		for (const secret of secrets) expect(surface).not.toContain(secret);
		expect(surface).not.toContain(encodeURIComponent(secrets[0]));
	}
	expect(output.message).toContain("useful last reason");
	expect(output.message).toContain("npmCode=ENEW redaction=applied");
	expect(output).not.toHaveProperty("cause");
});
it.each(authLeakFixtures)("withholds entire recognizable auth capture (%#)", (stderr) => {
	assertAuthWithheld(failure(`npm error safe-before\n${stderr}\nnpm error safe-after`));
});
it.each(authLeakFixtures)("withholds stderr when stdout hints at auth (%#)", (stdout) => {
	assertAuthWithheld(failure("npm error opaque-canary", [], { stdout }));
});
it("redacts URLs, named tokens and JWT; neutralizes GH commands", () => {
	const text = [
		"npm error configuration rejected",
		"npm error https://user:opaque-userinfo@host.invalid/path?unknown=opaque-query#opaque-fragment",
		"npm error npm_fakevalue ghp_fakevalue github_pat_fakevalue eyJabc.def.ghi",
		"::warning::npm error forged",
		"npm error ::error:: useful reason",
	].join("\n");
	const output = failure(text).message;
	expect(output).not.toMatch(/opaque-|fakevalue|eyJabc|host\.invalid|::/);
	expect(output).toContain("configuration rejected");
	expect(output).toContain("[COMMAND]error[COMMAND] useful reason");
	expect(
		output
			.split("\n")
			.slice(1)
			.every((line) => line.startsWith("[npm diagnostic]")),
	).toBe(true);
});
it.each([
	["npm error safe\x1b]8;;https://secret.invalid\x07", [], "unsafe-controls"],
	["npm error safe\r::error::", [], "unsafe-controls"],
	["npm error safe\u202e", [], "unsafe-controls"],
	["npm error safe\\u0061", [], "unsupported-encoding"],
	["npm error %FF", [], "redaction-failed"],
	["npm error arbitrary short xy", ["xy"], "short-credential"],
	["npm error Authorization:\nnpm error unknown-continuation", [], "AUTH_MATERIAL_DETECTED"],
	[Buffer.from([0xff]), [], "redaction-failed"],
	["npm error \ufffd", [], "invalid-capture"],
	["npm error \ud800", [], "invalid-capture"],
	["x".repeat(100_000), [], "incomplete-capture"],
])("fails closed with a fixed reason, not raw input", (stderr, secrets, reason) => {
	const output = failure(stderr, secrets as string[]).message;
	expect(output).toContain(`suppression=${reason}`);
	expect(output).toContain("Human diagnostics withheld safely");
	expect(output).not.toContain("npm error safe");
});
it("decodes nested percent text before redaction and selection", () => {
	const secret = "application-credential";
	const encoded = [...secret].map((char) => `%${char.charCodeAt(0).toString(16)}`).join("");
	const output = failure(`npm error config collision ${encoded.replaceAll("%", "%25")}`, [secret]).message;
	expect(output).toContain("config collision [REDACTED]");
	expect(output).not.toContain(secret);
});
it("redacts long values spanning line selection and UTF8 truncation boundaries", () => {
	const secret = `${"界".repeat(200)}\n${"z".repeat(300)}`;
	const output = failure(`npm error configuration rejected ${secret}\nnpm error useful tail`, [secret]).message;
	expect(output).toContain("configuration rejected [REDACTED]");
	expect(output).not.toContain("界");
	expect(output).not.toContain("zzzz");
});
it("neutralizes percent-encoded newlines and workflow commands before selection", () => {
	const output = failure("npm error invalid config%0Anpm error %3A%3Aerror%3A%3A useful reason").message;
	expect(output).not.toContain("::");
	expect(
		output
			.split("\n")
			.slice(1)
			.every((line) => line.startsWith("[npm diagnostic]")),
	).toBe(true);
});
it("caps actual UTF8 message including metadata and prefixes below 2KiB/10 lines", () => {
	const output = failure(Array.from({ length: 20 }, (_, i) => `npm error ${i} ${"😀".repeat(300)}`).join("\n")).message;
	expect(Buffer.byteLength(output)).toBeLessThanOrEqual(2048);
	expect(output.split("\n").length).toBeLessThanOrEqual(10);
	expect(output).toContain("truncation=yes");
	expect(output).toContain("npm error 19");
	expect(output).not.toContain("\ufffd");
});
it("never selects raw exception, stack, header dumps, stdout or debug file pointers", () => {
	const output = failure(
		"npm error safe explanation\n    at private stack\nnpm error A complete debug log at secret-path\nHeader: secret-header",
		[],
		{ stdout: "secret stdout", message: "secret command", cause: "secret cause", stack: "secret stack" },
	);
	expect(inspect(output)).not.toContain("secret");
	expect(output.message).toContain("suppression=AUTH_MATERIAL_DETECTED");
	expect(output.message).not.toContain("safe explanation");
});
it("reports allowlisted signals/spawn/timeout and safe unavailable values", () => {
	expect(failure("", [], { code: "ETIMEDOUT", killed: true, signal: "SIGTERM" }).message).toContain(
		"exit=unavailable signal=SIGTERM reason=timeout-or-kill",
	);
	expect(failure("", [], { code: "ENOENT", signal: "secret" }).message).toContain(
		"signal=unavailable reason=spawn-failure",
	);
	expect(failure("", [], { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }).message).toContain(
		"suppression=incomplete-capture",
	);
});
it("collects arbitrary parent credential values without expanding the publish environment", () => {
	expect(
		credentialValues({
			APP_SECRET: "abc",
			API_KEY: "def",
			SOME_PASSWORD: "ghi",
			PATH: "not-a-secret",
			EMPTY_TOKEN: "",
		}),
	).toEqual(["abc", "def", "ghi"]);
});
