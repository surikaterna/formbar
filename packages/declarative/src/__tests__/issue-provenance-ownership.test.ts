import { expect, test } from "vitest";
import { createIssueEmission, issueCertificate } from "../../../core/src/issue-provenance.js";
import { projectConcreteOwnership } from "../runtime-ownership.js";
import { binding, definition, field, runtime } from "./runtime-fixtures.js";

test("#261 concrete repeater instance binds the internal emission to one capture only", () => {
	const validated = definition([
		{
			type: "repeater",
			id: "rows",
			scope: "row",
			binding: binding(["a.b"]),
			children: [field("cell", [], { binding: { namespace: "data", scope: "row", segments: ["0"] } })],
		},
	]);
	const { form } = runtime(validated, { initialData: { "a.b": [{ "0": "first" }, { "0": "second" }] } });
	const ownership = projectConcreteOwnership({ form, definition: validated, capture: form.captureState() });
	const owner = ownership.forField("cell")?.[1];
	if (!owner || !owner.eligible || owner.binding.namespace !== "data") throw new Error("Missing concrete owner");
	const run = {};
	const issue = createIssueEmission({
		fieldId: owner.instance.nodeId,
		instanceKey: owner.instance.instanceKey,
		binding: { namespace: "data", segments: owner.binding.segments },
		revision: 0,
		run,
		current: ownership.current,
	})({ code: "E", message: "error", severity: "error" });
	expect(issue.path.segments).toEqual(["a.b", 1, "0"]);
	expect(issueCertificate(issue, 0, run)?.instanceKey).toBe(owner.instance.instanceKey);
	form.setValue("a.b", [{ "0": "second" }, { "0": "first" }]);
	expect(issueCertificate(issue, 0, run)).toBeUndefined();
	form.dispose();
});
