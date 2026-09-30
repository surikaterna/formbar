import { expect, it } from "vitest";
import { signerPolicy } from "../rc-signed-identity";

const identity = {
	repository: "surikaterna/formbar",
	workflow: ".github/workflows/release.yml",
	ref: "refs/heads/main",
	commit: "a".repeat(40),
	runId: "12345",
	attempt: "1",
};

it("blank npm environment leaves Fulcio workflow SAN and exact signed source/run mapping intact", () => {
	const policy = signerPolicy(identity);
	const san = "https://github.com/surikaterna/formbar/.github/workflows/release.yml@refs/heads/main";
	const oidcSubject = "repo:surikaterna/formbar:ref:refs/heads/main";
	expect(new RegExp(policy.certificateIdentityURI).test(san)).toBe(true);
	expect(new RegExp(policy.certificateIdentityURI).test(oidcSubject)).toBe(false);
	expect(policy.certificateIssuer).toBe("https://token.actions.githubusercontent.com");
	expect(policy.certificateOIDs["1.3.6.1.4.1.57264.1.21"].subarray(2).toString()).toBe(
		"https://github.com/surikaterna/formbar/actions/runs/12345/attempts/1",
	);
	for (const drift of [
		{ repository: "surikaterna/other" },
		{ workflow: ".github/workflows/other.yml" },
		{ ref: "refs/heads/other" },
		{ commit: "b".repeat(40) },
		{ runId: "12346" },
		{ attempt: "2" },
	])
		expect(signerPolicy({ ...identity, ...drift })).not.toEqual(policy);
});
