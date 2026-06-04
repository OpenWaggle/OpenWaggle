import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionInvokeInput, ExtensionInvokeResult } from '@shared/types/extension-broker'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { RefreshCw, ShieldAlert } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { api } from '@/shared/lib/ipc'
import {
  createExtensionFrameSrcDoc,
  decodeExtensionFrameMessage,
  EXTENSION_FEDERATED_MODULE_IFRAME_SANDBOX,
  type ExtensionFrameInvokeMessage,
  extensionInvokeInputFromFrame,
  postFrameMessage,
} from '../lib/extension-frame-host'
import { createExtensionModuleUrl } from '../lib/extension-module-url'

type MountStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'mounted' }
  | { readonly kind: 'error'; readonly message: string }

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

function invokeBoundExtension(
  entry: ExtensionContributionRegistryEntry,
  input: ExtensionInvokeInput,
) {
  const projectPath = invocationProjectPath(input)
  if (projectPath !== null && !entry.projectPaths.includes(projectPath)) {
    return Promise.resolve(outOfScopeInvokeFailure(projectPath))
  }

  return api.invokeExtension(input)
}

async function handleFrameInvoke(input: {
  readonly entry: ExtensionContributionRegistryEntry
  readonly frameId: string
  readonly frameWindow: Window
  readonly message: ExtensionFrameInvokeMessage
}) {
  const decodedInput = extensionInvokeInputFromFrame(input.entry, input.message.input)
  const result =
    'ok' in decodedInput ? decodedInput : await invokeBoundExtension(input.entry, decodedInput)

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

export function ExtensionFederatedModuleHost({
  entry,
  className,
}: {
  readonly entry: ExtensionContributionRegistryEntry
  readonly className?: string
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const frameId = useId()
  const [status, setStatus] = useState<MountStatus>({ kind: 'idle' })
  const moduleUrl = createExtensionModuleUrl(entry)
  const hostRuntimeSupported =
    entry.runtime === OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE &&
    entry.execution === OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER

  useEffect(() => {
    if (!hostRuntimeSupported) {
      return
    }

    const frame = frameRef.current
    const resolvedModuleUrl = moduleUrl
    if (!frame || resolvedModuleUrl === null) {
      setStatus(missingEntryPathStatus())
      return
    }

    const frameWindow = frame.contentWindow
    if (!frameWindow) {
      setStatus({ kind: 'error', message: 'Extension frame is unavailable.' })
      return
    }
    const mountedFrameWindow = frameWindow

    let active = true
    setStatus({ kind: 'loading' })

    function handleFrameMessage(event: MessageEvent<unknown>) {
      const currentFrameWindow = frameRef.current?.contentWindow
      if (!active || event.source !== currentFrameWindow) {
        return
      }
      const frameMessage = decodeExtensionFrameMessage(event.data, frameId)
      if (frameMessage === null) {
        return
      }

      if (frameMessage.type === 'mounted') {
        setStatus({ kind: 'mounted' })
        return
      }

      if (frameMessage.type === 'error' || frameMessage.type === 'cleanup-error') {
        setStatus({ kind: 'error', message: frameMessage.message })
        return
      }

      if (frameMessage.type === 'invoke') {
        void handleFrameInvoke({
          entry,
          frameId,
          frameWindow: mountedFrameWindow,
          message: frameMessage,
        })
      }
    }

    window.addEventListener('message', handleFrameMessage)
    frame.srcdoc = createExtensionFrameSrcDoc({ entry, frameId, moduleUrl: resolvedModuleUrl })

    return () => {
      active = false
      postFrameMessage(mountedFrameWindow, frameId, { type: 'dispose' })
      frame.removeAttribute('srcdoc')
      window.removeEventListener('message', handleFrameMessage)
    }
  }, [entry, frameId, hostRuntimeSupported, moduleUrl])

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

  if (entry.execution !== OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER) {
    return (
      <div
        role="alert"
        className={cn(
          'rounded-md border border-border/70 bg-bg-secondary/40 p-3 text-[12px] text-text-tertiary',
          className,
        )}
      >
        Frame execution uses the federated-module contract but is not mounted in this slice.
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
