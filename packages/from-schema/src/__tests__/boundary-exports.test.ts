import { describe, expect, expectTypeOf, it } from "vitest";
import {
	DEFAULT_FIELD_STATE,
	FromSchemaError,
	applyLayoutMiddleware,
	createFormPresentation,
	createSchemaForm,
	descriptionId,
	errorId,
	fieldId,
	normalizeFormbarOptions,
	pruneHiddenFields,
	resolveFieldStates,
} from "../index.js";
import type {
	FieldStateDefinition,
	FormPresentation,
	FormPresentationSource,
	FormPresentationStateInput,
	PresentationField,
	PresentationFieldIds,
	ResolvedFieldState,
} from "../index.js";

describe("@formbar/from-schema public API surface", () => {
	it("statically imports expected runtime symbols from the main entry", () => {
		expect([
			createSchemaForm,
			createFormPresentation,
			applyLayoutMiddleware,
			FromSchemaError,
			descriptionId,
			errorId,
			fieldId,
			normalizeFormbarOptions,
			pruneHiddenFields,
			resolveFieldStates,
		]).toSatisfy((exports: readonly unknown[]) => exports.every((value) => typeof value === "function"));
		expect(DEFAULT_FIELD_STATE).toEqual({ visible: true, readOnly: false, disabled: false });
	});

	it("statically exports presentation model types", () => {
		expectTypeOf<FormPresentation>().toHaveProperty("layout");
		expectTypeOf<FormPresentationSource>().toHaveProperty("fields");
		expectTypeOf<PresentationField>().toHaveProperty("state");
		expectTypeOf<PresentationFieldIds>().toHaveProperty("field");
		expectTypeOf<FormPresentationStateInput>().toHaveProperty("uiState");
		expectTypeOf<FieldStateDefinition>().toHaveProperty("path");
		expectTypeOf<ResolvedFieldState>().toHaveProperty("visible");
	});
});
