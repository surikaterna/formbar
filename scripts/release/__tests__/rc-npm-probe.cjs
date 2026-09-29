const { execFileSync } = require("node:child_process");
const { readFileSync, statSync, writeFileSync } = require("node:fs");

const run = (...args) => execFileSync("npm", args, { encoding: "utf8" }).trim();
const user = process.env.npm_config_userconfig;
const global = process.env.npm_config_globalconfig;
const version = run("--version");
if (!user || !global || user === global) throw new Error("same or missing config path");
for (const path of [user, global]) {
	if ((statSync(path).mode & 0o777) !== 0o600 || readFileSync(path).length) throw new Error("not empty 0600");
}
const list = run("config", "list");
if (run("config", "get", "userconfig") !== user || run("config", "get", "globalconfig") !== global)
	throw new Error("wrong config path");
if (/_authToken|bad/.test(list)) throw new Error("config leak");
writeFileSync(process.env.TEST_PROBE_FILE, JSON.stringify({ version, user, global, list }));
if (process.env.TEST_FAIL_ENTRY === "true") process.exit(17);
