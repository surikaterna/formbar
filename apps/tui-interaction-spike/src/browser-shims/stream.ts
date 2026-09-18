export class Stream {}

export class PassThrough extends Stream {
	write(_value: string): boolean {
		return true;
	}
}
