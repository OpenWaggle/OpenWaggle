import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Bug, CheckCircle2, CircleAlert, Copy, ExternalLink, HelpCircle, Lightbulb, Loader2, } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { api } from '@/shared/lib/ipc';
import { createRendererLogger } from '@/shared/lib/logger';
import { Button } from '@/shared/ui/Button';
import { Checkbox } from '@/shared/ui/Checkbox';
import { Textarea } from '@/shared/ui/Textarea';
import { TextInput } from '@/shared/ui/TextInput';
const logger = createRendererLogger('feedback');
const DESCRIPTION_ROWS = 4;
const FEEDBACK_TITLE_INPUT_ID = 'feedback-title';
const FEEDBACK_DESCRIPTION_INPUT_ID = 'feedback-description';
const CATEGORIES = [
    { value: 'bug', label: 'Bug', icon: _jsx(Bug, { className: "size-3.5" }) },
    { value: 'feature', label: 'Feature', icon: _jsx(Lightbulb, { className: "size-3.5" }) },
    { value: 'question', label: 'Question', icon: _jsx(HelpCircle, { className: "size-3.5" }) },
];
export function FeedbackModalBody({ fb, ghReady, errorContext, lastUserMessage, }) {
    return (_jsxs("div", { className: "space-y-4 p-4", children: [_jsx("div", { className: "flex gap-2", children: CATEGORIES.map((cat) => (_jsxs(Button, { variant: fb.category === cat.value ? 'accent' : 'secondary', onClick: () => fb.setCategory(cat.value), children: [cat.icon, cat.label] }, cat.value))) }), _jsxs("label", { className: "block", htmlFor: FEEDBACK_TITLE_INPUT_ID, children: [_jsx("span", { className: "mb-1.5 block text-[13px] font-medium text-text-secondary", children: "Title" }), _jsx(TextInput, { id: FEEDBACK_TITLE_INPUT_ID, type: "text", value: fb.title, onChange: (e) => fb.setTitle(e.target.value), placeholder: "Brief summary of the issue" })] }), _jsxs("label", { className: "block", htmlFor: FEEDBACK_DESCRIPTION_INPUT_ID, children: [_jsx("span", { className: "mb-1.5 block text-[13px] font-medium text-text-secondary", children: "Description" }), _jsx(Textarea, { id: FEEDBACK_DESCRIPTION_INPUT_ID, rows: DESCRIPTION_ROWS, value: fb.description, onChange: (e) => fb.setDescription(e.target.value), placeholder: "Steps to reproduce, expected vs. actual behavior...", resize: "none", className: "rounded-md border-border text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent/50" })] }), _jsx(FeedbackAttachmentOptions, { fb: fb, errorContext: errorContext, lastUserMessage: lastUserMessage }), fb.ghStatus !== null && _jsx(GhCliStatusBanner, { fb: fb, ghReady: ghReady }), fb.error && _jsx("p", { className: "text-[13px] text-error", children: fb.error })] }));
}
function FeedbackAttachmentOptions({ fb, errorContext, lastUserMessage, }) {
    return (_jsxs("div", { className: "rounded-md border border-border bg-bg p-3", children: [_jsx("p", { className: "mb-2 text-[12px] font-medium text-text-tertiary", children: "Include with report" }), _jsxs("div", { className: "space-y-1.5", children: [_jsx(ToggleRow, { label: "System info (OS, versions)", checked: fb.includeSystemInfo, onChange: fb.setIncludeSystemInfo }), _jsx(ToggleRow, { label: "Recent logs (last 100 lines)", checked: fb.includeLogs, onChange: fb.setIncludeLogs }), _jsx(ToggleRow, { label: "Last error context", checked: fb.includeErrorContext, onChange: fb.setIncludeErrorContext, disabled: !errorContext }), _jsx(ToggleRow, { label: "Last user message", checked: fb.includeLastMessage, onChange: fb.setIncludeLastMessage, disabled: !lastUserMessage }), _jsx(ToggleRow, { label: "Model & provider info", checked: fb.includeModelInfo, onChange: fb.setIncludeModelInfo })] })] }));
}
function GhCliStatusBanner({ fb, ghReady, }) {
    return (_jsx("div", { className: cn('flex items-center gap-2 rounded-md border px-3 py-2 text-[13px]', ghReady
            ? 'border-success/30 bg-success/6 text-success'
            : 'border-warning/30 bg-warning/6 text-warning'), children: ghReady ? (_jsxs(_Fragment, { children: [_jsx(CheckCircle2, { className: "size-3.5 shrink-0" }), "Ready to submit via GitHub CLI"] })) : (_jsxs(_Fragment, { children: [_jsx(CircleAlert, { className: "size-3.5 shrink-0" }), _jsx(GhCliHelpText, { available: !!fb.ghStatus?.available })] })) }));
}
function GhCliHelpText({ available }) {
    return (_jsxs("span", { children: [available ? 'GitHub CLI not authenticated — run ' : 'GitHub CLI not found — install from ', available ? (_jsx("code", { className: "rounded bg-bg px-1 py-0.5 text-[12px]", children: "gh auth login" })) : (_jsx(Button, { variant: "link", size: "none", onClick: () => {
                    api.openExternal('https://cli.github.com').catch((err) => {
                        logger.warn('Failed to open external URL', { error: String(err) });
                    });
                }, children: "cli.github.com" })), ' — or use "Copy & Open GitHub" below'] }));
}
export function FeedbackModalFooter({ fb, canSubmit, ghReady, onClose }) {
    return (_jsxs("div", { className: "flex items-center justify-end gap-2 border-t border-border px-4 py-3", children: [_jsx(Button, { variant: "secondary", onClick: onClose, children: "Cancel" }), _jsxs(Button, { variant: "secondary", onClick: () => void fb.copyAndOpen(), children: [_jsx(Copy, { className: "size-3" }), "Copy & Open GitHub", _jsx(ExternalLink, { className: "size-3" })] }), _jsxs(Button, { variant: canSubmit && ghReady ? 'primary' : 'secondary', onClick: () => void fb.submit(), disabled: !canSubmit || !ghReady, children: [fb.submitting && _jsx(Loader2, { className: "size-3.5 animate-spin" }), "Submit Issue"] })] }));
}
function ToggleRow({ label, checked, onChange, disabled }) {
    return (_jsx(Checkbox, { checked: checked && !disabled, onChange: (e) => onChange(e.target.checked), disabled: disabled, label: label, labelClassName: cn(disabled ? 'text-text-tertiary/50' : 'text-text-secondary') }));
}
