import { Console } from "node:console";
import { Writable } from "node:stream";
import { inspect } from "node:util";
import { expect } from "vitest";

// Independent auditor repros plus delimiter/encoding variants; never real credentials.
export const authLeakFixtures = [
	"npm error Bearer\topaque-canary",
	'npm error {"token":"opaque-canary"}',
	"npm error Authorization: Bearer\nnpm error opaque-canary",
	"npm error _authToken = first-part\nnpm error opaque-canary",
	"npm error Bearer%09opaque-canary",
	"npm error bEaReR\u00a0opaque-canary",
	"npm error AUTHORIZATION\u2003: Bearer\nnpm error opaque-canary",
	"npm error 'ToKeN' = 'opaque-canary'",
	'npm error {"access_token" : "opaque-canary"}',
	'npm error {"PASSWORD": "opaque-canary"}',
	"npm error \"_authToken\"='first-part'\nnpm error opaque-canary",
	"npm error headers:\nnpm error opaque-canary",
	"npm error Proxy-Authorization: Basic opaque-canary",
	"npm error %22token%22%3A%22opaque-canary%22",
	'npm error {\\"token\\":\\"opaque-canary\\"}',
];

export function assertAuthWithheld(error: unknown): void {
	let consoleText = "";
	const stream = new Writable({
		write(chunk, _encoding, callback) {
			consoleText += chunk.toString();
			callback();
		},
	});
	new Console({ stdout: stream, stderr: stream }).error(error);
	const surfaces = [(error as Error).message, (error as Error).stack, String(error), inspect(error), consoleText];
	for (const surface of surfaces) {
		expect(surface).toContain("suppression=AUTH_MATERIAL_DETECTED");
		expect(surface).not.toMatch(/opaque-canary|first-part|safe-before|safe-after/);
	}
	expect(JSON.stringify(error)).not.toMatch(/opaque-canary|first-part/);
	expect(error).not.toHaveProperty("cause");
}
