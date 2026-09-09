import { describe, expect, it } from "vitest";
import { applyPlan, validatePlan } from "../apply";
import { FakeServices, candidate, plan, sha } from "./fixtures";

function trackDelayedReads(services: FakeServices, visibleAt: Map<string, number>) {
	let npm = 0;
	let tags = 0;
	const releases = new Map<string, number>();
	const order: string[] = [];
	services.npmVersion = async () => {
		npm += 1;
		return services.npm;
	};
	services.tag = async (tag) => {
		tags += 1;
		return services.tags.get(tag) ?? { kind: "absent" as const };
	};
	services.release = async (tag) => {
		const reads = (releases.get(tag) ?? 0) + 1;
		releases.set(tag, reads);
		order.push(tag);
		if (reads < (visibleAt.get(tag) ?? 1)) return { kind: "absent" };
		const release = services.releases.get(tag);
		if (!release) throw new Error(`Missing test release ${tag}`);
		return release;
	};
	return { releases, order, totals: () => ({ npm, tags }) };
}

describe("release application", () => {
	it("creates annotated tags, atomically pushes, then creates releases", async () => {
		const services = new FakeServices();
		services.npm = { exists: true, gitHead: sha };
		await applyPlan(plan, services, services);
		expect(services.events).toEqual([`local:${candidate.tag}`, `push:${candidate.tag}`, `release:${candidate.tag}`]);
	});

	it("does no writes in dry-run or when any preflight artifact conflicts", async () => {
		const dryRun = new FakeServices();
		dryRun.npm = { exists: true, gitHead: sha };
		await applyPlan(plan, dryRun, dryRun, { dryRun: true });
		expect(dryRun.events).toEqual([]);

		const conflict = new FakeServices();
		conflict.npm = { exists: true, gitHead: sha };
		conflict.tags.set(candidate.tag, { kind: "lightweight", target: sha });
		await expect(applyPlan(plan, conflict, conflict)).rejects.toThrow("lightweight");
		expect(conflict.events).toEqual([]);
	});

	it("preflights every local tag before creating any tag", async () => {
		const services = new FakeServices();
		services.npm = { exists: true, gitHead: sha };
		services.preflightLocalTag = async () => {
			throw new Error("conflicting local tag");
		};
		await expect(applyPlan(plan, services, services)).rejects.toThrow("conflicting local tag");
		expect(services.events).toEqual([]);
	});

	it("does zero writes when a later candidate has a draft-reserved release tag", async () => {
		const second = { ...candidate, name: "@scope/second", tag: "@scope/second@1.2.3" };
		const services = new FakeServices();
		services.npm = { exists: true, gitHead: sha };
		services.releases.set(second.tag, {
			kind: "draft",
			name: "@scope/second 1.2.3",
			body: second.notes,
			prerelease: false,
		});
		await expect(applyPlan({ ...plan, candidates: [candidate, second] }, services, services)).rejects.toThrow(
			"reserved by a draft",
		);
		expect(services.events).toEqual([]);
	});

	it("recovers idempotently after tags or releases already exist", async () => {
		const services = new FakeServices();
		services.npm = { exists: true, gitHead: sha };
		services.tags.set(candidate.tag, { kind: "annotated", target: sha, message: candidate.tag });
		await applyPlan(plan, services, services);
		expect(services.events).toEqual(["push:", `release:${candidate.tag}`]);
		services.events = [];
		await applyPlan(plan, services, services);
		expect(services.events).toEqual(["push:"]);
	});

	it("bounds npm propagation retries and refuses conflicting gitHead", async () => {
		const services = new FakeServices();
		await expect(applyPlan(plan, services, services, { attempts: 2, wait: async () => {} })).rejects.toThrow(
			"did not propagate",
		);
		expect(services.events).toEqual([]);
		services.npm = { exists: true, gitHead: "b".repeat(40) };
		await expect(applyPlan(plan, services, services)).rejects.toThrow("conflicting gitHead");
	});

	it("retries only delayed final release reads with exact bounded backoff", async () => {
		const second = { ...candidate, name: "@scope/second", tag: "@scope/second@1.2.3" };
		const services = new FakeServices();
		services.npm = { exists: true, gitHead: sha };
		const reads = trackDelayedReads(
			services,
			new Map([
				[candidate.tag, 3],
				[second.tag, 6],
			]),
		);
		const waits: number[] = [];
		const writerSnapshots: string[][] = [];

		await applyPlan({ ...plan, candidates: [candidate, second] }, services, services, {
			wait: async (milliseconds) => {
				waits.push(milliseconds);
				writerSnapshots.push([...services.events]);
			},
		});

		expect(waits).toEqual([1_000, 2_000, 4_000, 8_000]);
		expect(reads.releases).toEqual(
			new Map([
				[candidate.tag, 3],
				[second.tag, 6],
			]),
		);
		expect(reads.order).toEqual([
			candidate.tag,
			second.tag,
			candidate.tag,
			second.tag,
			candidate.tag,
			second.tag,
			second.tag,
			second.tag,
			second.tag,
		]);
		expect(reads.totals()).toEqual({ npm: 2, tags: 6 });
		expect(new Set(writerSnapshots.map((events) => events.join("|"))).size).toBe(1);
		expect(services.events.filter((event) => event.startsWith("release:"))).toEqual([
			`release:${candidate.tag}`,
			`release:${second.tag}`,
		]);
	});

	it("reports every release still missing after five final reads", async () => {
		const second = { ...candidate, name: "@scope/second", tag: "@scope/second@1.2.3" };
		const services = new FakeServices();
		services.npm = { exists: true, gitHead: sha };
		const releaseReads = new Map<string, number>();
		services.release = async (tag) => {
			releaseReads.set(tag, (releaseReads.get(tag) ?? 0) + 1);
			return { kind: "absent" };
		};
		const waits: number[] = [];
		const eventCounts: number[] = [];

		await expect(
			applyPlan({ ...plan, candidates: [candidate, second] }, services, services, {
				wait: async (milliseconds) => {
					waits.push(milliseconds);
					eventCounts.push(services.events.length);
				},
			}),
		).rejects.toThrow(
			`GitHub Releases remained missing after 5 attempts and 15000ms total backoff: ${candidate.tag}, ${second.tag}`,
		);
		expect(waits).toEqual([1_000, 2_000, 4_000, 8_000]);
		expect(releaseReads).toEqual(
			new Map([
				[candidate.tag, 6],
				[second.tag, 6],
			]),
		);
		expect(new Set(eventCounts).size).toBe(1);
		expect(services.events.filter((event) => event.startsWith("release:"))).toHaveLength(2);
	});

	it("fails immediately when a release conflict appears during retry", async () => {
		const services = new FakeServices();
		services.npm = { exists: true, gitHead: sha };
		let releaseReads = 0;
		services.release = async () => {
			releaseReads += 1;
			if (releaseReads < 3) return { kind: "absent" };
			return { kind: "present", name: "wrong", body: candidate.notes, prerelease: false };
		};
		const waits: number[] = [];

		await expect(
			applyPlan(plan, services, services, {
				wait: async (milliseconds) => {
					waits.push(milliseconds);
				},
			}),
		).rejects.toThrow("conflicting name");
		expect(waits).toEqual([1_000]);
		expect(releaseReads).toBe(3);
		expect(services.events.filter((event) => event === `release:${candidate.tag}`)).toHaveLength(1);
	});

	it("does not retry releases after a final tag discrepancy", async () => {
		const services = new FakeServices();
		services.npm = { exists: true, gitHead: sha };
		let tagReads = 0;
		let releaseReads = 0;
		services.tag = async (tag) => {
			tagReads += 1;
			if (tagReads === 3) return { kind: "lightweight", target: sha };
			return services.tags.get(tag) ?? { kind: "absent" as const };
		};
		services.release = async () => {
			releaseReads += 1;
			return { kind: "absent" };
		};
		const waits: number[] = [];

		await expect(
			applyPlan(plan, services, services, {
				wait: async (milliseconds) => {
					waits.push(milliseconds);
				},
			}),
		).rejects.toThrow("lightweight");
		expect(waits).toEqual([]);
		expect(releaseReads).toBe(2);
		expect(services.events.filter((event) => event === `release:${candidate.tag}`)).toHaveLength(1);
	});

	it("refuses a forged 0.2.1 plan without an override", () => {
		expect(() =>
			validatePlan(
				{ ...plan, candidates: [{ ...candidate, version: "0.2.1", tag: "@scope/pkg@0.2.1" }] },
				"owner/repo",
				sha,
			),
		).toThrow("Refusing prohibited");
	});
});
