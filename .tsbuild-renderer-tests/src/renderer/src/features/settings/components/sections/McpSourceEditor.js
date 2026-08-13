import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { FileJson2 } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { Textarea } from '@/shared/ui/Textarea';
const RAW_EDITOR_ROWS = 16;
export function McpSourceEditor({ selectedSource, rawJson, busy, onSave, onRawJsonChange, }) {
    return (_jsxs("div", { className: "rounded-lg border border-border bg-[#111418] p-5", children: [_jsxs("div", { className: "mb-3 flex items-start justify-between gap-4", children: [_jsxs("div", { className: "min-w-0", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(FileJson2, { className: "size-4 text-text-tertiary" }), _jsx("h3", { className: "text-[16px] font-semibold text-text-primary", children: "Edit selected source" })] }), _jsx("p", { className: "mt-1 truncate text-[12px] text-text-tertiary", children: selectedSource ? selectedSource.path : 'Select a source' }), selectedSource?.parseError && (_jsx("p", { role: "alert", className: "mt-2 rounded-md border border-error/25 bg-error/6 px-3 py-2 text-[12px] text-error", children: selectedSource.parseError }))] }), _jsx(Button, { variant: "accent", disabled: !selectedSource || busy, onClick: onSave, children: "Save JSON" })] }), _jsx(Textarea, { value: rawJson, rows: RAW_EDITOR_ROWS, spellCheck: false, variant: "mono", resize: "vertical", wrap: "off", highlightLanguage: "json", onChange: (event) => {
                    if (!selectedSource)
                        return;
                    onRawJsonChange(selectedSource.id, event.target.value);
                } }), _jsx("p", { className: "mt-2 text-[11px] text-text-muted", children: "Advanced config is preserved as JSON so every `pi-mcp-adapter` server and settings field remains available." })] }));
}
