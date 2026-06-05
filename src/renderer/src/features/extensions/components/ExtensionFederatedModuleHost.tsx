import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionInvokeInput, ExtensionInvokeResult } from '@shared/types/extension-broker'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { RefreshCw, ShieldAlert } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { api } from '@/shared/lib/ipc'
import { refreshPreferencesAfterExtensionInvoke } from '../lib/extension-broker-preferences'
import {
  createExtensionFrameDocument,
  decodeExtensionFrameMessage,
  EXTENSION_FEDERATED_MODULE_IFRAME_SANDBOX,
  type ExtensionFrameInvokeMessage,
  extensionInvokeInputFromFrame,
  postFrameMessage,
} from '../lib/extension-frame-host'
import { createExtensionModuleUrl } from '../lib/extension-module-url'

const EXTENSION_FRAME_DOCUMENT_TYPE = 'text/html'

type MountStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'mounted' }
  | { readonly kind: 'error'; readonly message: string }

interface ReportedMountStatus {
  readonly mountKey: string
  readonly status: MountStatus
}

interface MountExtensionFrameInput {
  readonly entry: ExtensionContributionRegistryEntry
  readonly frame: HTMLIFrameElement | null
  readonly frameId: string
  readonly frameRuntimeSupported: boolean
  readonly getCurrentFrameWindow: () => Window | null | undefined
  readonly moduleUrl: string | null
  readonly mountKey: string
  readonly reportStatus: (status: ReportedMountStatus) => void
}

function invocationProjectPath(input: ExtensionInvokeInput) {
  return input.scope.kind === 'app' ? null : input.scope.projectPath
}

function outOfScopeInvokeFailure(projectPath: string): ExtensionInvokeResult {
  return {
    ok: false,
    error: {
      code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.OUT_OF_SCOPE,
      message: `Project "${projectPath}" is outside this extension contribution scope.`,
    },
  }
}

function describeInvokeError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function transportInvokeFailure(error: unknown): ExtensionInvokeResult {
  return {
    ok: false,
    error: {
      code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.TRANSPORT_FAILED,
      message: 'Extension broker transport failed.',
      issues: [describeInvokeError(error)],
    },
  }
}

function invokeBoundExtension(
  entry: ExtensionContributionRegistryEntry,
  input: ExtensionInvokeInput,
) {
  const projectPath = invocationProjectPath(input)
  if (projectPath !== null && !entry.projectPaths.includes(projectPath)) {
    return Promise.resolve(outOfScopeInvokeFailure(projectPath))
  }

  return api.invokeExtension(input).then(async (result) => {
    await refreshPreferencesAfterExtensionInvoke(result)
    return result
  })
}

async function handleFrameInvoke(input: {
  readonly entry: ExtensionContributionRegistryEntry
  readonly frameId: string
  readonly frameWindow: Window
  readonly message: ExtensionFrameInvokeMessage
}) {
  const decodedInput = extensionInvokeInputFromFrame(input.entry, input.message.input)
  const result = await (async () => {
    if ('ok' in decodedInput) {
      return decodedInput
    }

    try {
      return await invokeBoundExtension(input.entry, decodedInput)
    } catch (error) {
      return transportInvokeFailure(error)
    }
  })()

  postFrameMessage(input.frameWindow, input.frameId, {
    type: 'invoke-result',
    requestId: input.message.requestId,
    result,
  })
}

function missingEntryPathStatus(): MountStatus {
  return {
    kind: 'error',
    message: 'Extension contribution is missing its federated module entry path.',
  }
}

function supportsExtensionExecutionPlacement(entry: ExtensionContributionRegistryEntry) {
  return (
    entry.execution === OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER ||
    entry.execution === OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.FRAME
  )
}

function supportsFederatedModuleFrameRuntime(entry: ExtensionContributionRegistryEntry) {
  return (
    entry.runtime === OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE &&
    supportsExtensionExecutionPlacement(entry)
  )
}

function federatedModuleMountKey(
  entry: ExtensionContributionRegistryEntry,
  moduleUrl: string | null,
) {
  return JSON.stringify([entry.extensionId, entry.contributionId, entry.execution ?? '', moduleUrl])
}

function createFrameDocumentUrl(frameDocument: string) {
  return URL.createObjectURL(new Blob([frameDocument], { type: EXTENSION_FRAME_DOCUMENT_TYPE }))
}

function initialMountStatus(input: {
  readonly frameRuntimeSupported: boolean
  readonly moduleUrl: string | null
}): MountStatus {
  if (!input.frameRuntimeSupported) {
    return { kind: 'idle' }
  }

  return input.moduleUrl === null ? missingEntryPathStatus() : { kind: 'loading' }
}

function mountExtensionFrame(input: MountExtensionFrameInput) {
  if (!input.frameRuntimeSupported) {
    return
  }

  let active = true
  const frame = input.frame
  const resolvedModuleUrl = input.moduleUrl
  if (!frame || resolvedModuleUrl === null) {
    return () => {
      active = false
    }
  }

  if (!frame.contentWindow) {
    queueMicrotask(() => {
      if (!active) {
        return
      }
      input.reportStatus({
        mountKey: input.mountKey,
        status: { kind: 'error', message: 'Extension frame is unavailable.' },
      })
    })
    return () => {
      active = false
    }
  }

  function reportMountStatus(status: MountStatus) {
    input.reportStatus({ mountKey: input.mountKey, status })
  }

  function handleFrameMessage(event: MessageEvent<unknown>) {
    const currentFrameWindow = input.getCurrentFrameWindow()
    if (!active || !currentFrameWindow || event.source !== currentFrameWindow) {
      return
    }
    const frameMessage = decodeExtensionFrameMessage(event.data, input.frameId)
    if (frameMessage === null) {
      return
    }

    if (frameMessage.type === 'mounted') {
      reportMountStatus({ kind: 'mounted' })
      return
    }

    if (frameMessage.type === 'error' || frameMessage.type === 'cleanup-error') {
      reportMountStatus({ kind: 'error', message: frameMessage.message })
      return
    }

    if (frameMessage.type === 'invoke') {
      void handleFrameInvoke({
        entry: input.entry,
        frameId: input.frameId,
        frameWindow: currentFrameWindow,
        message: frameMessage,
      })
    }
  }

  window.addEventListener('message', handleFrameMessage)
  const frameDocumentUrl = createFrameDocumentUrl(
    createExtensionFrameDocument({
      entry: input.entry,
      frameId: input.frameId,
      moduleUrl: resolvedModuleUrl,
    }),
  )
  frame.src = frameDocumentUrl

  return () => {
    active = false
    const currentFrameWindow = frame.contentWindow
    if (currentFrameWindow) {
      postFrameMessage(currentFrameWindow, input.frameId, { type: 'dispose' })
    }
    frame.removeAttribute('src')
    URL.revokeObjectURL(frameDocumentUrl)
    window.removeEventListener('message', handleFrameMessage)
  }
}

export function ExtensionFederatedModuleHost({
  entry,
  className,
}: {
  readonly entry: ExtensionContributionRegistryEntry
  readonly className?: string
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const frameId = useId()
  const [reportedStatus, setReportedStatus] = useState<ReportedMountStatus | null>(null)
  const moduleUrl = createExtensionModuleUrl(entry)
  const frameRuntimeSupported = supportsFederatedModuleFrameRuntime(entry)
  const mountKey = federatedModuleMountKey(entry, moduleUrl)
  const status =
    reportedStatus?.mountKey === mountKey
      ? reportedStatus.status
      : initialMountStatus({ frameRuntimeSupported, moduleUrl })

  useEffect(() => {
    return mountExtensionFrame({
      entry,
      frame: frameRef.current,
      frameId,
      frameRuntimeSupported,
      getCurrentFrameWindow: () => frameRef.current?.contentWindow,
      moduleUrl,
      mountKey,
      reportStatus: setReportedStatus,
    })
  }, [entry, frameId, frameRuntimeSupported, moduleUrl, mountKey])

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

  return (
    <div className={cn('rounded-md border border-border/70 bg-bg-secondary/30 p-3', className)}>
      {status.kind === 'loading' ? (
        <div className="mb-3 flex items-center gap-2 text-[12px] text-text-tertiary">
          <RefreshCw className="size-3 animate-spin text-accent" />
          Mounting extension module...
        </div>
      ) : null}
      {status.kind === 'error' ? (
        <div role="alert" className="mb-3 flex items-start gap-2 text-[12px] text-error">
          <ShieldAlert className="mt-0.5 size-3 shrink-0" />
          <span>{status.message}</span>
        </div>
      ) : null}
      <iframe
        className="min-h-[220px] w-full bg-transparent"
        data-extension-frame-id={frameId}
        ref={frameRef}
        referrerPolicy="no-referrer"
        sandbox={EXTENSION_FEDERATED_MODULE_IFRAME_SANDBOX}
        title={`Extension module: ${entry.title}`}
      />
    </div>
  )
}
