/** Public-log boundary, not an isolation boundary for arbitrary unknown secrets. */
const marker = "[REDACTED]";
const captureLimit = 100_000;
const signals = new Set(["SIGTERM", "SIGKILL", "SIGINT", "SIGABRT", "SIGSEGV", "SIGHUP"]);
declare const diagnosticBrand: unique symbol;
export type NpmDiagnostic = string & { readonly [diagnosticBrand]: true };

function utf8(value: string, limit: number): string {
	let result = "";
	for (const character of value) {
		if (Buffer.byteLength(result + character) > limit) break;
		result += character;
	}
	return result;
}

export function credentialValues(env: NodeJS.ProcessEnv): string[] {
	return Object.entries(env)
		.filter(([key, value]) => Boolean(value) && /token|auth|password|secret|key|credential/i.test(key))
		.map(([, value]) => value as string);
}

function capture(value: unknown): string {
	if (value == null) return "";
	if (typeof value !== "string" && !Buffer.isBuffer(value)) throw new Error("invalid-capture");
	const text = Buffer.isBuffer(value) ? new TextDecoder("utf-8", { fatal: true }).decode(value) : value;
	if (Buffer.byteLength(text) >= captureLimit) throw new Error("incomplete-capture");
	if (text.includes("\ufffd")) throw new Error("invalid-capture");
	if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text))
		throw new Error("invalid-capture");
	return text;
}

function replaceKnown(input: string, secrets: string[]): string {
	let text = input;
	for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
		const variants = [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)];
		for (const variant of variants) text = text.split(variant).join(marker);
	}
	return text;
}

function unsafeControls(text: string): boolean {
	return [...text].some((character) => {
		const code = character.codePointAt(0) as number;
		return (
			(code < 32 && code !== 9 && code !== 10) ||
			(code >= 127 && code <= 159) ||
			(code >= 0x2028 && code <= 0x202e) ||
			(code >= 0x2066 && code <= 0x2069)
		);
	});
}

function redact(input: string, secrets: string[]): string {
	if (secrets.some((secret) => secret.length <= 2)) throw new Error("short-credential");
	let text = replaceKnown(input, secrets);
	// Decode percent forms before selection; reject remaining escape syntax rather than guessing.
	for (let round = 0; round < 3 && /%[0-9a-f]{2}/i.test(text); round++) {
		text = text.replace(/(?:%[0-9a-f]{2})+/gi, (value) => decodeURIComponent(value));
		text = replaceKnown(text, secrets);
	}
	if (/%[0-9a-f]{2}|\\/i.test(text)) throw new Error("unsupported-encoding");
	if (unsafeControls(text)) throw new Error("unsafe-controls");
	if (/(?:authorization|bearer|_auth\w*|token|password|headers?)\s*[:=][ \t]*(?:\n|\{|$)/i.test(text))
		throw new Error("credential-syntax");
	text = text.replace(
		/^.*(?:authorization|bearer|_auth|auth|password|secret|credential|token|api[_-]?key|cookie)\s*[:= ].*$/gim,
		marker,
	);
	text = text.replace(/\b(?:npm_|gh[pousr]_|github_pat_)[A-Za-z0-9_]+/g, marker);
	text = text.replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, marker);
	// Drop whole URLs, including userinfo/query/fragment and OIDC endpoints, not just their values.
	text = text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi, marker);
	text = text.replace(/::/g, "[COMMAND]");
	return replaceKnown(text, secrets);
}

function processMetadata(record: Record<string, unknown>): string {
	const exit =
		typeof record.code === "number" && Number.isInteger(record.code) && record.code >= 0 && record.code <= 255
			? record.code
			: "unavailable";
	const signal = typeof record.signal === "string" && signals.has(record.signal) ? record.signal : "unavailable";
	if (record.code === "CLEANUP_FAILED") return `exit=${exit} signal=${signal} reason=cleanup-failure`;
	const reason =
		record.killed === true || record.code === "ETIMEDOUT"
			? "timeout-or-kill"
			: record.code === "ENOENT" || record.code === "EACCES"
				? "spawn-failure"
				: "process-failure";
	return `exit=${exit} signal=${signal} reason=${reason}`;
}

function selected(text: string): string[] {
	return text.split("\n").filter((line) => {
		if (
			!line.trim() ||
			/(?:debug.*log|log.*file|^(?:npm (?:error|ERR!) )?\s*at\s|\b(?:headers?|stack)\s*[:{])/i.test(line)
		)
			return false;
		return (
			/^npm (?:error|ERR!)\b/.test(line) ||
			/^(?:(?:Error: )?double-loading config|(?:Error: )?Exit prior to config file resolving)/.test(line)
		);
	});
}

function format(text: string, original: string, metadata: string): string {
	const lines = selected(text);
	const codes = lines.flatMap((line) => /^npm (?:error|ERR!) code ([A-Z0-9_]{1,32})$/.exec(line)?.[1] ?? []);
	const code = codes.length && codes.every((value) => value === codes[0]) ? codes[0] : "unavailable";
	const tail = lines.slice(-6).map((line) => utf8(line, 180));
	const message = utf8(
		lines.find((line) => !/^npm (?:error|ERR!) code /.test(line)) ?? "No eligible human diagnostic",
		300,
	);
	const truncated = lines.length > 6 || lines.some((line) => Buffer.byteLength(line) > 180);
	const suppression = lines.length ? "none" : "no-eligible-lines";
	return `${metadata} npmCode=${code} redaction=${text !== original ? "applied" : "none"} truncation=${truncated ? "yes" : "no"} omission=yes suppression=${suppression}\n[npm diagnostic] message: ${message}${tail.length ? `\n${tail.map((line) => `[npm diagnostic] ${line}`).join("\n")}` : ""}`;
}

export function npmDiagnostics(error: unknown, secrets: string[]): NpmDiagnostic {
	let metadata = "exit=unavailable signal=unavailable reason=process-failure";
	try {
		if (!error || typeof error !== "object") throw new Error("invalid-capture");
		const record = error as Record<string, unknown>;
		metadata = processMetadata(record);
		if (record.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") throw new Error("incomplete-capture");
		// Validate both channels; only human stderr is eligible. Never serialize Error.message/cause/stack.
		capture(record.stdout);
		const original = capture(record.stderr);
		return format(redact(original, secrets), original, metadata) as NpmDiagnostic;
	} catch (error) {
		const allowed = [
			"invalid-capture",
			"incomplete-capture",
			"short-credential",
			"unsupported-encoding",
			"unsafe-controls",
			"credential-syntax",
		];
		const reason = error instanceof Error && allowed.includes(error.message) ? error.message : "redaction-failed";
		return `${metadata} npmCode=unavailable redaction=withheld truncation=unknown omission=yes suppression=${reason}\n[npm diagnostic] Human diagnostics withheld safely` as NpmDiagnostic;
	}
}
