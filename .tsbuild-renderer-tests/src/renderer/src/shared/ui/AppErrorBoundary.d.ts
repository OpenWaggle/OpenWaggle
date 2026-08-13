import { Component, type ErrorInfo, type ReactNode } from 'react';
interface AppErrorBoundaryProps {
    readonly children: ReactNode;
}
interface AppErrorBoundaryState {
    readonly hasError: boolean;
    readonly message: string | null;
}
export declare class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
    state: AppErrorBoundaryState;
    static getDerivedStateFromError(error: Error): {
        hasError: boolean;
        message: string;
    };
    componentDidCatch(error: Error, errorInfo: ErrorInfo): void;
    private readonly handleReload;
    render(): string | number | bigint | boolean | Iterable<ReactNode> | Promise<string | number | bigint | boolean | import("node_modules/@types/react").ReactPortal | import("node_modules/@types/react").ReactElement<unknown, string | import("node_modules/@types/react").JSXElementConstructor<any>> | Iterable<ReactNode> | null | undefined> | import("node_modules/@types/react").JSX.Element | null | undefined;
}
export {};
