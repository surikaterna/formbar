import assert from "node:assert/strict";
import { copyJson } from "@formbar/expressions";

function sameData(actual, expected) {
	assert.deepEqual(copyJson(actual), copyJson(expected));
}

const own = { address: { city: "Lyon" }, flag: false, count: 0, text: "", nullable: null, rows: [] };
const badValues = () => {
	const cycle = {};
	cycle.self = cycle;
	return [
		cycle,
		Object.create({ text: "inherited" }),
		new Date(),
		{ count: Number.NaN },
		{ count: Number.POSITIVE_INFINITY },
		{ count: Number.NEGATIVE_INFINITY },
		{ text: undefined },
		{ text: () => "bad" },
		{ text: 1n },
		{ text: Symbol("bad") },
		{ rows: new Array(1) },
		{ text: "x".repeat(16385) },
	];
};
function before(fixture) {
	const store = fixture.store;
	return {
		data: store.data,
		initial: store.initial,
		revision: store.revision,
		status: store.status,
		issues: store.issueRecords,
		controller: store.controller,
		rows: store.rows.get('["rows"]'),
		fields: store.fields,
		notifications: fixture.notifications(),
	};
}
function unchanged(fixture, original) {
	const store = fixture.store;
	for (const name of ["data", "initial", "revision", "status", "controller", "fields"])
		assert.equal(store[name], original[name], `${name} changed on rejected initialization`);
	assert.equal(store.issueRecords, original.issues);
	assert.equal(store.rows.get('["rows"]'), original.rows);
	assert.equal(fixture.notifications(), original.notifications);
}

export async function runOwnDefaults(factory) {
	for (const mode of ["host", "schema"]) {
		const fixture = factory();
		let host;
		try {
			host = fixture.install(mode, own);
			sameData(host.snapshot().data, own);
			sameData(host.snapshot().initial, own);
			assert.equal(Object.hasOwn(host.snapshot().data.address, "zip"), false);
			assert.equal((await host.submit()).status, "submitted");
			sameData(fixture.submitted.at(-1), own);
			assert.equal(host.snapshot().controls[0].writers.value("edited").status, "applied");
			assert.equal(host.reset().ok, true);
			sameData(host.snapshot().data, own);
		} finally {
			host?.dispose();
			fixture.dispose();
		}
	}
	for (const overrides of [undefined, { rows: [{}] }, { address: {}, rows: [] }]) {
		const fixture = factory();
		let host;
		try {
			host = fixture.install("schema", overrides);
			const data = host.snapshot().data;
			if (overrides === undefined) {
				sameData(data.address, { city: "Paris", zip: "75000" });
				sameData(data.rows, [{ code: "B" }]);
			} else {
				sameData(data.rows, overrides.rows);
				if (Object.hasOwn(overrides, "address")) sameData(data.address, {});
			}
			assert.equal((await host.submit()).status, "submitted");
			assert.equal(host.reset().ok, true);
			assert.deepEqual(host.snapshot().data, data);
		} finally {
			host?.dispose();
			fixture.dispose();
		}
	}
}

export function runPublicCapture(factory) {
	for (const mode of ["host", "schema"]) {
		const fixture = factory();
		let calls = 0;
		const owner = Object.defineProperty({}, mode === "host" ? "initialization" : "initialData", {
			enumerable: true,
			get() {
				calls++;
				fixture.dispose();
				return {};
			},
		});
		try {
			assert.throws(() => fixture.installOwner(mode, owner));
			assert.equal(calls, 0);
			assert.deepEqual(fixture.calls, { identity: 0, initialize: 0 });
		} finally {
			fixture.dispose();
		}
	}
	for (const mode of ["host", "schema"]) {
		for (const value of badValues()) {
			const fixture = factory();
			try {
				assert.throws(() => fixture.install(mode, value));
				assert.deepEqual(fixture.calls, { identity: 0, initialize: 0 });
			} finally {
				fixture.dispose();
			}
		}
		const fixture = factory();
		let calls = 0;
		const getter = Object.defineProperty({}, "text", {
			enumerable: true,
			get() {
				calls++;
				fixture.dispose();
				return "revoked";
			},
		});
		try {
			assert.throws(() => fixture.install(mode, getter));
			assert.equal(calls, 0);
			assert.deepEqual(fixture.calls, { identity: 0, initialize: 0 });
		} finally {
			fixture.dispose();
		}
	}
	for (const value of [
		...badValues(),
		Object.defineProperty({}, "value", {
			enumerable: true,
			get() {
				throw new Error("Default getter invoked");
			},
		}),
	]) {
		const fixture = factory();
		try {
			assert.throws(() => fixture.install("host", {}, [{ path: ["text"], value }]));
			assert.deepEqual(fixture.calls, { identity: 0, initialize: 0 });
		} finally {
			fixture.dispose();
		}
	}
	const fixture = factory();
	let calls = 0;
	const entry = Object.defineProperty({ path: ["text"] }, "value", {
		enumerable: true,
		get() {
			calls++;
			fixture.dispose();
			return "revoked";
		},
	});
	try {
		assert.throws(() => fixture.install("host", {}, [entry]));
		assert.equal(calls, 0);
		assert.deepEqual(fixture.calls, { identity: 0, initialize: 0 });
	} finally {
		fixture.dispose();
	}
}

export function runAtomicInitialization(factory) {
	for (const value of [...badValues(), { count: "wrong" }, { unknown: "unattested" }]) {
		const fixture = factory();
		const original = before(fixture);
		try {
			assert.equal(fixture.initialize(value).status, "denied");
			unchanged(fixture, original);
		} finally {
			fixture.dispose();
		}
	}
	const fixture = factory();
	const original = before(fixture);
	let calls = 0;
	try {
		const getter = Object.defineProperty({}, "text", {
			enumerable: true,
			get() {
				calls++;
				fixture.session.revoke();
				return "revoked";
			},
		});
		assert.equal(fixture.initialize(getter).status, "denied");
		assert.equal(calls, 0);
		unchanged(fixture, original);
		assert.equal(
			fixture.initialize({ text: "new" }, [
				{ path: ["spare"], value: "staged" },
				{ path: ["unknown"], value: "bad" },
			]).status,
			"denied",
		);
		unchanged(fixture, original);
		assert.equal(fixture.initialize({ text: "new" }, [{ path: ["flag"], value: "wrong" }]).status, "denied");
		unchanged(fixture, original);
		assert.equal(fixture.initialize({ text: "new" }, [], {}).status, "stale");
		unchanged(fixture, original);
		let observed = 0;
		fixture.hook(() => {
			observed++;
			assert.equal(fixture.store.data, original.data);
		});
		assert.equal(fixture.initialize(own).status, "applied");
		assert.ok(observed > 0);
		assert.equal(fixture.notifications(), 1);
		assert.deepEqual(fixture.store.data, own);
		assert.deepEqual(fixture.store.initial, own);
	} finally {
		fixture.dispose();
	}
	const revoked = factory();
	const baseline = before(revoked);
	let once = false;
	try {
		revoked.hook(() => {
			if (once) return;
			once = true;
			revoked.session.revoke();
			revoked.session.active = true;
			revoked.store.revision = baseline.revision;
		});
		assert.equal(
			revoked.initialize({ text: "not committed" }).status,
			"stale",
			"revocation/regrant cannot restore the captured grant epoch",
		);
		assert.equal(revoked.store.data, baseline.data);
		assert.equal(revoked.store.initial, baseline.initial);
		assert.equal(revoked.notifications(), 0);
	} finally {
		revoked.dispose();
	}
}
