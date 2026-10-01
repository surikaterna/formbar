import { inventoryDemo } from "./kalada-demo-inventory";
import type { DemoSession } from "./kalada-demo-session";
import { key } from "./kalada-demo-state";
import type { Context, Strategy } from "./kalada-demo-store";

/** Only the original installed schema validator's exact inactive-field issue is owned for omission. */
export function draftAllowsOmission(
	session: DemoSession,
	context: Context,
	request: Parameters<NonNullable<Strategy["captureOmission"]>>[1],
) {
	const { store } = session;
	if (store.status.validating || [...store.scopedIssues.values()].some((entry) => entry.issues.length)) return false;
	const fields = inventoryDemo(session, context);
	return store.issueRecords.every((issue) => {
		if (
			!store.schemaOrigin ||
			issue.origin !== store.schemaOrigin ||
			issue.validator !== session.authority.schemaValidator ||
			issue.source !== "schema" ||
			!store.validators.includes(issue.validator)
		)
			return false;
		return fields.some((entry) => {
			if (request.hiddenValues !== "omit-inactive" || entry.visible || entry.submitWhenHidden === "include")
				return false;
			const target = session.authority.fields[entry.field.path];
			const path = target && store.locate({ namespace: "data", path: target }, entry.field.scope);
			return !!path && key(path) === key(issue.path);
		});
	});
}
