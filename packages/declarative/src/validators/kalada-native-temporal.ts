/** Return a comparable native temporal bound only when the platform can preserve its literal value. */
export function temporalBound(widget: string, value: unknown): number | undefined {
	if (typeof value !== "string" || value.length > 32) return;
	if (widget === "time") {
		const match = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,3}))?)?$/.exec(value);
		if (!match) return;
		return (
			Number(match[1]) * 3600000 +
			Number(match[2]) * 60000 +
			Number(match[3] ?? 0) * 1000 +
			Number((match[4] ?? "").padEnd(3, "0"))
		);
	}
	const match = /^(\d{4,6})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return;
	const [year, month, day] = match.slice(1).map(Number);
	if (year < 1 || year > 275760 || month < 1 || month > 12 || day < 1 || day > 31) return;
	const date = new Date(0);
	date.setUTCFullYear(year, month - 1, day);
	date.setUTCHours(0, 0, 0, 0);
	if (
		!Number.isFinite(date.getTime()) ||
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	)
		return;
	return date.getTime();
}
