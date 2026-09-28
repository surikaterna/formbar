// Only read-capable transport is accepted; callers must not treat this as publish authority.
export interface GitHubRead {
	get(path: string): Promise<unknown>;
}

export const repo = "repos/surikaterna/formbar";
export const sha = /^[0-9a-f]{40}$/;
export { rcPackages as rcNames } from "./rc-reviewed-plan";

export function object(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Missing GitHub object");
	return value as Record<string, unknown>;
}

export function array(value: unknown): unknown[] {
	if (!Array.isArray(value)) throw new Error("Missing GitHub array");
	return value;
}

export function requireThat(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`RC evidence denied: ${message}`);
}

export function sameSet(actual: unknown, expected: string[]): boolean {
	return (
		Array.isArray(actual) &&
		actual.length === expected.length &&
		actual.every((item) => typeof item === "string" && expected.includes(item)) &&
		new Set(actual).size === actual.length
	);
}

export async function pages(api: GitHubRead, path: string): Promise<unknown[]> {
	const collected: unknown[] = [];
	for (let page = 1; page <= 20; page++) {
		const items = array(await api.get(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`));
		collected.push(...items);
		if (items.length < 100) return collected;
	}
	throw new Error("RC evidence denied: pagination limit exceeded");
}
