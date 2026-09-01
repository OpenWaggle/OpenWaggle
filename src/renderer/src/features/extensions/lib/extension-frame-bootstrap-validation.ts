import { EXTENSION_FRAME_MESSAGE_CHANNEL } from '@shared/constants/extension-frame'
import type { OpenWaggleExtensionSyntaxHighlightResult } from '@shared/extension-sdk'
import { isOpenWaggleExtensionTheme } from '@shared/extension-theme'
import type { ExtensionInvokeResult } from '@shared/types/extension-broker'
import type { ExtensionFrameConfig } from '@shared/types/extension-frame'
import { isRecord } from '@shared/utils/validation'
import type { OpenWaggleFederatedModule } from './extension-federated-module'
import { isOptionalJsonValue, stringArray } from './extension-frame-bootstrap-json'
import { isInvokeResult } from './extension-frame-bootstrap-results'

export type ExtensionFrameParentMessage =
  | { readonly type: 'configure'; readonly config: ExtensionFrameConfig }
  | { readonly type: 'dispose' }
  | {
      readonly type: 'invoke-result'
      readonly requestId: string
      readonly result: ExtensionInvokeResult
    }
  | {
      readonly type: 'syntax-highlight-result'
      readonly requestId: string
      readonly result: OpenWaggleExtensionSyntaxHighlightResult
    }

function moduleMountExport(value: object): unknown {
  return Object.getOwnPropertyDescriptor(value, 'mount')?.value
}

export function isFederatedModule(value: unknown): value is OpenWaggleFederatedModule {
  return (
    typeof value === 'object' && value !== null && typeof moduleMountExport(value) === 'function'
  )
}

function isExtensionMetadata(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.version === 'string'
  )
}

function isContributionMetadata(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.family === 'string'
  )
}

function isSurfaceMetadata(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.family === 'string' &&
    typeof value.execution === 'string' &&
    isOptionalJsonValue(value.payload)
  )
}

function isFrameContext(value: unknown) {
  return (
    isRecord(value) &&
    isExtensionMetadata(value.extension) &&
    isContributionMetadata(value.contribution) &&
    isSurfaceMetadata(value.surface) &&
    typeof value.packagePath === 'string' &&
    stringArray(value.projectPaths) &&
    isOpenWaggleExtensionTheme(value.theme)
  )
}

function isExtensionFrameConfig(value: unknown): value is ExtensionFrameConfig {
  return isRecord(value) && typeof value.moduleUrl === 'string' && isFrameContext(value.context)
}

function isOptionalString(value: unknown) {
  return value === undefined || typeof value === 'string'
}

function isSyntaxToken(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.content === 'string' &&
    isOptionalString(value.color) &&
    isOptionalString(value.backgroundColor) &&
    (value.fontStyle === undefined || typeof value.fontStyle === 'number')
  )
}

function isSyntaxHighlightResult(
  value: unknown,
): value is OpenWaggleExtensionSyntaxHighlightResult {
  return (
    isRecord(value) &&
    (value.status === 'highlighted' || value.status === 'plain-text') &&
    typeof value.language === 'string' &&
    isOptionalString(value.foreground) &&
    isOptionalString(value.background) &&
    isOptionalString(value.diagnostic) &&
    Array.isArray(value.lines) &&
    value.lines.every((line) => Array.isArray(line) && line.every(isSyntaxToken))
  )
}

export function decodedParentMessage(
  value: unknown,
  frameId: string,
): ExtensionFrameParentMessage | null {
  if (
    !isRecord(value) ||
    value.channel !== EXTENSION_FRAME_MESSAGE_CHANNEL ||
    value.frameId !== frameId
  ) {
    return null
  }

  if (value.type === 'dispose') {
    return { type: 'dispose' }
  }

  if (value.type === 'configure' && isExtensionFrameConfig(value.config)) {
    return { type: 'configure', config: value.config }
  }

  if (
    value.type === 'invoke-result' &&
    typeof value.requestId === 'string' &&
    isInvokeResult(value.result)
  ) {
    return { type: 'invoke-result', requestId: value.requestId, result: value.result }
  }

  if (
    value.type === 'syntax-highlight-result' &&
    typeof value.requestId === 'string' &&
    isSyntaxHighlightResult(value.result)
  ) {
    return { type: 'syntax-highlight-result', requestId: value.requestId, result: value.result }
  }

  return null
}
