import { jsx as _jsx } from "react/jsx-runtime";
import { useProject } from '@/features/sessions/hooks';
import { RunTargetPicker } from './RunTargetPicker';
export function ComposerBranchRow({ strip, onToast }) {
    const { projectPath } = useProject();
    if (!projectPath) {
        return null;
    }
    // Row layout is owned by the parent so this shares one row with the session
    // context row: mode on the left, the single run-target picker on the right.
    return _jsx(RunTargetPicker, { strip: strip, onToast: onToast });
}
