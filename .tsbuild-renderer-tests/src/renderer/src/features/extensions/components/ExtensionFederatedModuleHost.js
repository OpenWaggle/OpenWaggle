import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { RefreshCw, ShieldAlert } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { federatedModuleMountKey, federatedModuleSurfacePayloadJson, initialMountStatus, mountExtensionFrame, supportsExtensionExecutionPlacement, supportsExtensionFrameRuntime, supportsExtensionFrameRuntimeKind, } from '../lib/extension-federated-frame-mount';
import { EXTENSION_FEDERATED_MODULE_IFRAME_SANDBOX } from '../lib/extension-frame-host';
import { createExtensionModuleUrl } from '../lib/extension-module-url';
const DEFAULT_FRAME_AUTO_MIN_HEIGHT = 96;
const DEFAULT_FRAME_AUTO_MAX_HEIGHT = 520;
function clampFrameHeight(input) {
    const measuredHeight = input.height ?? input.minHeight;
    return Math.min(Math.max(Math.ceil(measuredHeight), input.minHeight), input.maxHeight);
}
function activeFrameHeight(input) {
    return input.reportedHeight?.mountKey === input.mountKey ? input.reportedHeight.height : null;
}
function hostLayout(input) {
    const containerLayout = input.fill
        ? 'flex size-full min-h-0 flex-col'
        : input.shouldAutoHeight
            ? 'flex min-h-0 flex-col'
            : 'flex min-h-[220px] flex-col';
    const containerChrome = input.chrome === 'card'
        ? 'rounded-md border border-border/70 bg-bg-secondary/30 p-3'
        : 'bg-transparent';
    const iframeClassName = input.fill
        ? 'min-h-0 w-full flex-1 bg-transparent'
        : input.shouldAutoHeight
            ? 'w-full shrink-0 bg-transparent'
            : 'min-h-[220px] w-full flex-1 bg-transparent';
    return { containerChrome, containerLayout, iframeClassName };
}
function statusFor(input) {
    return input.reportedStatus?.mountKey === input.mountKey
        ? input.reportedStatus.status
        : initialMountStatus({
            frameRuntimeSupported: input.frameRuntimeSupported,
            moduleUrl: input.moduleUrl,
        });
}
function sameMountStatus(left, right) {
    if (left.kind !== right.kind) {
        return false;
    }
    if (left.kind === 'error') {
        return right.kind === 'error' && left.message === right.message;
    }
    return true;
}
function MountStatusBanner({ status }) {
    if (status.kind === 'loading') {
        return (_jsxs("div", { className: "mb-3 flex items-center gap-2 text-[12px] text-text-tertiary", children: [_jsx(RefreshCw, { className: "size-3 animate-spin text-accent" }), "Mounting extension module..."] }));
    }
    if (status.kind === 'error') {
        return (_jsxs("div", { role: "alert", className: "mb-3 flex items-start gap-2 text-[12px] text-error", children: [_jsx(ShieldAlert, { className: "mt-0.5 size-3 shrink-0" }), _jsx("span", { children: status.message })] }));
    }
    return null;
}
export function ExtensionFederatedModuleHost({ entry, autoHeight = false, className, chrome = 'card', fill = false, maxAutoHeight = DEFAULT_FRAME_AUTO_MAX_HEIGHT, minAutoHeight = DEFAULT_FRAME_AUTO_MIN_HEIGHT, onSurfaceAction, surfacePayload, }) {
    const frameRef = useRef(null);
    const onSurfaceActionRef = useRef(onSurfaceAction);
    const mountEntryRef = useRef(entry);
    const frameId = useId();
    const [reportedHeight, setReportedHeight] = useState(null);
    const [reportedStatus, setReportedStatus] = useState(null);
    const moduleUrl = createExtensionModuleUrl(entry);
    const frameRuntimeSupported = supportsExtensionFrameRuntime(entry);
    const surfacePayloadJson = federatedModuleSurfacePayloadJson(surfacePayload);
    const mountKey = federatedModuleMountKey(entry, moduleUrl, surfacePayloadJson);
    const shouldAutoHeight = autoHeight && !fill;
    const layout = hostLayout({ chrome, fill, shouldAutoHeight });
    const resolvedAutoHeight = clampFrameHeight({
        height: activeFrameHeight({ mountKey, reportedHeight }),
        minHeight: minAutoHeight,
        maxHeight: maxAutoHeight,
    });
    const status = statusFor({ frameRuntimeSupported, moduleUrl, mountKey, reportedStatus });
    useEffect(() => {
        onSurfaceActionRef.current = onSurfaceAction;
    }, [onSurfaceAction]);
    useEffect(() => {
        mountEntryRef.current = entry;
    }, [entry]);
    useEffect(() => {
        const mountEntry = mountEntryRef.current;
        return mountExtensionFrame({
            entry: mountEntry,
            frame: frameRef.current,
            frameId,
            frameRuntimeSupported,
            getCurrentFrameWindow: () => frameRef.current?.contentWindow,
            moduleUrl,
            mountKey,
            onSurfaceAction: (actionId, payload) => onSurfaceActionRef.current?.(actionId, payload),
            reportHeight: shouldAutoHeight
                ? (height) => {
                    setReportedHeight((previous) => previous?.mountKey === mountKey && previous.height === height
                        ? previous
                        : { height, mountKey });
                }
                : undefined,
            reportStatus: (status) => {
                setReportedStatus((previous) => previous?.mountKey === status.mountKey && sameMountStatus(previous.status, status.status)
                    ? previous
                    : status);
            },
            surfacePayloadJson,
        });
    }, [frameId, frameRuntimeSupported, moduleUrl, mountKey, shouldAutoHeight, surfacePayloadJson]);
    if (!supportsExtensionFrameRuntimeKind(entry)) {
        return (_jsx("div", { role: "alert", className: cn('rounded-md border border-error/25 bg-error/5 p-3 text-[12px] text-error', className), children: "Unsupported extension runtime." }));
    }
    if (!supportsExtensionExecutionPlacement(entry)) {
        return (_jsx("div", { role: "alert", className: cn('rounded-md border border-border/70 bg-bg-secondary/40 p-3 text-[12px] text-text-tertiary', className), children: "Unsupported extension execution placement." }));
    }
    const iframeStyle = shouldAutoHeight ? { height: `${resolvedAutoHeight}px` } : undefined;
    return (_jsxs("div", { className: cn(layout.containerLayout, layout.containerChrome, className), children: [_jsx(MountStatusBanner, { status: status }), _jsx("iframe", { className: layout.iframeClassName, "data-extension-frame-id": frameId, ref: frameRef, referrerPolicy: "no-referrer", sandbox: EXTENSION_FEDERATED_MODULE_IFRAME_SANDBOX, style: iframeStyle, title: `Extension module: ${entry.title}` })] }));
}
