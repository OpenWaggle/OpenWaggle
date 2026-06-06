import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { safeDecodeUnknown } from '@shared/schema'
import { jsonValueSchema } from '@shared/schemas/validation'
import type { ExtensionInvokeInput, ExtensionInvokeResult } from '@shared/types/extension-broker'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import type { JsonValue } from '@shared/types/json'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { refreshPreferencesAfterExtensionInvoke } from './extension-broker-preferences'
import {
  createExtensionFrameDocument,
  decodeExtensionFrameMessage,
  type ExtensionFrameInvokeMessage,
  extensionInvokeInputFromFrame,
  postFrameMessage,
} from './extension-frame-host'

const EXTENSION_FRAME_DOCUMENT_TYPE = 'text/html'
const EXTERNAL_LINK_PROTOCOLS = new Set(['http:', 'https:'])
const logger = createRendererLogger('extension-frame')

export type MountStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'mounted' }
  | { readonly kind: 'error'; readonly message: string }

export interface ReportedMountStatus {
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
  readonly reportHeight?: (height: number) => void
  readonly reportStatus: (status: ReportedMountStatus) => void
  readonly surfacePayloadJson?: string
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
  readonly shouldPostResult: (frameWindow: Window) => boolean
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

  if (!input.shouldPostResult(input.frameWindow)) {
    return
  }

  postFrameMessage(input.frameWindow, input.frameId, {
    type: 'invoke-result',
    requestId: input.message.requestId,
    result,
  })
}

export function missingEntryPathStatus(): MountStatus {
  return {
    kind: 'error',
    message: 'Extension contribution is missing its federated module entry path.',
  }
}

export function supportsExtensionExecutionPlacement(entry: ExtensionContributionRegistryEntry) {
  return (
    entry.execution === OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER ||
    entry.execution === OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.FRAME
  )
}

export function supportsFederatedModuleFrameRuntime(entry: ExtensionContributionRegistryEntry) {
  return (
    entry.runtime === OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE &&
    supportsExtensionExecutionPlacement(entry)
  )
}

export function federatedModuleMountKey(
  entry: ExtensionContributionRegistryEntry,
  moduleUrl: string | null,
  surfacePayloadJson: string | undefined,
) {
  return JSON.stringify([
    entry.extensionId,
    entry.contributionId,
    entry.execution ?? '',
    moduleUrl,
    surfacePayloadJson === undefined ? ['absent'] : ['present', surfacePayloadJson],
  ])
}

export function federatedModuleSurfacePayloadJson(surfacePayload: JsonValue | undefined) {
  return surfacePayload === undefined ? undefined : JSON.stringify(surfacePayload)
}

function surfacePayloadFromJson(surfacePayloadJson: string | undefined): JsonValue | undefined {
  if (surfacePayloadJson === undefined) {
    return undefined
  }

  try {
    const decoded = safeDecodeUnknown(jsonValueSchema, JSON.parse(surfacePayloadJson))
    return decoded.success ? decoded.data : undefined
  } catch {
    return undefined
  }
}

function createFrameDocumentUrl(frameDocument: string) {
  return URL.createObjectURL(new Blob([frameDocument], { type: EXTENSION_FRAME_DOCUMENT_TYPE }))
}

function normalizedExternalUrl(url: string) {
  try {
    const parsedUrl = new URL(url)
    return EXTERNAL_LINK_PROTOCOLS.has(parsedUrl.protocol) ? parsedUrl.toString() : null
  } catch {
    return null
  }
}

async function openFrameExternalUrl(url: string) {
  const externalUrl = normalizedExternalUrl(url)
  if (externalUrl === null) {
    return
  }

  try {
    await api.openExternal(externalUrl)
  } catch (error) {
    logger.warn('Failed to open extension external URL', { error: String(error) })
  }
}

export function initialMountStatus(input: {
  readonly frameRuntimeSupported: boolean
  readonly moduleUrl: string | null
}): MountStatus {
  if (!input.frameRuntimeSupported) {
    return { kind: 'idle' }
  }

  return input.moduleUrl === null ? missingEntryPathStatus() : { kind: 'loading' }
}

export function mountExtensionFrame(input: MountExtensionFrameInput) {
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

  function reportFrameHeight(height: number) {
    if (Number.isFinite(height) && height > 0) {
      input.reportHeight?.(height)
    }
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

    if (frameMessage.type === 'open-external') {
      void openFrameExternalUrl(frameMessage.url)
      return
    }

    if (frameMessage.type === 'resize') {
      reportFrameHeight(frameMessage.height)
      return
    }

    if (frameMessage.type === 'invoke') {
      void handleFrameInvoke({
        entry: input.entry,
        frameId: input.frameId,
        frameWindow: currentFrameWindow,
        message: frameMessage,
        shouldPostResult: (frameWindow) => active && input.getCurrentFrameWindow() === frameWindow,
      })
    }
  }

  window.addEventListener('message', handleFrameMessage)
  const frameDocumentUrl = createFrameDocumentUrl(
    createExtensionFrameDocument({
      entry: input.entry,
      frameId: input.frameId,
      moduleUrl: resolvedModuleUrl,
      surfacePayload: surfacePayloadFromJson(input.surfacePayloadJson),
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
