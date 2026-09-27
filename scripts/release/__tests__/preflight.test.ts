import { describe, expect, it } from "vitest";
import { preflightCandidate, selectCandidates } from "../preflight";
import { FakeServices, candidate, sha, workspace } from "./fixtures";

describe("candidate selection", () => {
	it("selects a first publish and matching-gitHead recovery", async () => {
		const services = new FakeServices();
		expect(await selectCandidates([workspace], sha, services)).toHaveLength(1);
		services.npm = { exists: true, gitHead: sha };
		expect(await selectCandidates([workspace], sha, services)).toHaveLength(1);
	});

	it.each(["b".repeat(40), undefined])("rejects conflicting or missing gitHead %s", async (gitHead) => {
		const services = new FakeServices();
		services.npm = { exists: true, gitHead };
		await expect(selectCandidates([workspace], sha, services)).rejects.toThrow("conflicting or missing");
	});
});

describe("artifact preflight", () => {
	it("accepts compatible, mixed, and entirely missing artifact states", async () => {
		const services = new FakeServices();
		expect(await preflightCandidate(candidate, services)).toMatchObject({
			tagAction: "create",
			releaseAction: "create",
		});
		services.tags.set(candidate.tag, { kind: "annotated", target: sha, message: candidate.tag });
		expect(await preflightCandidate(candidate, services)).toMatchObject({ tagAction: "none", releaseAction: "create" });
		services.releases.set(candidate.tag, {
			kind: "present",
			name: "@scope/pkg 1.2.3",
			body: candidate.notes,
			prerelease: false,
		});
		expect(await preflightCandidate(candidate, services)).toMatchObject({ tagAction: "none", releaseAction: "none" });
	});

	it.each([
		[{ kind: "lightweight", target: sha }, "lightweight"],
		[{ kind: "annotated", target: "b".repeat(40), message: "@scope/pkg 1.2.3" }, "targets"],
	] as const)("rejects conflicting tag state %#", async (tag, message) => {
		const services = new FakeServices();
		services.tags.set(candidate.tag, tag);
		await expect(preflightCandidate(candidate, services)).rejects.toThrow(message);
	});

	it("rejects a conflicting release and a release without a tag", async () => {
		const services = new FakeServices();
		services.releases.set(candidate.tag, {
			kind: "present",
			name: "wrong",
			body: candidate.notes,
			prerelease: false,
		});
		await expect(preflightCandidate(candidate, services)).rejects.toThrow("conflicting name");
		services.releases.set(candidate.tag, {
			kind: "present",
			name: "@scope/pkg 1.2.3",
			body: candidate.notes,
			prerelease: false,
		});
		await expect(preflightCandidate(candidate, services)).rejects.toThrow("without a compatible tag");
	});

	it("narrowly accepts the established 0.3.0 Tracking line", async () => {
		const historical = { ...candidate, version: "0.3.0", tag: "@scope/pkg@0.3.0" };
		const services = new FakeServices();
		services.tags.set(historical.tag, { kind: "annotated", target: sha, message: "@scope/pkg 0.3.0" });
		services.releases.set(historical.tag, {
			kind: "present",
			name: "@scope/pkg 0.3.0",
			body: `${historical.notes}\n\nTracking: #52`,
			prerelease: false,
		});
		expect(await preflightCandidate(historical, services)).toMatchObject({ releaseAction: "none" });
	});
});
