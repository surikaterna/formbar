import { it } from "vitest";
import {
	runAtomicInitialization,
	runOwnDefaults,
	runPublicCapture,
} from "../../../../tests/consumers/formbar-kalada-v1/initialization-case.mjs";
import {
	directInitializationFixture,
	publicInitializationFixture,
} from "../../../../tests/consumers/formbar-kalada-v1/initialization-fixture";
it("R19 actual public host/schema factory clones initialization data before host calls without executing getters", () =>
	runPublicCapture(publicInitializationFixture));
it("R19 actual demo initialization is staged, atomic and rejects revocation/regrant and non-inert/type/stale inputs without partial state", () =>
	runAtomicInitialization(directInitializationFixture));
it("R20 actual public schema/host caller-owned subtree and falsey values replace defaults through submit and reset", () =>
	runOwnDefaults(publicInitializationFixture));
