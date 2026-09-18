const inertStream = { columns: 80, rows: 24, isTTY: false, write: () => true };

export const env: Record<string, string | undefined> = {};
export const stdout = inertStream;
export const stderr = inertStream;
export const stdin = { ...inertStream, read: () => null };
export const cwd = () => "/";

const process = { env, stdout, stderr, stdin };
export default process;
