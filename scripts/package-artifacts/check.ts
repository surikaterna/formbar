import { fileURLToPath } from "node:url";
import { auditPackages } from "./audit";
import { verifyReproduciblePackages } from "./reproducibility";

const root = fileURLToPath(new URL("../..", import.meta.url));

const current = auditPackages(root);
for (const result of current) {
	console.log(
		`PACKAGE_ARTIFACT name=${result.name} sha256=${result.sha256} maps=${result.maps} sources=${result.sources} files=${JSON.stringify(result.files)}`,
	);
}

const reproducible = verifyReproduciblePackages(root);
for (const result of reproducible) {
	console.log(`PACKAGE_REPRODUCIBLE name=${result.name} sha256=${result.sha256} raw_bytes=identical`);
}
