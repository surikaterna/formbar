import type { SchemaDemoFixture, SchemaDemoSource, TrustedRuntimeProfileId } from "../demos/baseline-contracts";

export function runtimeProfileIdsFor(
	fixture: Pick<SchemaDemoFixture, "runtimeProfileIds">,
	source: Pick<SchemaDemoSource, "arbiterRules">,
): readonly TrustedRuntimeProfileId[] {
	return [
		"formbar.standard.v1",
		...(source.arbiterRules ? (["formbar.arbiter.v1"] as const) : []),
		...(fixture.runtimeProfileIds ?? []),
	];
}
