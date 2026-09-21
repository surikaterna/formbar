export interface ProjectionLimitOptions {
	readonly maxOccurrences?: number;
	readonly maxOccurrenceDepth?: number;
	readonly maxDefinitionExpansions?: number;
}

export interface ProjectionLimits {
	readonly maxOccurrences: number;
	readonly maxOccurrenceDepth: number;
	readonly maxDefinitionExpansions: number;
}

const DEFAULTS: ProjectionLimits = Object.freeze({
	maxOccurrences: 20_000,
	maxOccurrenceDepth: 128,
	maxDefinitionExpansions: 2_000,
});

const CEILINGS: ProjectionLimits = Object.freeze({
	maxOccurrences: 200_000,
	maxOccurrenceDepth: 256,
	maxDefinitionExpansions: 20_000,
});

export function resolveProjectionLimits(options?: ProjectionLimitOptions): ProjectionLimits {
	return Object.freeze({
		maxOccurrences: limit("maxOccurrences", options?.maxOccurrences),
		maxOccurrenceDepth: limit("maxOccurrenceDepth", options?.maxOccurrenceDepth),
		maxDefinitionExpansions: limit("maxDefinitionExpansions", options?.maxDefinitionExpansions),
	});
}

function limit(key: keyof ProjectionLimits, value: number | undefined): number {
	if (value === undefined) return DEFAULTS[key];
	if (!Number.isSafeInteger(value) || value < 1 || value > CEILINGS[key]) {
		throw new RangeError(`${key} must be a positive safe integer no greater than ${CEILINGS[key]}.`);
	}
	return value;
}
