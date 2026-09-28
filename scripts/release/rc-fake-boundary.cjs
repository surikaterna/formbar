// #382 only: isolate the real npm CLI from external sockets and replace signing, not publishing.
const Module = require("node:module");
const net = require("node:net");

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
	if (request === "./provenance" && parent?.filename.endsWith("/libnpmpublish/lib/publish.js")) {
		return {
			generateProvenance: async (subjects) => ({
				mediaType: "application/vnd.dev.sigstore.bundle+json;version=0.3",
				dsseEnvelope: {
					payloadType: "application/vnd.in-toto+json",
					payload: Buffer.from(
						JSON.stringify({
							_type: "https://in-toto.io/Statement/v1",
							predicateType: "https://slsa.dev/provenance/v1",
							subject: subjects,
							predicate: { fake: true },
						}),
					).toString("base64"),
					signatures: [{ sig: "FAKE-UNSIGNED-NOT-RELEASE-AUTHORITY" }],
				},
			}),
		};
	}
	return originalLoad.call(this, request, parent, isMain);
};

const connect = net.Socket.prototype.connect;
const approved = new WeakSet();
net.Socket.prototype.connect = function (...args) {
	if ((args.length === 0 || args[0] == null) && approved.has(this)) return connect.apply(this, args);
	const target = args[0];
	const options = Array.isArray(target) ? target[0] : target;
	const host = options && typeof options === "object" ? (options.host ?? options.hostname) : args[1];
	if (host !== "127.0.0.1") throw new Error("FAKE_BOUNDARY_EXTERNAL_SOCKET_DENIED");
	approved.add(this);
	return connect.apply(this, args);
};
