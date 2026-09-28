import { expect, it } from "vitest";
import { assertPinnedPublishTools } from "../rc-publish-toolchain";

it.skipIf(!process.env.RC_SIGNED_NODE || !process.env.RC_SIGNED_NPM_ROOT)(
	"pins the real Node22.23.2/npm11.20.0 binaries before any OIDC action",
	async () => {
		const node = process.env.RC_SIGNED_NODE;
		const npmRoot = process.env.RC_SIGNED_NPM_ROOT;
		if (!node || !npmRoot) throw new Error("pinned toolchain missing");
		await expect(assertPinnedPublishTools(node, npmRoot)).resolves.toBeUndefined();
		await expect(assertPinnedPublishTools(node, "/nonexistent/npm")).rejects.toThrow();
	},
);
