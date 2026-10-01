/** Native temporal scalars must preserve their value; unsupported display never becomes different model data. */
export function nativeValueSupported(type: string, value: unknown) {
	if (value === undefined || value === null || value === "") return true;
	if (type === "number") return typeof value === "number" && Number.isFinite(value);
	if (type !== "date" && type !== "time") return true;
	if (typeof value !== "string") return false;
	if (type === "time") return /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/.test(value);
	const match = /^(\d{4,6})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (year < 1 || year > 275760 || month < 1 || month > 12 || day < 1 || day > 31) return false;
	const date = new Date(0);
	date.setUTCFullYear(year, month - 1, day);
	date.setUTCHours(0, 0, 0, 0);
	return (
		Number.isFinite(date.getTime()) &&
		date.getUTCFullYear() === year &&
		date.getUTCMonth() === month - 1 &&
		date.getUTCDate() === day
	);
}
