export interface PackagePolicy {
	readonly directory: string;
	readonly manifestFiles: readonly string[];
	readonly name: `@formbar/${string}`;
}

const distOnly = ["dist"] as const;

export const packagePolicies: readonly PackagePolicy[] = [
	{ directory: "expressions", name: "@formbar/expressions", manifestFiles: ["dist", "docs"] },
	{ directory: "core", name: "@formbar/core", manifestFiles: distOnly },
	{ directory: "declarative", name: "@formbar/declarative", manifestFiles: distOnly },
	{ directory: "from-schema", name: "@formbar/from-schema", manifestFiles: distOnly },
	{ directory: "react", name: "@formbar/react", manifestFiles: distOnly },
	{ directory: "arbiter", name: "@formbar/arbiter", manifestFiles: distOnly },
	{ directory: "react-schema", name: "@formbar/react-schema", manifestFiles: distOnly },
];

export const expressionAdr = "docs/adr/0001-expression-service-and-reactive-props.md";

export const standardPackageFiles = ["LICENSE", "README.md", "package.json"] as const;

export interface ExportConditions {
	readonly import: { readonly types: string; readonly default: string };
	readonly require: { readonly types: string; readonly default: string };
}

export const exportEntries = [".", "./path", "./transforms", "./validation"] as const;

export interface PackageManifest {
	readonly dependencies?: Readonly<Record<string, string>>;
	readonly devDependencies?: Readonly<Record<string, string>>;
	readonly exports: Readonly<Record<string, ExportConditions>>;
	readonly files: readonly string[];
	readonly license: string;
	readonly main: string;
	readonly module: string;
	readonly name: string;
	readonly peerDependencies?: Readonly<Record<string, string>>;
	readonly peerDependenciesMeta?: Readonly<Record<string, unknown>>;
	readonly repository: {
		readonly directory: string;
		readonly type: string;
		readonly url: string;
	};
	readonly sideEffects: boolean;
	readonly type: string;
	readonly types: string;
	readonly version: string;
}
