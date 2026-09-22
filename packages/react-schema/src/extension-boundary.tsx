import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { DiagnosticFallback } from "./renderer-elements.js";
import type { RendererDiagnostic } from "./renderer-evidence.js";

interface BoundaryProps {
	readonly code: RendererDiagnostic;
	readonly nodeId: string;
	readonly extensionId?: string;
	readonly children: ReactNode;
	readonly resetKey?: unknown;
	readonly onFailure?: () => void;
	readonly onRecovery?: () => void;
}

interface BoundaryState {
	readonly failed: boolean;
}

export class ExtensionBoundary extends Component<BoundaryProps, BoundaryState> {
	state: BoundaryState = { failed: false };

	static getDerivedStateFromError(): BoundaryState {
		return { failed: true };
	}

	componentDidCatch(_error: unknown, _info: ErrorInfo): void {
		this.props.onFailure?.();
	}

	componentDidUpdate(previous: BoundaryProps): void {
		if (!this.state.failed || previous.resetKey === this.props.resetKey) return;
		this.setState({ failed: false });
		this.props.onRecovery?.();
	}

	render(): ReactNode {
		if (this.state.failed)
			return (
				<DiagnosticFallback
					code={this.props.code}
					nodeId={this.props.nodeId}
					{...(this.props.extensionId ? { extensionId: this.props.extensionId } : {})}
				/>
			);
		return this.props.children;
	}
}
