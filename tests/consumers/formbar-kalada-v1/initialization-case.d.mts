import type { directInitializationFixture, publicInitializationFixture } from "./initialization-fixture.js";
export function runOwnDefaults(factory: typeof publicInitializationFixture): Promise<void>;
export function runPublicCapture(factory: typeof publicInitializationFixture): void;
export function runAtomicInitialization(factory: typeof directInitializationFixture): void;
