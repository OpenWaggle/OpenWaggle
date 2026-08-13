import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Component } from 'react';
import { cn } from '@/shared/lib/cn';
import { createRendererLogger } from '@/shared/lib/logger';
import { Button } from './Button';
const logger = createRendererLogger('PanelErrorBoundary');
/**
 * Granular error boundary for individual UI panels.
 * Unlike AppErrorBoundary (full-page crash), this renders a compact
 * inline card and lets the user retry without reloading the entire app.
 */
export class PanelErrorBoundary extends Component {
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
        logger.error(`Panel "${this.props.name}" error`, {
            message: error.message,
            stack: errorInfo.componentStack,
        });
    }
    handleRetry = () => {
        this.setState({ hasError: false, message: null });
    };
    render() {
        if (!this.state.hasError) {
            return this.props.className ? (_jsx("div", { className: this.props.className, children: this.props.children })) : (this.props.children);
        }
        return (_jsx("div", { role: "alert", className: cn('flex items-center justify-center p-4', this.props.className), children: _jsxs("div", { className: "w-full max-w-sm rounded-lg border border-error/30 bg-bg-secondary p-4", children: [_jsxs("div", { className: "mb-2 flex items-center gap-2 text-error", children: [_jsx(AlertTriangle, { className: "size-3.5" }), _jsxs("h2", { className: "text-[13px] font-semibold", children: [this.props.name, " panel error"] })] }), this.state.message && (_jsx("p", { className: "mb-3 text-[12px] text-text-tertiary break-words", children: this.state.message })), _jsxs(Button, { variant: "accent", size: "xs", "aria-label": "Retry", onClick: this.handleRetry, children: [_jsx(RefreshCw, { className: "size-3" }), "Retry"] })] }) }));
    }
}
