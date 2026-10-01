import { expect, it, vi } from "vitest";
import { disposeDemoSession, installDemo } from "../runtime/kalada-demo-install";
import { schemaValidators } from "../runtime/kalada-demo-schema";
import type { Issue } from "../runtime/kalada-demo-store";
import { deferred, duplicateOmissionHost, omissionDocument, omissionSchema } from "./kalada-audit-fixtures";

it("R4 an owned optional inactive invalid draft value can submit a valid FINAL candidate without clearing draft issues", async () => {
	const submitted = vi.fn();
	const host = installDemo(omissionDocument(), submitted);
	try {
		expect((await host.validate()).ok).toBe(false);
		const draft = host.snapshot().data;
		const issues = host.snapshot().lifecycle?.issues;
		expect(issues?.schema.length).toBeGreaterThan(0);
		expect((await host.submit()).status).toBe("submitted");
		expect(submitted).toHaveBeenCalledExactlyOnceWith({ name: "visible", show: false });
		expect(host.snapshot().data).toEqual(draft);
		expect(host.snapshot().lifecycle?.issues).toEqual(issues);
	} finally {
		disposeDemoSession(host);
	}
});

it.each(["same-path", "ancestor", "include"])(
	"R4 blocks %s issues rather than suppressing them by a hidden path",
	async (kind) => {
		const submitted = vi.fn();
		const validators =
			kind === "same-path"
				? schemaValidators(omissionSchema)
				: kind === "ancestor"
					? [() => [{ path: [], message: "independent ancestor", source: "schema" as const }]]
					: [];
		const host = installDemo(omissionDocument(kind === "include"), submitted, ["formbar.standard.v1"], {}, undefined, {
			validators,
		});
		try {
			expect((await host.submit()).status).toBe("denied");
			expect(submitted).not.toHaveBeenCalled();
			expect(host.snapshot().data).toMatchObject({ hidden: "x" });
			expect(host.snapshot().lifecycle?.issues.schema.length).toBeGreaterThan(0);
		} finally {
			disposeDemoSession(host);
		}
	},
);

it.each(["edit", "revoke"])("R4 refuses a pending FINAL proof after %s", async (change) => {
	const final = deferred<readonly Issue[]>();
	const submitted = vi.fn();
	let reachedFinal = false;
	const check = (data: unknown) => {
		if (data && typeof data === "object" && !Object.hasOwn(data, "hidden")) {
			reachedFinal = true;
			return final.promise;
		}
		return [];
	};
	const host = installDemo(omissionDocument(), submitted, ["formbar.standard.v1"], {}, undefined, {
		validators: [check],
	});
	try {
		const pending = host.submit();
		for (let i = 0; i < 20 && !reachedFinal; i++) await Promise.resolve();
		expect(reachedFinal).toBe(true);
		if (change === "edit") expect(host.snapshot().controls[0].writers.value?.("changed").status).toBe("applied");
		else disposeDemoSession(host);
		final.settle([]);
		expect((await pending).status).not.toBe("submitted");
		expect(submitted).not.toHaveBeenCalled();
	} finally {
		disposeDemoSession(host);
	}
});

it("R4 treats two registrations of the same validator callback as independent origins", async () => {
	const submitted = vi.fn();
	const installed = duplicateOmissionHost(submitted);
	try {
		expect((await installed.host.submit()).status).toBe("denied");
		expect(submitted).not.toHaveBeenCalled();
		const issues = installed.host.snapshot().lifecycle?.issues.schema;
		expect(issues).toHaveLength(2);
		expect(issues?.[0]).toBe(issues?.[1]);
		expect(installed.host.snapshot().data).toMatchObject({ hidden: "x" });
	} finally {
		installed.dispose();
	}
});
