import { resolve } from "node:path";
import { scanBundle } from "./bundle-scan.mjs";

const report = scanBundle(resolve(import.meta.dirname, "../dist"));
console.log(JSON.stringify(report, null, 2));
if (report.findings.length > 0) process.exitCode = 1;
