import { jsx as _jsx } from "react/jsx-runtime";
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary';
export function SettingsContributionSlotBoundary({ entry, children, }) {
    return (_jsx(PanelErrorBoundary, { name: `Extension settings: ${entry.title}`, children: children }));
}
