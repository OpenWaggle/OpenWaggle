import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Archive, ChevronDown, ChevronRight, GitBranch } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { formatTokens } from '@/shared/lib/format-tokens';
import { Button } from '@/shared/ui/Button';
import { StreamingText } from './StreamingText';
export function CompactionSummaryCard({ id, summary, tokensBefore, onBranchFromMessage, }) {
    const [expanded, setExpanded] = useState(false);
    const tokenLabel = formatTokens(tokensBefore);
    return (_jsxs("section", { className: "group/compaction-summary rounded-xl border border-border-light bg-bg-secondary/80 p-3 text-text-secondary shadow-sm", children: [_jsxs("div", { className: "flex items-start gap-2", children: [_jsxs(Button, { variant: "unstyled", type: "button", onClick: () => setExpanded((value) => !value), className: "flex min-w-0 flex-1 items-start gap-2 text-left", "aria-expanded": expanded, "aria-label": expanded ? 'Collapse compaction summary' : 'Expand compaction summary', children: [_jsx("span", { className: "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent", children: _jsx(Archive, { className: "size-3" }) }), _jsxs("span", { className: "min-w-0 flex-1", children: [_jsx("span", { className: "block text-[12px] font-semibold text-text-secondary", children: "Compaction" }), _jsxs("span", { className: "block text-[12px] text-text-tertiary", children: ["Compacted from ", tokenLabel, " tokens"] })] }), _jsx("span", { className: "mt-0.5 text-text-tertiary", children: expanded ? _jsx(ChevronDown, { className: "size-4" }) : _jsx(ChevronRight, { className: "size-4" }) })] }), onBranchFromMessage ? (_jsx(Button, { variant: "unstyled", type: "button", title: "Branch from compaction summary", onClick: () => onBranchFromMessage(id), className: "mt-0.5 opacity-0 text-text-muted transition-opacity hover:text-text-secondary group-hover/compaction-summary:opacity-100 focus:opacity-100", children: _jsx(GitBranch, { className: "size-3.5" }) })) : null] }), expanded ? (_jsx("div", { className: cn('mt-3 border-t border-border pt-3 text-[13px] text-text-secondary'), children: _jsx(StreamingText, { text: summary }) })) : null] }));
}
