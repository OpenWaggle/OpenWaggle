import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Component } from 'react';
import { createRendererLogger } from '@/shared/lib/logger';
import { Button } from './Button';
const logger = createRendererLogger('AppErrorBoundary');
export class AppErrorBoundary extends Component {
    state = {
        hasError: false,
        message: null,
    };
    static getDerivedStateFromError(error) {
        return {
            hasError: true,
            message: error.message,
        };
    }
    componentDidCatch(error, errorInfo) {
        logger.error('Unhandled render error', {
            message: error.message,
            stack: errorInfo.componentStack,
        });
    }
    handleReload = () => {
        window.location.reload();
    };
    render() {
        if (!this.state.hasError)
            return this.props.children;
        return (_jsx("div", { role: "alert", className: "flex size-full items-center justify-center bg-bg px-6", children: _jsxs("div", { className: "w-full max-w-md rounded-xl border border-error/30 bg-bg-secondary p-5", children: [_jsxs("div", { className: "mb-3 flex items-center gap-2 text-error", children: [_jsx(AlertTriangle, { className: "size-4" }), _jsx("h1", { className: "text-sm font-semibold", children: "Something went wrong" })] }), _jsx("p", { className: "text-[13px] text-text-secondary", children: "The renderer hit an unexpected error. You can reload to recover." }), this.state.message && (_jsx("pre", { className: "mt-3 max-h-40 overflow-auto rounded-md border border-border bg-bg p-2 text-[12px] text-text-tertiary whitespace-pre-wrap break-words", children: this.state.message })), _jsxs(Button, { variant: "accent", "aria-label": "Reload app", onClick: this.handleReload, className: "mt-4", children: [_jsx(RefreshCw, { className: "size-3" }), "Reload app"] })] }) }));
    }
}
