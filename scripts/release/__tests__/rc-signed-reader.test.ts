import { expect, it } from "vitest";
import { createSignedRegistryReader } from "../rc-signed-reader";

const url = "https://registry.npmjs.org/%40changesets%2Fcli/2.29.7";

function stream(size: number) {
	let remaining = size;
	let cancelled = false;
	const body = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (!remaining) return controller.close();
			const length = Math.min(remaining, 100_000);
			remaining -= length;
			controller.enqueue(new Uint8Array(length));
		},
		cancel() {
			cancelled = true;
		},
	});
	return {
		body,
		get cancelled() {
			return cancelled;
		},
	};
}

it("bounds actual JSON bytes even with missing/false-low Content-Length and cancels overflow", async () => {
	for (const length of [undefined, "10"]) {
		const large = stream(2_200_001);
		const read = createSignedRegistryReader(
			async () =>
				new Response(large.body, {
					status: 200,
					headers: length ? { "content-length": length } : {},
				}),
		);
		await expect(read.get(url)).rejects.toThrow();
		expect(large.cancelled).toBe(true);
	}
});

it("rejects redirect and non-registry host before reading", async () => {
	const read = createSignedRegistryReader(
		async () => new Response(null, { status: 302, headers: { location: "https://evil.example" } }),
	);
	expect((await read.get(url)).location).toBe("redirect");
	await expect(read.get("https://evil.example/metadata")).rejects.toThrow();
});

it("accepts bounded JSON and rejects over-limit declared length", async () => {
	const read = createSignedRegistryReader(async () => new Response('{"ok":true}', { status: 200 }));
	expect((await read.get(url)).body).toEqual({ ok: true });
	const invalid = createSignedRegistryReader(
		async () => new Response("{}", { status: 200, headers: { "content-length": "2000001" } }),
	);
	await expect(invalid.get(url)).rejects.toThrow();
});
