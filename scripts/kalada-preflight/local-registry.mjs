import { createServer } from "node:http";

export async function startRegistry(artifacts, requests) {
	let phase = "ready";
	const server = createServer((request, response) => {
		const path = new URL(request.url, "http://127.0.0.1").pathname;
		const item = artifacts.find(
			({ name, version }) =>
				path === `/@kalada%2f${name}` ||
				path === `/@kalada/${name}` ||
				path === `/@kalada/${name}/-/${name}-${version}.tgz`,
		);
		const archive = item && path === `/@kalada/${item.name}/-/${item.name}-${item.version}.tgz`;
		const status = request.method !== "GET" ? 405 : item ? 200 : 404;
		requests.push({ phase, method: request.method, path, status });
		if (status !== 200) {
			response.writeHead(status);
			response.end();
			return;
		}
		const body = archive
			? item.bytes
			: Buffer.from(
					JSON.stringify({
						name: item.manifest.name,
						versions: Object.fromEntries(
							artifacts
								.filter(({ name }) => name === item.name)
								.map((version) => [
									version.version,
									{
										...version.manifest,
										dist: {
											integrity: version.integrity,
											tarball: `http://127.0.0.1:${server.address().port}/@kalada/${version.name}/-/${version.name}-${version.version}.tgz`,
										},
									},
								]),
						),
					}),
				);
		response.writeHead(200, {
			"Content-Type": archive ? "application/octet-stream" : "application/json",
			"Content-Length": body.length,
		});
		response.end(body);
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	return {
		url: `http://127.0.0.1:${server.address().port}/`,
		setPhase(value) {
			phase = value;
		},
		async close() {
			await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
			if (process.env.KALADA_316_FAIL_SERVER_CLOSE === "1") throw new Error("injected server close failure");
		},
	};
}
