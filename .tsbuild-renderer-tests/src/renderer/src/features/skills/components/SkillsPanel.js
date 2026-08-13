import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { RefreshCw, Sparkles } from 'lucide-react';
import { useProject } from '@/features/sessions/hooks';
import { useSkills } from '@/features/skills/hooks/useSkills';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/Button';
import { Spinner } from '@/shared/ui/Spinner';
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch';
import { SkillPreviewPane } from './SkillPreviewPane';
import { StatusBadge } from './SkillStatusBadge';
import { EmptySkillsState, NoProjectState } from './SkillsPanelStates';
function SkillsPanelHeader({ onRefresh }) {
    return (_jsxs("div", { className: "flex items-center justify-between border-b border-border px-5 py-3", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-sm font-semibold text-text-primary", children: "Skills" }), _jsx("p", { className: "text-[12px] text-text-tertiary", children: "Discover and manage project skills." })] }), _jsx(Button, { variant: "secondary", size: "sm", leftIcon: _jsx(RefreshCw, { className: "size-3.5" }), onClick: onRefresh, children: "Refresh" })] }));
}
function StandardsSection({ projectPath, standardsStatus, }) {
    return (_jsxs("section", { className: "border-b border-border px-4 py-3", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-[12px] font-medium text-text-secondary", children: "AGENTS.md" }), _jsx(StatusBadge, { status: standardsStatus?.agents ?? 'missing' })] }), _jsx("p", { className: "mt-1 truncate text-[11px] text-text-tertiary", children: standardsStatus?.agentsPath || `${projectPath}/AGENTS.md` }), standardsStatus?.error && (_jsx("p", { className: "mt-1 text-[11px] text-error", children: standardsStatus.error }))] }));
}
function SkillListItem({ skill, selected, onSelect, onToggle, }) {
    return (_jsxs("div", { className: cn('flex w-full items-start gap-2 rounded-md border px-2.5 py-2 transition-colors', selected
            ? 'border-accent/40 bg-bg-hover'
            : 'border-transparent hover:border-border hover:bg-bg-hover/70'), children: [_jsxs(Button, { variant: "unstyled", type: "button", onClick: onSelect, className: "min-w-0 flex-1 text-left", children: [_jsx("span", { className: "block truncate text-[12px] font-medium text-text-primary", children: skill.name }), _jsx("p", { className: "mt-1 text-[11px] text-text-tertiary", children: skill.description || 'No description' }), _jsxs("div", { className: "mt-1.5 flex items-center gap-2 text-[10px] text-text-muted", children: [_jsx("span", { children: skill.id }), skill.hasScripts && (_jsxs("span", { className: "inline-flex items-center gap-1", children: [_jsx(Sparkles, { className: "size-3" }), "scripts"] })), skill.loadStatus === 'error' && _jsx("span", { className: "text-error", children: "invalid" })] })] }), _jsx(ToggleSwitch, { checked: skill.enabled, label: `${skill.enabled ? 'Disable' : 'Enable'} ${skill.name}`, size: "compact", onCheckedChange: onToggle })] }));
}
function SkillsList({ catalog, isLoading, selectedSkillId, selectSkill, toggleSkill, }) {
    if (isLoading) {
        return (_jsx("div", { className: "flex items-center justify-center py-6 text-text-tertiary", children: _jsx(Spinner, {}) }));
    }
    if ((catalog?.skills.length ?? 0) === 0) {
        return _jsx(EmptySkillsState, {});
    }
    return (_jsx("div", { className: "space-y-1", children: catalog?.skills.map((skill) => (_jsx(SkillListItem, { skill: skill, selected: selectedSkillId === skill.id, onSelect: () => selectSkill(skill.id), onToggle: (enabled) => void toggleSkill(skill.id, enabled) }, skill.id))) }));
}
function SkillsSidebar({ projectPath, standardsStatus, catalog, isLoading, selectedSkillId, selectSkill, toggleSkill, }) {
    return (_jsxs("div", { className: "flex min-h-0 flex-col border-r border-border", children: [_jsx(StandardsSection, { projectPath: projectPath, standardsStatus: standardsStatus }), _jsx("section", { className: "min-h-0 flex-1 overflow-y-auto p-2", children: _jsx(SkillsList, { catalog: catalog, isLoading: isLoading, selectedSkillId: selectedSkillId, selectSkill: selectSkill, toggleSkill: toggleSkill }) })] }));
}
function SkillsPanelContent({ projectPath }) {
    const { standardsStatus, catalog, selectedSkillId, previewMarkdown, isLoading, isPreviewLoading, error, refresh, selectSkill, toggleSkill, } = useSkills(projectPath);
    const selectedSkill = catalog?.skills.find((skill) => skill.id === selectedSkillId) ?? null;
    return (_jsxs("div", { className: "flex h-full flex-col overflow-hidden bg-bg", children: [_jsx(SkillsPanelHeader, { onRefresh: () => void refresh() }), _jsxs("div", { className: "grid min-h-0 flex-1 grid-cols-[300px_1fr]", children: [_jsx(SkillsSidebar, { projectPath: projectPath, standardsStatus: standardsStatus, catalog: catalog, isLoading: isLoading, selectedSkillId: selectedSkillId, selectSkill: selectSkill, toggleSkill: toggleSkill }), _jsx(SkillPreviewPane, { error: error, selectedSkill: selectedSkill, isPreviewLoading: isPreviewLoading, previewMarkdown: previewMarkdown })] })] }));
}
export function SkillsPanel() {
    const { projectPath } = useProject();
    if (!projectPath) {
        return _jsx(NoProjectState, {});
    }
    return _jsx(SkillsPanelContent, { projectPath: projectPath });
}
