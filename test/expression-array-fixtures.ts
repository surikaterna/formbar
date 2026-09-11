export const invalidArrayKeys = [
	"4294967295",
	"4294967296",
	"9007199254740993",
	"01",
	"00",
	"1e0",
	"1.0",
	"-0",
	"extra",
	"1",
	"4294967294",
];

export function holeWithProperty(key: string): unknown[] {
	const array = new Array(1);
	Object.defineProperty(array, key, { value: 7, enumerable: true });
	return array;
}
