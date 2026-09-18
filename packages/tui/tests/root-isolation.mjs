import { builtinModules } from "node:module";
import { dirname, extname, resolve } from "node:path";
import ts from "typescript";

const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));

function isBuiltin(specifier) {
	if (specifier.startsWith("node:")) return true;
	return builtins.has(specifier) || builtins.has(specifier.split("/")[0]);
}

function moduleEdges(source, path) {
	const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const edges = [];
	const unknownCalls = [];
	function visit(node) {
		if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
			if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) edges.push(node.moduleSpecifier.text);
		} else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
			const expression = node.moduleReference.expression;
			if (expression && ts.isStringLiteral(expression)) edges.push(expression.text);
		} else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
			if (ts.isStringLiteral(node.argument.literal)) edges.push(node.argument.literal.text);
		} else if (ts.isCallExpression(node) && moduleCallKind(node)) {
			if (node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) edges.push(node.arguments[0].text);
			else unknownCalls.push(moduleCallKind(node));
		}
		ts.forEachChild(node, visit);
	}
	visit(file);
	return { edges, file, unknownCalls };
}

function moduleCallKind(node) {
	if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return "dynamic import";
	if (ts.isIdentifier(node.expression) && node.expression.text === "require") return "require";
	return undefined;
}

function bindingContains(name, target) {
	if (ts.isIdentifier(name)) return name.text === target;
	return name.elements.some((element) => !ts.isOmittedExpression(element) && bindingContains(element.name, target));
}

function statementDeclares(statement, target) {
	if (ts.isVariableStatement(statement)) {
		return statement.declarationList.declarations.some(({ name }) => bindingContains(name, target));
	}
	if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
		return statement.name.text === target;
	}
	if (ts.isImportDeclaration(statement) && statement.importClause) {
		const clause = statement.importClause;
		if (clause.name?.text === target) return true;
		if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
			return clause.namedBindings.name.text === target;
		}
		return clause.namedBindings?.elements.some(({ name }) => name.text === target) ?? false;
	}
	return false;
}

function scopeDeclares(node, target) {
	if (ts.isSourceFile(node) || ts.isBlock(node)) return node.statements.some((item) => statementDeclares(item, target));
	if (ts.isFunctionLike(node)) return node.parameters.some(({ name }) => bindingContains(name, target));
	if (ts.isCatchClause(node) && node.variableDeclaration) return bindingContains(node.variableDeclaration.name, target);
	return false;
}

function isProcessReference(node) {
	const parent = node.parent;
	if (!parent) return false;
	if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
	if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)) && parent.name === node) return false;
	if ("name" in parent && parent.name === node && !ts.isShorthandPropertyAssignment(parent)) return false;
	return true;
}

function isGlobalObjectProcessAccess(node, shadowed) {
	if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return false;
	if (!ts.isIdentifier(node.expression) || !["global", "globalThis"].includes(node.expression.text)) return false;
	if (shadowed.has(node.expression.text)) return false;
	if (ts.isPropertyAccessExpression(node)) return node.name.text === "process";
	return Boolean(
		node.argumentExpression &&
			ts.isStringLiteralLike(node.argumentExpression) &&
			node.argumentExpression.text === "process",
	);
}

function hasGlobalProcess(file) {
	let found = false;
	function visit(node, shadowed) {
		const nextShadowed = new Set(shadowed);
		for (const name of ["global", "globalThis", "process"]) {
			if (scopeDeclares(node, name)) nextShadowed.add(name);
		}
		if (ts.isIdentifier(node) && node.text === "process" && !nextShadowed.has("process") && isProcessReference(node)) {
			found = true;
		}
		if (isGlobalObjectProcessAccess(node, nextShadowed)) found = true;
		ts.forEachChild(node, (child) => visit(child, nextShadowed));
	}
	visit(file, new Set());
	return found;
}

function sourceCandidates(importer, specifier) {
	const target = resolve(dirname(importer), specifier);
	const extension = extname(target);
	if ([".js", ".mjs", ".cjs"].includes(extension)) {
		const stem = target.slice(0, -extension.length);
		return [target, `${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`];
	}
	if (extension) return [target];
	return [target, `${target}.ts`, `${target}.tsx`, resolve(target, "index.ts")];
}

async function resolveLocal(readSource, importer, specifier) {
	for (const candidate of sourceCandidates(importer, specifier)) {
		try {
			await readSource(candidate);
			return candidate;
		} catch {}
	}
	throw new Error(`Cannot resolve local root dependency ${specifier} from ${importer}`);
}

function standaloneEdge(specifier, resolved) {
	if (specifier === "@formbar/tui/standalone") return true;
	return /(^|\/)standalone\.(?:[cm]?[jt]sx?)$/.test(resolved ?? "");
}

export async function inspectRootGraph(root, readSource) {
	const pending = [root];
	const visited = new Set();
	const violations = [];
	while (pending.length > 0) {
		const path = pending.pop();
		if (!path || visited.has(path)) continue;
		visited.add(path);
		const { edges, file, unknownCalls } = moduleEdges(await readSource(path), path);
		if (hasGlobalProcess(file)) violations.push(`${path}: global process reference`);
		for (const kind of unknownCalls) violations.push(`${path}: non-literal ${kind}`);
		for (const edge of edges) {
			if (isBuiltin(edge)) violations.push(`${path}: Node builtin ${edge}`);
			if (!edge.startsWith(".")) {
				if (standaloneEdge(edge)) violations.push(`${path}: standalone dependency ${edge}`);
				continue;
			}
			const resolved = await resolveLocal(readSource, path, edge);
			if (standaloneEdge(edge, resolved)) violations.push(`${path}: standalone dependency ${edge}`);
			pending.push(resolved);
		}
	}
	return violations;
}

export async function assertRootIsolation(root, readSource) {
	const violations = await inspectRootGraph(root, readSource);
	if (violations.length > 0) throw new Error(`Root isolation violations:\n${violations.join("\n")}`);
}
