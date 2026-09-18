import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { parse } from "acorn";

const BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

export function scanBundle(root, gzipLimit = 750 * 1024) {
	const files = walk(root).filter((file) => /\.(?:js|css)$/.test(file));
	const findings = [];
	for (const file of files.filter((candidate) => candidate.endsWith(".js"))) scanJavaScript(root, file, findings);
	const rawBytes = files.reduce((total, file) => total + statSync(file).size, 0);
	const gzipBytes = files.reduce((total, file) => total + gzipSync(readFileSync(file)).length, 0);
	if (gzipBytes > gzipLimit) findings.push(`gzip limit exceeded: ${gzipBytes}`);
	return { files: files.map((file) => relative(root, file)), rawBytes, gzipBytes, findings };
}

function scanJavaScript(root, file, findings) {
	const source = readFileSync(file, "utf8");
	const name = relative(root, file);
	const syntax = spawnSync("node", ["--check", "--input-type=module"], { encoding: "utf8", input: source });
	if (syntax.status !== 0) findings.push(`${name}: Node syntax validation failed`);
	if (/__vite-browser-external|browser-external/.test(source)) findings.push(`${name}: browser-external marker`);
	let program;
	try {
		program = parse(source, { ecmaVersion: "latest", sourceType: "module" });
	} catch (error) {
		findings.push(`${name}: parser rejected JavaScript: ${error instanceof Error ? error.message : String(error)}`);
		return;
	}
	walkAst(program, (node) => inspectNode(node, file, name, findings));
}

function inspectNode(node, importer, name, findings) {
	if (node.type === "ImportDeclaration" || node.type === "ExportAllDeclaration") {
		inspectEdge(node.source?.value, importer, name, "module edge", findings);
	}
	if (node.type === "ExportNamedDeclaration" && node.source) {
		inspectEdge(node.source.value, importer, name, "re-export", findings);
	}
	if (node.type === "ImportExpression") inspectLoad(node.source, importer, name, "dynamic import", findings);
	if (node.type === "CallExpression" && node.callee?.type === "Identifier" && node.callee.name === "require") {
		inspectLoad(node.arguments?.[0], importer, name, "require", findings);
	}
}

function inspectLoad(argument, importer, name, kind, findings) {
	if (!argument || argument.type !== "Literal" || typeof argument.value !== "string") {
		findings.push(`${name}: nonliteral ${kind}`);
		return;
	}
	inspectEdge(argument.value, importer, name, kind, findings);
}

function inspectEdge(specifier, importer, name, kind, findings) {
	if (typeof specifier !== "string") {
		findings.push(`${name}: invalid ${kind}`);
		return;
	}
	if (BUILTINS.has(specifier) || !specifier.startsWith(".")) {
		findings.push(`${name}: forbidden bare/Node ${kind} ${specifier}`);
		return;
	}
	const target = resolve(dirname(importer), specifier.split(/[?#]/, 1)[0]);
	if (!isFile(target)) findings.push(`${name}: unresolved ${kind} ${specifier}`);
}

function walkAst(value, visit) {
	if (!value || typeof value !== "object") return;
	if (typeof value.type === "string") visit(value);
	for (const [key, child] of Object.entries(value)) {
		if (key !== "start" && key !== "end") {
			if (Array.isArray(child)) for (const item of child) walkAst(item, visit);
			else walkAst(child, visit);
		}
	}
}

function isFile(path) {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

function walk(directory) {
	return readdirSync(directory).flatMap((name) => {
		const path = join(directory, name);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});
}
