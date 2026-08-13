import { jsx as _jsx } from "react/jsx-runtime";
import { SkillsPanel } from '@/features/skills/components';
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary';
export function SkillsRouteSurface() {
    return (_jsx("div", { className: "flex min-h-0 min-w-0 flex-1 overflow-hidden", children: _jsx(PanelErrorBoundary, { name: "Skills", className: "flex min-w-0 flex-1 overflow-hidden", children: _jsx(SkillsPanel, {}) }) }));
}
