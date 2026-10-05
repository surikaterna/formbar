import { createCompositionRouter } from "@kalada/provider-routing";
import { experimentalParseKaladaV1GuestExpressionPrefix } from "@kalada/syntax";
import { fail } from "./errors.js";
import type { SyntaxObserver } from "./syntax.js";

/** No continuation is offered after a failed guest: sibling recovery cannot confer authority. */
export function guestStop(text: string, opening: number, path: string, observer?: SyntaxObserver): number {
	let stop: number | undefined;
	const router = createCompositionRouter(
		[
			{
				version: 1,
				hostLanguageId: "fsx",
				position: "attribute",
				allowedGuests: ["Kalada"],
				defaultGuest: "Kalada",
				open: "{",
				close: "}",
			},
		],
		[
			{
				languageId: "Kalada",
				parse(input) {
					const result = experimentalParseKaladaV1GuestExpressionPrefix(input.snapshot.text, input.start);
					const confirmed = result.reason === "outer-brace" && text[result.stop] === "}";
					observer?.guest(opening + 1, confirmed ? result.stop : text.length, confirmed);
					if (confirmed) observer?.span("punctuation", result.stop, result.stop + 1);
					input.meter.charge(result.stop - input.start);
					stop = result.stop;
					return {
						owner: "Kalada",
						status: result.ok ? "valid" : "invalid",
						range: result.range,
						stop: result.stop,
						reason: result.ok ? "host-close" : result.reason,
						diagnostics: result.diagnostics.map((d) => ({ owner: "Kalada", code: d.code, range: d.range })),
						subtree: result.parsed,
					};
				},
			},
		],
	);
	const result = composeGuest(router, text, opening);
	if (result.status !== "valid" || stop === undefined || text[stop] !== "}") {
		const diagnostic = result.diagnostics[0];
		fail(diagnostic?.code ?? "INVALID_GUEST", path, diagnostic?.range, result.reason);
	}
	return stop;
}

function composeGuest(router: ReturnType<typeof createCompositionRouter>, text: string, opening: number) {
	const snapshot = { uri: "fsx:source", text, version: 0, environmentGeneration: "compile" };
	return router.compose({
		snapshot,
		isCurrent: (current) => current === snapshot || current.text === text,
		hostLanguageId: "fsx",
		slots: [{ position: "attribute", start: opening }],
		limits: { work: 200000, depth: 32, diagnostics: 100 },
	});
}
