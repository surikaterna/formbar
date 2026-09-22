import { structuredEqual } from "@formbar/core";
import { Component, useEffect } from "react";
import type { ReactNode } from "react";
import { DiagnosticFallback } from "./renderer-elements.js";
import type { RendererDiagnostic } from "./renderer-evidence.js";

interface BoundaryProps {
	readonly code: RendererDiagnostic;
	readonly nodeId: string;
	readonly extensionId?: string;
	readonly children: ReactNode;
	readonly resetKey?: ExtensionResetKey;
	readonly onFailure?: (nodeId: string) => void;
	readonly onRecovery?: (nodeId: string) => void;
}

export interface ExtensionResetKey {
	readonly rendererId: string;
	readonly normalizedProps: unknown;
	readonly instanceKey: string;
	readonly binding?: unknown;
	readonly component: unknown;
	readonly validateProps?: unknown;
}

interface BoundaryState {
	readonly failed: boolean;
}

export class ExtensionBoundary extends Component<BoundaryProps, BoundaryState> {
	state: BoundaryState = { failed: false };

	static getDerivedStateFromError(): BoundaryState {
		return { failed: true };
	}

	componentDidUpdate(previous: BoundaryProps): void {
		if (!this.state.failed || sameResetKey(previous.resetKey, this.props.resetKey)) return;
		this.setState({ failed: false });
	}

	render(): ReactNode {
		if (this.state.failed)
			return (
				<>
					<FailureLifecycle {...this.props} />
					<DiagnosticFallback
						code={this.props.code}
						nodeId={this.props.nodeId}
						{...(this.props.extensionId ? { extensionId: this.props.extensionId } : {})}
					/>
				</>
			);
		return this.props.children;
	}
}

function FailureLifecycle(props: Pick<BoundaryProps, "nodeId" | "onFailure" | "onRecovery">): null {
	useEffect(() => {
		props.onFailure?.(props.nodeId);
		return () => props.onRecovery?.(props.nodeId);
	}, [props.nodeId, props.onFailure, props.onRecovery]);
	return null;
}

function sameResetKey(left: ExtensionResetKey | undefined, right: ExtensionResetKey | undefined): boolean {
	if (left === right) return true;
	if (!left || !right) return false;
	return (
		left.rendererId === right.rendererId &&
		left.instanceKey === right.instanceKey &&
		left.component === right.component &&
		left.validateProps === right.validateProps &&
		structuredEqual(left.binding, right.binding) &&
		structuredEqual(left.normalizedProps, right.normalizedProps)
	);
}
