import { Component, type ErrorInfo, type ReactNode } from 'react';
interface PanelErrorBoundaryProps {
    readonly name: string;
    readonly children: ReactNode;
    readonly className?: string;
}
interface PanelErrorBoundaryState {
    readonly hasError: boolean;
    readonly message: string | null;
}
/**
 * Granular error boundary for individual UI panels.
 * Unlike AppErrorBoundary (full-page crash), this renders a compact
 * inline card and lets the user retry without reloading the entire app.
 */
export declare class PanelErrorBoundary extends Component<PanelErrorBoundaryProps, PanelErrorBoundaryState> {
    state: PanelErrorBoundaryState;
    static getDerivedStateFromError(error: Error): {
        hasError: boolean;
        message: string;
    };
    componentDidCatch(error: Error, errorInfo: ErrorInfo): void;
    private readonly handleRetry;
    render(): string | number | bigint | boolean | Iterable<ReactNode> | Promise<string | number | bigint | boolean | import("node_modules/@types/react").ReactPortal | import("node_modules/@types/react").ReactElement<unknown, string | import("node_modules/@types/react").JSXElementConstructor<any>> | Iterable<ReactNode> | null | undefined> | import("node_modules/@types/react").JSX.Element | null | undefined;
}
export {};
