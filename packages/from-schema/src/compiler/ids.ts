export const definitionId = (provider: string, side: string): string => `schema-${safe(provider)}-${safe(side)}-form`;

export const nodeId = (occurrenceId: string, role: string): string => `${role}-${safe(occurrenceId)}`;

export const scopeId = (occurrenceId: string): string => `item-${safe(occurrenceId)}`;

function safe(value: string): string {
	return value.replace(/[^A-Za-z0-9_.:-]/g, "-").slice(0, 220) || "schema";
}
