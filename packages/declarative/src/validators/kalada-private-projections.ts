import type { DataContext, FormbarDataStrategyV1, ReadScope } from "./kalada-data-strategy.js";
import type { AdmittedDefinition } from "./kalada-definition.js";
import type { TrustedDirectLocations } from "./kalada-direct-location.js";
import type { AdmissionPolicy } from "./kalada-policy.js";
import { privateComponentProjector } from "./kalada-private-components.js";
import { privateNative } from "./kalada-private-native.js";
import type { PrivateEvaluation } from "./kalada-private-runtime.js";
import { privateWritePorts } from "./kalada-private-write.js";

export function privateProjections(options: {
	readonly admitted: AdmittedDefinition;
	readonly definition: unknown;
	readonly policy: AdmissionPolicy;
	readonly locations: TrustedDirectLocations | undefined;
	readonly strategy: FormbarDataStrategyV1;
	readonly context: DataContext;
	readonly live: () => boolean;
	readonly revision: () => number;
	readonly validScope: (scope: ReadScope, enclosing?: string) => boolean;
	readonly evaluate: (path: string, scope: ReadScope) => PrivateEvaluation;
}) {
	const { admitted, strategy, context, live, validScope, revision, evaluate, locations } = options;
	const writes = privateWritePorts({ admitted, strategy, context, valid: live, revision, validScope, locations });
	return {
		...writes,
		projectCustom: privateComponentProjector({
			admitted,
			definition: options.definition,
			policy: options.policy,
			locations,
			strategy,
			context,
			live,
			validScope,
			evaluate,
			bindDirect: writes.bindDirectWrite,
			bindRow: writes.bindRowWrite,
		}),
		projectNative: privateNative({
			admitted,
			strategy,
			context,
			live,
			validScope,
			bindDirect: writes.bindDirectWrite,
			bindRow: writes.bindRowWrite,
		}),
	};
}
