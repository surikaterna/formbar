import { type ComponentType, createElement } from "react";
import { SchemaDemoHost } from "../renderers/SchemaDemoHost";
import { basicContactDemo } from "./01-basic-contact";
import { CompilationPreviewDemo, compilationPreviewFixture } from "./01-compilation-preview";
import { userProfileDemo } from "./02-user-profile";
import { nestedAddressDemo } from "./03-nested-address";
import { settingsPanelDemo } from "./04-settings-panel";
import { productEntryDemo } from "./05-product-entry";
import { richValidationDemo } from "./06-rich-validation";
import { conditionalFieldsDemo } from "./07-conditional-fields";
import { arrayItemsDemo } from "./08-array-items";
import { customLayoutDemo } from "./09-custom-layout";
import { responsiveSectionsDemo } from "./10-multi-section-responsive";
import { searchFiltersDemo } from "./11-search-filters";
import { surveyDemo } from "./12-survey-questionnaire";
import { multiSchemaSourcesDemo } from "./13-multi-schema-sources";
import { orderEntryDemo } from "./14-order-entry";
import { kitchenSinkDemo } from "./15-kitchen-sink";
import { customRenderersDemo } from "./16-custom-renderers";
import { customLayoutTypesDemo } from "./17-custom-layout";
import { arbiterVisibilityDemo } from "./18-arbiter-visibility";
import { arbiterCalculatedDemo } from "./19-arbiter-calculated";
import { arbiterValidationDemo } from "./20-arbiter-validation-gating";
import { arbiterDynamicSectionsDemo } from "./21-arbiter-dynamic-sections";
import type { SchemaDemoFixture } from "./baseline-contracts";

export type DemoCategory = SchemaDemoFixture["category"];
export type PlaygroundSupport =
	| { readonly support: "full" }
	| { readonly support: "unsupported"; readonly reason: string };

export interface DemoRegistration {
	readonly id: string;
	readonly number?: number;
	readonly title: string;
	readonly subtitle: string;
	readonly category: DemoCategory;
	readonly component: ComponentType;
	readonly fixture: SchemaDemoFixture;
	readonly playground: PlaygroundSupport;
}

export const baselineFixtures: readonly SchemaDemoFixture[] = Object.freeze([
	basicContactDemo,
	userProfileDemo,
	nestedAddressDemo,
	settingsPanelDemo,
	productEntryDemo,
	richValidationDemo,
	conditionalFieldsDemo,
	arrayItemsDemo,
	customLayoutDemo,
	responsiveSectionsDemo,
	searchFiltersDemo,
	surveyDemo,
	multiSchemaSourcesDemo,
	orderEntryDemo,
	kitchenSinkDemo,
	customRenderersDemo,
	customLayoutTypesDemo,
	arbiterVisibilityDemo,
	arbiterCalculatedDemo,
	arbiterValidationDemo,
	arbiterDynamicSectionsDemo,
]);

function registerFixture(fixture: SchemaDemoFixture, number: number): DemoRegistration {
	const registration: DemoRegistration = {
		id: fixture.id,
		number,
		title: fixture.title,
		subtitle: fixture.subtitle,
		category: fixture.category,
		component: () => createElement(SchemaDemoHost, { fixture }),
		fixture,
		playground: Object.freeze({ support: "full" }),
	};
	return Object.freeze(registration);
}

const compilationRegistration: DemoRegistration = Object.freeze({
	id: compilationPreviewFixture.id,
	title: compilationPreviewFixture.title,
	subtitle: compilationPreviewFixture.subtitle,
	category: compilationPreviewFixture.category,
	component: CompilationPreviewDemo,
	fixture: compilationPreviewFixture,
	playground: Object.freeze({ support: "full" }),
});

export const demos: readonly DemoRegistration[] = Object.freeze([
	...baselineFixtures.map((fixture, index) => registerFixture(fixture, index + 1)),
	compilationRegistration,
]);

export function assertValidRegistry(registrations: readonly DemoRegistration[]): void {
	assertUnique(
		registrations.map(({ id }) => id),
		"demo ID",
	);
	assertUnique(
		registrations.flatMap(({ number }) => (number === undefined ? [] : [String(number)])),
		"demo number",
	);
	for (const registration of registrations) {
		if (registration.number !== undefined && registration.playground.support !== "full") {
			throw new Error(`Numbered demo ${registration.id} must have full playground support`);
		}
		if (registration.playground.support === "unsupported" && !registration.playground.reason.trim()) {
			throw new Error(`Unsupported demo ${registration.id} requires a reason`);
		}
		assertUnique(
			registration.fixture.sources.map(({ key }) => key),
			`source key for ${registration.id}`,
		);
		for (const source of registration.fixture.sources) {
			if (!source.key.trim()) throw new Error(`Demo ${registration.id} has an empty source key`);
			assertUnique(source.definitionVariants?.map(({ key }) => key) ?? [], `definition key for ${registration.id}`);
			if (source.definitionVariants?.some(({ key }) => !key.trim())) {
				throw new Error(`Demo ${registration.id} has an empty definition key`);
			}
		}
	}
}

function assertUnique(values: readonly string[], label: string): void {
	if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
}

assertValidRegistry(demos);
