import assert from "node:assert/strict";
import { COMPOSITION_CONTRACT_VERSION, createCompositionRouter } from "@kalada/provider-routing";
import { lowerKaladaV1Expression, parseKaladaV1Expression } from "@kalada/syntax";
import { expression, program, ref } from "./boundary.mjs";

const references = {
	show: { reference: ref(["show"]), type: { kind: "primitive-type", name: "boolean" } },
	ready: { reference: ref(["ready"]), type: { kind: "primitive-type", name: "boolean" } },
};
const options = {
	references,
	coreOptions: {
		reference: {
			validate: (value) =>
				Object.values(references).some(({ reference }) => JSON.stringify(reference) === JSON.stringify(value)),
			canonicalize: (value) => value,
		},
	},
};

function compose(text) {
	let parsedProgram;
	let sourceMap;
	const router = createCompositionRouter(
		[{ version: 1, hostLanguageId: "fsx", position: "expression", allowedGuests: ["kalada"], open: "{", close: "}" }],
		[
			{
				languageId: "kalada",
				parse: ({ snapshot, start, close, meter }) => {
					const stop = snapshot.text.indexOf(close, start);
					const end = stop < 0 ? snapshot.text.length : stop;
					const source = snapshot.text.slice(start, end);
					meter.charge(Math.max(1, source.length));
					const parsed = parseKaladaV1Expression(source);
					const lowered = parsed.diagnostics.length ? null : lowerKaladaV1Expression(parsed, options);
					if (lowered?.ok) {
						parsedProgram = lowered.program;
						sourceMap = lowered.sourceMap.map((entry) => ({
							...entry,
							range: {
								start: entry.range.start + start,
								end: entry.range.end + start,
							},
						}));
					}
					return {
						owner: "kalada",
						status: lowered?.ok && stop >= 0 ? "valid" : "invalid",
						stop: end,
						range: { start, end },
						reason: lowered?.ok && stop >= 0 ? "host-close" : "invalid-expression",
						diagnostics: [],
						...(lowered?.ok && stop >= 0 ? { subtree: lowered.program } : {}),
					};
				},
			},
		],
	);
	const outcome = router.compose({
		snapshot: { uri: "file:///preflight.fsx", text, version: 1, environmentGeneration: "pinned" },
		hostLanguageId: "fsx",
		slots: [{ position: "expression", start: 0, maxStop: text.length, explicitGuest: "kalada" }],
		isCurrent: () => true,
		limits: { work: 256, depth: 3, diagnostics: 2 },
	});
	return { outcome, parsedProgram, sourceMap };
}

export function runCandidate(accept) {
	assert.equal(COMPOSITION_CONTRACT_VERSION, 1);
	const { outcome, parsedProgram, sourceMap } = compose("{show && ready}");
	assert.equal(outcome.status, "valid", JSON.stringify(outcome));
	assert.deepEqual(outcome.tree.children[1].range, { start: 1, end: 14 });
	assert.deepEqual(outcome.tree.children[1].subtree, parsedProgram);
	assert.deepEqual(accept(parsedProgram).program, parsedProgram);
	assert.deepEqual(sourceMap.find((entry) => entry.role === "reference")?.range, { start: 1, end: 5 });
	assert.deepEqual(
		accept(parsedProgram).dependencies.map((item) => item.segments),
		[["show"], ["ready"]],
	);
	for (const text of ["{show /* nope */ && ready}", "{show && ready]"]) {
		const invalid = compose(text).outcome;
		assert.notEqual(invalid.status, "valid", text);
		assert.equal(invalid.tree, undefined);
	}
	assert.ok(parseKaladaV1Expression("show && ready", { limits: { maxSourceLength: 3 } }).diagnostics.length > 0);
	const typed = program({
		kind: "conditional",
		condition: expression(ref(["show"])),
		// biome-ignore lint/suspicious/noThenProperty: Kalada's canonical conditional uses then.
		then: expression(ref(["show", 0])),
		else: expression(ref(["show", "0"])),
	});
	assert.deepEqual(
		accept(typed).dependencies.map((item) => item.segments),
		[["show"], ["show", 0], ["show", "0"]],
	);
	const conditional = program({
		kind: "conditional",
		condition: { kind: "literal", value: true },
		// biome-ignore lint/suspicious/noThenProperty: Kalada's canonical conditional uses then.
		then: {
			kind: "boolean-logical",
			operator: "and",
			left: { kind: "ref", ref: ref(["show"]) },
			right: { kind: "ref", ref: ref(["show"]) },
		},
		else: { kind: "ref", ref: ref(["ready"]) },
	});
	assert.deepEqual(
		accept(conditional).dependencies.map((item) => item.segments),
		[["show"], ["ready"]],
	);
	// Both branches are statically discovered without evaluating the constant-true condition.
	const repeated = program({
		kind: "conditional",
		condition: { kind: "literal", value: true },
		// biome-ignore lint/suspicious/noThenProperty: Kalada's canonical conditional uses then.
		then: {
			kind: "boolean-logical",
			operator: "and",
			left: expression(ref(["show", 0])),
			right: expression(ref(["show", "0"])),
		},
		else: {
			kind: "boolean-logical",
			operator: "and",
			left: expression(ref(["ready"])),
			right: expression(ref(["show", 0])),
		},
	});
	for (let iteration = 0; iteration < 2; iteration++) {
		const compiled = accept(repeated);
		assert.deepEqual(JSON.parse(JSON.stringify(compiled.dependencies)), [
			ref(["show", 0]),
			ref(["show", "0"]),
			ref(["ready"]),
		]);
		assert.equal(typeof compiled.evaluate, "function");
		assert.equal(typeof compiled.evaluateWithClock, "function");
	}
	console.log("CANDIDATE supported &&, typed dependencies, source offsets and neutral composition valid");
}
