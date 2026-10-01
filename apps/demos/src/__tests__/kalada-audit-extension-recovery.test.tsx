// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { extensionRecovery } from "../../../../packages/react-schema/src/kalada-extension-recovery";
import {
	fixture,
	runRecovery,
	runRecoveryHydration,
} from "../../../../tests/consumers/formbar-kalada-v1/recovery-case.mjs";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => document.body.replaceChildren());
it.each(["field", "custom"] as const)("R15 installed %s semantic recovery and failed lease revocation", runRecovery);
it.each(["field", "custom"] as const)(
	"R15 installed %s StrictMode SSR/hydration has no precommit grant",
	runRecoveryHydration,
);

it.each(["field", "custom"] as const)(
	"R15 %s snapshot equality ignores ephemeral/metadata objects but tracks exact JSON and lexical binding",
	(type) => {
		const installed = fixture(type);
		try {
			const control = installed.host.snapshot().controls[0];
			const signature = extensionRecovery(control, installed.host);
			const equivalent = {
				...control,
				props: { ...control.props, nested: { a: 1, b: 2 } },
				writers: {},
				lifecycle: {
					dirty: true,
					touched: true,
					submitted: false,
					validating: false,
					valid: false,
					issues: { schema: ["unrelated"], extension: [] },
				},
			};
			expect(extensionRecovery(equivalent, installed.host)).toBe(signature);
			for (const changed of [
				{ ...control, rendererId: "other" },
				{ ...control, type: type === "field" ? ("custom" as const) : ("field" as const) },
				{ ...control, key: "different-logical-row" },
				{ ...control, props: { ...control.props, nested: { a: 2, b: 2 } } },
				{ ...control, value: "corrected" },
			])
				expect(extensionRecovery(changed, installed.host)).not.toBe(signature);
			const other = fixture(type, { binding: "other" });
			try {
				expect(extensionRecovery(control, other.host)).not.toBe(signature);
			} finally {
				other.dispose();
			}
			let calls = 0;
			const props = Object.defineProperty({}, "fail", {
				enumerable: true,
				get() {
					calls++;
					return false;
				},
			});
			expect(() => extensionRecovery({ ...control, props }, installed.host)).toThrow();
			expect(calls).toBe(0);
		} finally {
			installed.dispose();
		}
	},
);
