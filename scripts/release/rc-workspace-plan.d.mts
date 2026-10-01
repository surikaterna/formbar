export const rcPackages: readonly string[];
export const rcEdges: Readonly<Record<string, readonly string[]>>;
export const kaladaProductionDependencies: Readonly<Record<string, Readonly<Record<string, string>>>>;
export function checkProductionDeclarations(manifests: readonly unknown[]): void;
export function checkRcManifests(manifests: readonly unknown[]): void;
export function readRcPlan(root: string): { name: string; version: string }[];
