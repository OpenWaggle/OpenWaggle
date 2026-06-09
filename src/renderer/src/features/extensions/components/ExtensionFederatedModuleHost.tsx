import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import type { JsonValue } from '@shared/types/json'
import { RefreshCw, ShieldAlert } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import {
  federatedModuleMountKey,
  federatedModuleSurfacePayloadJson,
  initialMountStatus,
  mountExtensionFrame,
  type ReportedMountStatus,
  supportsExtensionExecutionPlacement,
  supportsFederatedModuleFrameRuntime,
} from '../lib/extension-federated-frame-mount'
import { EXTENSION_FEDERATED_MODULE_IFRAME_SANDBOX } from '../lib/extension-frame-host'
import { createExtensionModuleUrl } from '../lib/extension-module-url'

const DEFAULT_FRAME_AUTO_MIN_HEIGHT = 96
const DEFAULT_FRAME_AUTO_MAX_HEIGHT = 520

interface ReportedFrameHeight {
  readonly mountKey: string
  readonly height: number
}

function clampFrameHeight(input: {
  readonly height: number | null
  readonly minHeight: number
  readonly maxHeight: number
}) {
  const measuredHeight = input.height ?? input.minHeight
  return Math.min(Math.max(Math.ceil(measuredHeight), input.minHeight), input.maxHeight)
}

function activeFrameHeight(input: {
  readonly mountKey: string
  readonly reportedHeight: ReportedFrameHeight | null
}) {
  return input.reportedHeight?.mountKey === input.mountKey ? input.reportedHeight.height : null
}

function hostLayout(input: {
  readonly chrome: 'bare' | 'card'
  readonly fill: boolean
  readonly shouldAutoHeight: boolean
}) {
  const containerLayout = input.fill
    ? 'flex size-full min-h-0 flex-col'
    : input.shouldAutoHeight
      ? 'flex min-h-0 flex-col'
      : 'flex min-h-[220px] flex-col'
  const containerChrome =
    input.chrome === 'card'
      ? 'rounded-md border border-border/70 bg-bg-secondary/30 p-3'
      : 'bg-transparent'
  const iframeClassName = input.fill
    ? 'min-h-0 w-full flex-1 bg-transparent'
    : input.shouldAutoHeight
      ? 'w-full shrink-0 bg-transparent'
      : 'min-h-[220px] w-full flex-1 bg-transparent'

  return { containerChrome, containerLayout, iframeClassName }
}

function statusFor(input: {
  readonly frameRuntimeSupported: boolean
  readonly moduleUrl: string | null
  readonly mountKey: string
  readonly reportedStatus: ReportedMountStatus | null
}) {
  return input.reportedStatus?.mountKey === input.mountKey
    ? input.reportedStatus.status
    : initialMountStatus({
        frameRuntimeSupported: input.frameRuntimeSupported,
        moduleUrl: input.moduleUrl,
      })
}

function sameMountStatus(
  left: ReturnType<typeof initialMountStatus>,
  right: ReturnType<typeof initialMountStatus>,
) {
  if (left.kind !== right.kind) {
    return false
  }

  if (left.kind === 'error') {
    return right.kind === 'error' && left.message === right.message
  }

  return true
}

function MountStatusBanner({ status }: { readonly status: ReturnType<typeof initialMountStatus> }) {
  if (status.kind === 'loading') {
    return (
      <div className="mb-3 flex items-center gap-2 text-[12px] text-text-tertiary">
        <RefreshCw className="size-3 animate-spin text-accent" />
        Mounting extension module...
      </div>
    )
  }

  if (status.kind === 'error') {
    return (
      <div role="alert" className="mb-3 flex items-start gap-2 text-[12px] text-error">
        <ShieldAlert className="mt-0.5 size-3 shrink-0" />
        <span>{status.message}</span>
      </div>
    )
  }

  return null
}

export function ExtensionFederatedModuleHost({
  entry,
  autoHeight = false,
  className,
  chrome = 'card',
  fill = false,
  maxAutoHeight = DEFAULT_FRAME_AUTO_MAX_HEIGHT,
  minAutoHeight = DEFAULT_FRAME_AUTO_MIN_HEIGHT,
  onSurfaceAction,
  surfacePayload,
}: {
  readonly entry: ExtensionContributionRegistryEntry
  readonly autoHeight?: boolean
  readonly className?: string
  readonly chrome?: 'bare' | 'card'
  readonly fill?: boolean
  readonly maxAutoHeight?: number
  readonly minAutoHeight?: number
  readonly onSurfaceAction?: (actionId: string, payload?: JsonValue) => void
  readonly surfacePayload?: JsonValue
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const onSurfaceActionRef = useRef(onSurfaceAction)
  const mountEntryRef = useRef(entry)
  const frameId = useId()
  const [reportedHeight, setReportedHeight] = useState<ReportedFrameHeight | null>(null)
  const [reportedStatus, setReportedStatus] = useState<ReportedMountStatus | null>(null)
  const moduleUrl = createExtensionModuleUrl(entry)
  const frameRuntimeSupported = supportsFederatedModuleFrameRuntime(entry)
  const surfacePayloadJson = federatedModuleSurfacePayloadJson(surfacePayload)
  const mountKey = federatedModuleMountKey(entry, moduleUrl, surfacePayloadJson)
  const shouldAutoHeight = autoHeight && !fill
  const layout = hostLayout({ chrome, fill, shouldAutoHeight })
  const resolvedAutoHeight = clampFrameHeight({
    height: activeFrameHeight({ mountKey, reportedHeight }),
    minHeight: minAutoHeight,
    maxHeight: maxAutoHeight,
  })
  const status = statusFor({ frameRuntimeSupported, moduleUrl, mountKey, reportedStatus })

  useEffect(() => {
    onSurfaceActionRef.current = onSurfaceAction
  }, [onSurfaceAction])

  useEffect(() => {
    mountEntryRef.current = entry
  }, [entry])

  useEffect(() => {
    const mountEntry = mountEntryRef.current
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
            setReportedHeight((previous) =>
              previous?.mountKey === mountKey && previous.height === height
                ? previous
                : { height, mountKey },
            )
          }
        : undefined,
      reportStatus: (status) => {
        setReportedStatus((previous) =>
          previous?.mountKey === status.mountKey && sameMountStatus(previous.status, status.status)
            ? previous
            : status,
        )
      },
      surfacePayloadJson,
    })
  }, [frameId, frameRuntimeSupported, moduleUrl, mountKey, shouldAutoHeight, surfacePayloadJson])

  if (entry.runtime !== OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE) {
    return (
      <div
        role="alert"
        className={cn(
          'rounded-md border border-error/25 bg-error/5 p-3 text-[12px] text-error',
          className,
        )}
      >
        Unsupported extension runtime.
      </div>
    )
  }

  if (!supportsExtensionExecutionPlacement(entry)) {
    return (
      <div
        role="alert"
        className={cn(
          'rounded-md border border-border/70 bg-bg-secondary/40 p-3 text-[12px] text-text-tertiary',
          className,
        )}
      >
        Unsupported extension execution placement.
      </div>
    )
  }

  const iframeStyle = shouldAutoHeight ? { height: `${resolvedAutoHeight}px` } : undefined

  return (
    <div className={cn(layout.containerLayout, layout.containerChrome, className)}>
      <MountStatusBanner status={status} />
      <iframe
        className={layout.iframeClassName}
        data-extension-frame-id={frameId}
        ref={frameRef}
        referrerPolicy="no-referrer"
        sandbox={EXTENSION_FEDERATED_MODULE_IFRAME_SANDBOX}
        style={iframeStyle}
        title={`Extension module: ${entry.title}`}
      />
    </div>
  )
}
