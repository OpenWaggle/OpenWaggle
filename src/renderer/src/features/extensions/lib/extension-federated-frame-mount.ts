import { matchBy } from '@diegogbrisa/ts-match'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { safeDecodeUnknown } from '@shared/schema'
import { jsonValueSchema } from '@shared/schemas/validation'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import type { JsonValue } from '@shared/types/json'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import extensionFrameBootstrapUrl from './extension-frame-bootstrap?worker&url'
import {
  decodeExtensionFrameMessage,
  extensionFrameConfig,
  postFrameMessage,
} from './extension-frame-host'
import { handleFrameInvoke } from './extension-frame-invocation'

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
  readonly onSurfaceAction?: (actionId: string, payload?: JsonValue) => void
  readonly reportHeight?: (height: number) => void
  readonly reportStatus: (status: ReportedMountStatus) => void
  readonly surfacePayloadJson?: string
}

export function missingEntryPathStatus(): MountStatus {
  return {
    kind: 'error',
    message: 'Extension contribution is missing its runtime module entry path.',
  }
}

export function supportsExtensionExecutionPlacement(entry: ExtensionContributionRegistryEntry) {
  return (
    entry.execution === OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER ||
    entry.execution === OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.FRAME
  )
}

export function supportsExtensionFrameRuntimeKind(entry: ExtensionContributionRegistryEntry) {
  return (
    entry.runtime === OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE ||
    entry.runtime === OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.TRUSTED_RENDERER
  )
}

export function supportsExtensionFrameRuntime(entry: ExtensionContributionRegistryEntry) {
  return supportsExtensionFrameRuntimeKind(entry) && supportsExtensionExecutionPlacement(entry)
}

export function federatedModuleMountKey(
  entry: ExtensionContributionRegistryEntry,
  moduleUrl: string | null,
  surfacePayloadJson: string | undefined,
) {
  return JSON.stringify([
    [entry.extensionId, entry.extensionName, entry.extensionVersion],
    [entry.contributionId, entry.title, entry.family],
    entry.runtime ?? '',
    entry.execution ?? '',
    entry.packagePath,
    entry.contentHash,
    entry.projectPaths,
    entry.networkOrigins ?? [],
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

function absoluteRendererUrl(url: string) {
  return new URL(url, window.location.href).toString()
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

function registerProtocolFrame(input: {
  readonly entry: ExtensionContributionRegistryEntry
  readonly frame: HTMLIFrameElement
  readonly frameId: string
  readonly isActive: () => boolean
  readonly reportMountStatus: (status: MountStatus) => void
}) {
  let registrationId: string | null = null
  void api
    .registerExtensionFrame({
      frameId: input.frameId,
      bootstrapUrl: absoluteRendererUrl(extensionFrameBootstrapUrl),
      networkOrigins: input.entry.networkOrigins,
    })
    .then((result) => {
      if (!input.isActive()) {
        void api.unregisterExtensionFrame({
          frameId: input.frameId,
          registrationId: result.registrationId,
        })
        return
      }

      registrationId = result.registrationId
      input.frame.src = result.frameUrl
    })
    .catch((error: unknown) => {
      if (!input.isActive()) {
        return
      }

      input.reportMountStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    })

  return () => {
    if (registrationId !== null) {
      void api.unregisterExtensionFrame({
        frameId: input.frameId,
        registrationId,
      })
    }
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
  let configured = false
  let reportedHeight: number | null = null
  const frame = input.frame
  const resolvedModuleUrl = input.moduleUrl
  if (!frame || resolvedModuleUrl === null) {
    return () => {
      active = false
    }
  }
  const mountModuleUrl = resolvedModuleUrl
  const frameConfig = extensionFrameConfig({
    entry: input.entry,
    moduleUrl: mountModuleUrl,
    surfacePayload: surfacePayloadFromJson(input.surfacePayloadJson),
  })

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
    if (!Number.isFinite(height) || height <= 0) {
      return
    }

    const nextHeight = Math.ceil(height)
    if (reportedHeight === nextHeight) {
      return
    }

    reportedHeight = nextHeight
    input.reportHeight?.(nextHeight)
  }

  function configureFrame(frameWindow: Window) {
    if (configured) {
      return
    }

    configured = true
    postFrameMessage(frameWindow, input.frameId, {
      type: 'configure',
      config: frameConfig,
    })
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

    matchBy(frameMessage, 'type')
      .with('ready', () => {
        configureFrame(currentFrameWindow)
      })
      .with('mounted', () => {
        reportMountStatus({ kind: 'mounted' })
      })
      .with('error', 'cleanup-error', (message) => {
        reportMountStatus({ kind: 'error', message: message.message })
      })
      .with('open-external', (message) => {
        void openFrameExternalUrl(message.url)
      })
      .with('resize', (message) => {
        reportFrameHeight(message.height)
      })
      .with('surface-action', (message) => {
        input.onSurfaceAction?.(message.actionId, message.payload)
      })
      .with('invoke', (message) => {
        void handleFrameInvoke({
          entry: input.entry,
          frameId: input.frameId,
          frameWindow: currentFrameWindow,
          message,
          shouldPostResult: () => active,
        })
      })
      .exhaustive()
  }

  window.addEventListener('message', handleFrameMessage)
  const unregisterProtocolFrame = registerProtocolFrame({
    entry: input.entry,
    frame,
    frameId: input.frameId,
    isActive: () => active,
    reportMountStatus,
  })

  return () => {
    active = false
    const currentFrameWindow = frame.contentWindow
    if (currentFrameWindow) {
      postFrameMessage(currentFrameWindow, input.frameId, { type: 'dispose' })
    }
    frame.removeAttribute('src')
    unregisterProtocolFrame()
    window.removeEventListener('message', handleFrameMessage)
  }
}
