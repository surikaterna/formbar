import * as React from "react";
import { runAtomicInitialization, runOwnDefaults, runPublicCapture } from "./initialization-case.mjs";
import { directInitializationFixture, publicInitializationFixture } from "./initialization-fixture.mjs";
await runOwnDefaults(publicInitializationFixture);
runPublicCapture(publicInitializationFixture);
runAtomicInitialization(directInitializationFixture);
console.log(
	`PACKED_INITIALIZATION React ${React.version}: actual public host/schema factory/demo initializer, getter zero calls, opaque envelope, invalid JSON/type/revision/partial commit refusal, revoked epoch fencing, caller subtree/falsey/template defaults submit/reset passed`,
);
