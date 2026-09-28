import { describe, expect, it, vi } from "vitest";
import { createGitHubRead } from "../github-read";

describe("read-only authenticated GitHub REST transport", () => {
	it("offers only GET and decodes successful endpoint JSON", async () => {
		const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ id: 123 }) })) as unknown as typeof fetch;
		const api = createGitHubRead("test-token", fetcher);
		expect(Object.keys(api)).toEqual(["get"]);
		await expect(api.get("repos/surikaterna/formbar/actions/runs/123")).resolves.toEqual({ id: 123 });
		expect(fetcher).toHaveBeenCalledWith(
			"https://api.github.com/repos/surikaterna/formbar/actions/runs/123",
			expect.objectContaining({
				method: "GET",
				headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
			}),
		);
	});
	it.each([401, 403, 404, 500])("denies HTTP %i without interpreting it as no data", async (status) => {
		const fetcher = vi.fn(async () => ({ ok: false, status })) as unknown as typeof fetch;
		await expect(
			createGitHubRead("test-token", fetcher).get("repos/surikaterna/formbar/issues/250/comments"),
		).rejects.toThrow(`GitHub REST ${status}`);
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
	it("rejects malformed paths and absent token before any fetch", async () => {
		const fetcher = vi.fn() as unknown as typeof fetch;
		expect(() => createGitHubRead("", fetcher)).toThrow("token");
		await expect(createGitHubRead("test-token", fetcher).get("https://example.com/publish")).rejects.toThrow("path");
		expect(fetcher).not.toHaveBeenCalled();
	});
});
