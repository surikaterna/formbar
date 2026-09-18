export function readFileSync(): never {
	throw new Error("Filesystem access is unavailable in the browser proof");
}

export function existsSync(): boolean {
	return false;
}
