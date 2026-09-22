import { type ComponentType, createElement } from "react";
import { SchemaDemoHost } from "../renderers/SchemaDemoHost";
import { basicContactDemo } from "./01-basic-contact";
import { CompilationPreviewDemo } from "./01-compilation-preview";
import { userProfileDemo } from "./02-user-profile";
import { nestedAddressDemo } from "./03-nested-address";
import { settingsPanelDemo } from "./04-settings-panel";
import { productEntryDemo } from "./05-product-entry";
import { conditionalFieldsDemo } from "./07-conditional-fields";
import { customLayoutDemo } from "./09-custom-layout";
import { responsiveSectionsDemo } from "./10-multi-section-responsive";
import { surveyDemo } from "./12-survey-questionnaire";
import { multiSchemaSourcesDemo } from "./13-multi-schema-sources";
import { kitchenSinkDemo } from "./15-kitchen-sink";
import { arbiterVisibilityDemo } from "./18-arbiter-visibility";
import { arbiterDynamicSectionsDemo } from "./21-arbiter-dynamic-sections";
import type { SchemaDemoFixture } from "./baseline-contracts";

export interface DemoRegistration {
	readonly id: string;
	readonly title: string;
	readonly subtitle: string;
	readonly category: "baseline" | "conditional" | "layout" | "sources" | "compilation";
	readonly component: ComponentType;
}

export const baselineFixtures: readonly SchemaDemoFixture[] = [
	basicContactDemo,
	userProfileDemo,
	nestedAddressDemo,
	settingsPanelDemo,
	productEntryDemo,
	conditionalFieldsDemo,
	customLayoutDemo,
	responsiveSectionsDemo,
	surveyDemo,
	multiSchemaSourcesDemo,
	kitchenSinkDemo,
	arbiterVisibilityDemo,
	arbiterDynamicSectionsDemo,
];

function registerFixture(fixture: SchemaDemoFixture): DemoRegistration {
	return {
		id: fixture.id,
		title: fixture.title,
		subtitle: fixture.subtitle,
		category: fixture.category,
		component: () => createElement(SchemaDemoHost, { fixture }),
	};
}

export const demos: readonly DemoRegistration[] = [
	...baselineFixtures.map(registerFixture),
	{
		id: "schema-compilation",
		title: "Compilation preview",
		subtitle: "Descriptors and validated FormDefinition v1",
		category: "compilation",
		component: CompilationPreviewDemo,
	},
];
