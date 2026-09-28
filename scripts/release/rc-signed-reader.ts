/** Public registry GETs only; cap completed JSON and streamed tarball bytes. */
import { type ReadOnlyTransport, boundedTarball } from "./rc-live-reads";

const jsonLimit = 2_000_000;

async function boundedJson(response: Response): Promise<unknown> {
	const declared = response.headers.get("content-length");
	if (declared !== null && (!/^(0|[1-9]\d*)$/.test(declared) || Number(declared) > jsonLimit))
		throw new Error("JSON exceeds limit");
	if (!response.body) throw new Error("missing JSON body");
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!(value instanceof Uint8Array) || value.byteLength > jsonLimit - size) throw new Error("JSON exceeds limit");
			size += value.byteLength;
			chunks.push(value.slice());
		}
		if (declared !== null && Number(declared) !== size) throw new Error("JSON length mismatch");
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch {
		await reader.cancel().catch(() => {});
		throw new Error("invalid/oversized JSON");
	} finally {
		reader.releaseLock();
	}
}

export function createSignedRegistryReader(fetcher: typeof fetch = fetch): ReadOnlyTransport {
	return {
		async get(url, binary) {
			const parsed = new URL(url);
			if (
				parsed.protocol !== "https:" ||
				parsed.host !== "registry.npmjs.org" ||
				parsed.username ||
				parsed.password ||
				parsed.search ||
				parsed.hash
			)
				throw new Error("foreign registry URL");
			const response = await fetcher(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(10_000) });
			return {
				status: response.status,
				...(response.headers.get("location") ? { location: "redirect" } : {}),
				...(response.status === 200
					? binary
						? { bytes: await boundedTarball(response) }
						: { body: await boundedJson(response) }
					: {}),
			};
		},
	};
}
