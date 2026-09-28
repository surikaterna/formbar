/** #374: compare approved run to authenticated Fulcio certificate fields. */
export interface ApprovedIdentity {
	repository: string;
	workflow: string;
	ref: string;
	commit: string;
	runId: string;
	attempt: string;
}

const prefix = "1.3.6.1.4.1.57264.1.";
const issuer = "https://token.actions.githubusercontent.com";

function utf8(value: string): Buffer {
	const bytes = Buffer.from(value, "utf8");
	if (bytes.length > 127) throw new Error("identity field too long");
	return Buffer.concat([Buffer.from([0x0c, bytes.length]), bytes]);
}

export function signerPolicy(identity: ApprovedIdentity) {
	const { repository, workflow, ref, commit, runId, attempt } = identity;
	if (
		!/^[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+$/.test(repository) ||
		!/^\.github\/workflows\/[a-z0-9-]+\.yml$/.test(workflow) ||
		!/^refs\/(heads|tags)\/[a-zA-Z0-9._/-]+$/.test(ref) ||
		!/^[a-f0-9]{40}$/.test(commit) ||
		!/^[1-9]\d*$/.test(runId) ||
		!/^[1-9]\d*$/.test(attempt)
	)
		throw new Error("invalid approved identity");
	const source = `https://github.com/${repository}`;
	const subject = `${source}/${workflow}@${ref}`;
	const invocation = `${source}/actions/runs/${runId}/attempts/${attempt}`;
	return {
		certificateIssuer: issuer,
		certificateIdentityURI: `^${subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
		certificateOIDs: {
			[`${prefix}1`]: Buffer.from(issuer),
			[`${prefix}3`]: Buffer.from(commit),
			[`${prefix}5`]: Buffer.from(repository),
			[`${prefix}6`]: Buffer.from(ref),
			[`${prefix}9`]: utf8(subject),
			[`${prefix}10`]: utf8(commit),
			[`${prefix}12`]: utf8(source),
			[`${prefix}13`]: utf8(commit),
			[`${prefix}14`]: utf8(ref),
			[`${prefix}18`]: utf8(subject),
			[`${prefix}19`]: utf8(commit),
			[`${prefix}21`]: utf8(invocation),
		},
	};
}
