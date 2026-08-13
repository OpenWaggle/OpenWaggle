import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { DIFF_SYNTAX_THEMES, DIFF_VIEWS } from '@shared/types/settings';
import { usePreferencesStore } from '@/features/settings/state';
import { Button } from '@/shared/ui/Button';
import { SyntaxThemePreview } from './SyntaxThemePreview';
const SYNTAX_THEME_LABELS = {
    'pierre-dark': 'Default',
    'pierre-dark-soft': 'Soft',
    'pierre-dark-vibrant': 'Vibrant',
    'pierre-dark-protanopia-deuteranopia': 'Protanopia / deuteranopia safe',
    'pierre-dark-tritanopia': 'Tritanopia safe',
};
const SYNTAX_THEME_DESCRIPTIONS = {
    'pierre-dark': 'Balanced contrast for everyday review.',
    'pierre-dark-soft': 'Lower contrast, easier on long reading sessions.',
    'pierre-dark-vibrant': 'Higher saturation for stronger token separation.',
    'pierre-dark-protanopia-deuteranopia': 'Avoids red/green pairs that are hard to distinguish.',
    'pierre-dark-tritanopia': 'Avoids blue/yellow pairs that are hard to distinguish.',
};
const DIFF_VIEW_LABELS = {
    unified: 'Unified',
    split: 'Split',
};
const DIFF_VIEW_DESCRIPTIONS = {
    unified: 'One column, additions and deletions interleaved.',
    split: 'Side-by-side, old on the left and new on the right.',
};
const ROW_CLASS = 'flex w-full items-center justify-between border-b border-border px-5 py-3 text-left last:border-b-0 hover:bg-bg-hover';
function RadioDot({ active }) {
    return (_jsx("div", { className: `size-3 shrink-0 rounded-full border ${active ? 'border-accent bg-accent' : 'border-border-light'}` }));
}
/**
 * Appearance settings.
 *
 * The Syntax theme sits deliberately outside the Design token contract (ADR 0013
 * amendment): it colours language grammar scopes, not semantic roles, which is
 * why it is user-selectable on its own while the diff chrome follows the app's
 * Appearance. The colour-blind-safe variants are the main reason this is a real
 * setting rather than a constant.
 */
export function AppearanceSection() {
    const diffSyntaxTheme = usePreferencesStore((s) => s.settings.diffSyntaxTheme);
    const diffView = usePreferencesStore((s) => s.settings.diffView);
    const diffWrapLines = usePreferencesStore((s) => s.settings.diffWrapLines);
    const setDiffSyntaxTheme = usePreferencesStore((s) => s.setDiffSyntaxTheme);
    const setDiffView = usePreferencesStore((s) => s.setDiffView);
    const setDiffWrapLines = usePreferencesStore((s) => s.setDiffWrapLines);
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "space-y-3", children: [_jsx("h3", { className: "text-[16px] font-semibold text-text-primary", children: "Diff view" }), _jsx("p", { className: "text-[12px] text-text-tertiary", children: "Applies to the diff panel. The panel's own toggles change this same setting." }), _jsx("div", { className: "overflow-hidden rounded-lg border border-border bg-diff-header-bg", children: DIFF_VIEWS.map((view) => (_jsxs(Button, { variant: "unstyled", type: "button", "aria-pressed": diffView === view, onClick: () => void setDiffView(view), className: ROW_CLASS, children: [_jsxs("div", { className: "flex flex-col gap-0.5", children: [_jsx("span", { className: "text-[13px] font-medium text-text-primary", children: DIFF_VIEW_LABELS[view] }), _jsx("span", { className: "text-[12px] text-text-tertiary", children: DIFF_VIEW_DESCRIPTIONS[view] })] }), _jsx(RadioDot, { active: diffView === view })] }, view))) })] }), _jsxs("div", { className: "space-y-3", children: [_jsx("h3", { className: "text-[16px] font-semibold text-text-primary", children: "Long lines" }), _jsx("div", { className: "overflow-hidden rounded-lg border border-border bg-diff-header-bg", children: _jsxs(Button, { variant: "unstyled", type: "button", role: "switch", "aria-label": "Wrap long lines", "aria-checked": diffWrapLines, onClick: () => void setDiffWrapLines(!diffWrapLines), className: ROW_CLASS, children: [_jsxs("div", { className: "flex flex-col gap-0.5", children: [_jsx("span", { className: "text-[13px] font-medium text-text-primary", children: "Wrap long lines" }), _jsx("span", { className: "text-[12px] text-text-tertiary", children: "Wrap instead of scrolling horizontally, so review controls stay in view." })] }), _jsx("div", { className: `flex h-4 w-7 shrink-0 items-center rounded-full border px-0.5 transition-colors ${diffWrapLines
                                        ? 'justify-end border-accent bg-accent/30'
                                        : 'justify-start border-border-light'}`, children: _jsx("div", { className: `size-3 rounded-full ${diffWrapLines ? 'bg-accent' : 'bg-text-muted'}` }) })] }) })] }), _jsxs("div", { className: "space-y-3", children: [_jsx("h3", { className: "text-[16px] font-semibold text-text-primary", children: "Syntax theme" }), _jsx("p", { className: "text-[12px] text-text-tertiary", children: "Colours code text inside diffs. The panel's own colours follow the app appearance." }), _jsx(SyntaxThemePreview, { theme: diffSyntaxTheme }), _jsx("div", { className: "overflow-hidden rounded-lg border border-border bg-diff-header-bg", children: DIFF_SYNTAX_THEMES.map((theme) => (_jsxs(Button, { variant: "unstyled", type: "button", "aria-pressed": diffSyntaxTheme === theme, onClick: () => void setDiffSyntaxTheme(theme), className: ROW_CLASS, children: [_jsxs("div", { className: "flex flex-col gap-0.5", children: [_jsx("span", { className: "text-[13px] font-medium text-text-primary", children: SYNTAX_THEME_LABELS[theme] }), _jsx("span", { className: "text-[12px] text-text-tertiary", children: SYNTAX_THEME_DESCRIPTIONS[theme] })] }), _jsx(RadioDot, { active: diffSyntaxTheme === theme })] }, theme))) })] })] }));
}
