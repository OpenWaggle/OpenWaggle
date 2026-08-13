import { jsx as _jsx } from "react/jsx-runtime";
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions';
import { cn } from '@/shared/lib/cn';
import { ExtensionFederatedModuleHost } from './ExtensionFederatedModuleHost';
export function ExtensionContributionRuntimeHost({ entry, autoHeight = false, className, chrome = 'card', fill = false, maxAutoHeight, minAutoHeight, onSurfaceAction, surfacePayload, }) {
    const sharedHostProps = {
        autoHeight,
        chrome,
        className,
        entry,
        fill,
        maxAutoHeight,
        minAutoHeight,
        onSurfaceAction,
        surfacePayload,
    };
    if (entry.runtime === OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE ||
        entry.runtime === OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.TRUSTED_RENDERER) {
        return _jsx(ExtensionFederatedModuleHost, { ...sharedHostProps });
    }
    return (_jsx("div", { role: "alert", className: cn('rounded-md border border-error/25 bg-error/5 p-3 text-[12px] text-error', className), children: "Unsupported extension runtime." }));
}
