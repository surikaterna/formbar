import { Component, type ErrorInfo, type ReactNode } from "react";

interface TerminalErrorBoundaryProps {
	readonly children: ReactNode;
	readonly onSwitchToWeb: () => void;
}

interface TerminalErrorBoundaryState {
	readonly failed: boolean;
}

export class TerminalErrorBoundary extends Component<TerminalErrorBoundaryProps, TerminalErrorBoundaryState> {
	state: TerminalErrorBoundaryState = { failed: false };

	static getDerivedStateFromError(): TerminalErrorBoundaryState {
		return { failed: true };
	}

	componentDidCatch(_error: unknown, _info: ErrorInfo): void {
		// React reports the original failure; this boundary keeps the rest of the playground usable.
	}

	render() {
		if (!this.state.failed) return this.props.children;
		return (
			<div role="alert" className="terminal-fallback">
				<p>The terminal renderer could not start.</p>
				<button type="button" onClick={this.props.onSwitchToWeb}>
					Switch to Web renderer
				</button>
				<p>Reload the page before trying the terminal renderer again.</p>
			</div>
		);
	}
}
