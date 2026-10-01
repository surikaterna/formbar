import { Component, type ComponentType, type ReactNode, Suspense, useEffect, useLayoutEffect } from "react";
import type { CommitLease } from "./kalada-commit-lease.js";
import type { KaladaControlProps } from "./kalada-form-renderer.js";

type Props = {
	readonly component: ComponentType<KaladaControlProps>;
	readonly control: KaladaControlProps;
	readonly lease: CommitLease;
	readonly recovery: string;
	readonly owner: object;
};
const unavailable = (
	<span role="alert" data-kalada-extension-error="">
		This extension could not be rendered.
	</span>
);

type State = Pick<Props, "component" | "recovery" | "owner"> & { failed: boolean };

function CommittedExtension({ component: Editor, control, lease }: Props) {
	// The Suspense child, not its already hydrated parent, owns React readiness.
	useLayoutEffect(() => () => lease.revoke(), [lease]);
	useEffect(() => {
		lease.activate();
		return () => lease.revoke();
	}, [lease]);
	return <Editor {...control} />;
}

class ExtensionBoundary extends Component<Props, State> {
	state: State = {
		failed: false,
		component: this.props.component,
		recovery: this.props.recovery,
		owner: this.props.owner,
	};
	static getDerivedStateFromProps(props: Props, previous: State) {
		if (
			props.component === previous.component &&
			props.owner === previous.owner &&
			props.recovery === previous.recovery
		)
			return null;
		return { failed: false, component: props.component, owner: props.owner, recovery: props.recovery };
	}
	static getDerivedStateFromError() {
		return { failed: true };
	}
	componentDidCatch() {
		this.props.lease.fail();
	}
	componentWillUnmount() {
		this.props.lease.revoke();
	}
	componentDidUpdate() {
		if (this.state.failed) this.props.lease.fail();
	}
	render(): ReactNode {
		if (this.state.failed)
			return (
				<>
					{unavailable}
					{this.props.control.children}
				</>
			);
		return <CommittedExtension {...this.props} />;
	}
}

/** Suspense contains server-render failures; the error boundary contains client retries and hook lifetimes. */
export function KaladaExtensionBoundary(props: Props) {
	return (
		<Suspense
			fallback={
				<>
					{unavailable}
					{props.control.children}
				</>
			}
		>
			<ExtensionBoundary {...props} />
		</Suspense>
	);
}
