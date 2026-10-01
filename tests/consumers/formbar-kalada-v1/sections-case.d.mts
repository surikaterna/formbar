import type { sectionsFixture } from "./sections-fixture.js";
export function runSections(factory: typeof sectionsFixture): Promise<void>;
export function runRequiredAuthority(factory: typeof sectionsFixture): Promise<void>;
export function runPropertyPolicies(factory: typeof sectionsFixture): Promise<void>;
export function runProfileReinstall(factory: typeof sectionsFixture): Promise<void>;
