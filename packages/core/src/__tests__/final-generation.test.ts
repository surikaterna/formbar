import { describe, expect, it } from "vitest";
import { beginFinalGeneration } from "../final-generation.js";

describe("private FINAL generation witness", () => {
	it("owns precisely one sync and async transition, including unscoped zero-async", () => {
		let sync = 0;
		let async = 0;
		const receipt = beginFinalGeneration(
			() => sync,
			() => async,
			() => true,
		);
		expect(receipt.syncCurrent()).toBe(false);
		expect(receipt.sync.begin(++sync)).toBe(true);
		receipt.sync.settle(sync);
		expect(receipt.syncCurrent()).toBe(true);
		expect(receipt.async.begin(++async)).toBe(true);
		receipt.async.settle(async);
		expect(receipt.current()).toBe(true);
		expect(receipt.async.begin(++async)).toBe(false);
		expect(receipt.current()).toBe(false);
	});

	it("rejects a competing start and finish between observations even with identical results", () => {
		let sync = 0;
		let async = 0;
		const receipt = beginFinalGeneration(
			() => sync,
			() => async,
			() => true,
		);
		sync++; // another run begins and settles before this run
		expect(receipt.sync.begin(++sync)).toBe(false);
		const next = beginFinalGeneration(
			() => sync,
			() => async,
			() => true,
		);
		expect(next.sync.begin(++sync)).toBe(true);
		next.sync.settle(sync);
		async++; // competing foreground run
		expect(next.async.begin(++async)).toBe(false);
	});

	it("revokes on guard/lifecycle failure without requiring a semantic value difference", () => {
		let sync = 0;
		let async = 0;
		let active = true;
		const receipt = beginFinalGeneration(
			() => sync,
			() => async,
			() => active,
		);
		expect(receipt.sync.begin(++sync)).toBe(true);
		receipt.sync.settle(sync);
		expect(receipt.async.begin(++async)).toBe(true);
		receipt.async.settle(async);
		active = false;
		expect(receipt.current()).toBe(false);
	});
});
