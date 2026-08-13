import { jsx as _jsx } from "react/jsx-runtime";
import { match } from '@diegogbrisa/ts-match';
import { Button } from '@/shared/ui/Button';
import { resolveQuickAction } from '../lib/git-quick-action';
/**
 * Presentational smart quick-action button. All decision logic lives in the
 * pure resolveQuickAction; this component only renders the resolved action and
 * dispatches the matching callback.
 */
export function GitQuickActionButton({ status, isBusy, onRunAction, onPull, onOpenChangeRequest, onPublish, }) {
    const quickAction = resolveQuickAction(status, isBusy);
    const handleClick = () => {
        match(quickAction.kind)
            .with('run_action', () => {
            if (quickAction.action)
                onRunAction(quickAction.action);
        })
            .with('run_pull', () => onPull())
            .with('open_pr', () => onOpenChangeRequest())
            .with('open_publish', () => onPublish())
            .with('show_hint', () => { })
            .exhaustive();
    };
    return (_jsx(Button, { variant: "primary", size: "xs", type: "button", disabled: quickAction.disabled, title: quickAction.hint, onClick: handleClick, children: quickAction.label }));
}
