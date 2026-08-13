import { jsx as _jsx } from "react/jsx-runtime";
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions';
import { Button } from '@/shared/ui/Button';
import { packageTitle } from './extension-package-card-model';
export function ReloadAction({ extensionPackage, busy, enabled, onReload, }) {
    if (!enabled) {
        return null;
    }
    const reloadLabel = OPENWAGGLE_EXTENSION.LIFECYCLE.RELOAD_ACTION_LABEL;
    return (_jsx(Button, { size: "xs", variant: "secondary", disabled: busy, onClick: onReload, "aria-label": `${reloadLabel} ${packageTitle(extensionPackage)}`, children: busy ? 'Saving…' : reloadLabel }));
}
export function RemoveAction({ extensionPackage, busy, onRemove, }) {
    return (_jsx(Button, { size: "xs", variant: "danger", disabled: busy, onClick: onRemove, "aria-label": `Remove ${packageTitle(extensionPackage)}`, title: "Remove the package from disk and tear down extension runtime access.", children: busy ? 'Saving…' : 'Remove' }));
}
