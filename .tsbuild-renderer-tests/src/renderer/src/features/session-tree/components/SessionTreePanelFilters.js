import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Search } from 'lucide-react';
import { Select } from '@/shared/ui/Select';
import { TextInput } from '@/shared/ui/TextInput';
import { SESSION_TREE } from '../constants/session-tree';
export function SessionTreePanelFilters({ filters }) {
    return (_jsxs("div", { className: "grid h-12 shrink-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-4 border-b border-border px-4 py-2", children: [_jsxs("div", { className: "flex h-8 items-center gap-2", children: [_jsx("label", { htmlFor: "session-tree-filter", className: "text-[12px] text-text-tertiary", children: "Filter" }), _jsx(Select, { id: "session-tree-filter", value: filters.filterMode, onChange: (event) => filters.onFilterModeChange(event.target.value), children: SESSION_TREE.FILTER_OPTIONS.map((option) => (_jsx("option", { value: option.value, children: option.label }, option.value))) })] }), _jsxs("div", { className: "relative mx-auto w-full min-w-0", children: [_jsx(Search, { className: "pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-text-muted" }), _jsx(TextInput, { id: "session-tree-search", type: "search", value: filters.searchQuery, onChange: (event) => filters.onSearchQueryChange(event.target.value), placeholder: "Search nodes", inputSize: "sm", className: "rounded-lg border-input-card-border bg-bg-secondary pr-3 pl-9 text-text-secondary focus:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]", "aria-label": "Search Session Tree nodes" })] })] }));
}
