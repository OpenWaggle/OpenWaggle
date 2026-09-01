import fs from 'node:fs/promises'
import path from 'node:path'
import { WORKSPACE_EDITOR_PERFORMANCE } from '@shared/constants/workspace-editor-performance'
import type { WorkspaceFileReadResult, WorkspaceTextEncoding } from '@shared/types/workspace-files'
import { parse as parseEditorConfig } from 'editorconfig'
import {
  editorModelContent,
  resolveEditorConfigIndentStyle,
  resolveEditorConfigPolicy,
  storeWorkspaceDocumentSession,
  workspaceDocumentSession,
} from './workspace-document-sessions'
import {
  decodeWorkspaceText,
  decodeWorkspaceTextAs,
  detectWorkspaceLineEnding,
  detectWorkspaceTextEncodingMarker,
  hasBinaryBytes,
  inferIndentation,
  LANGUAGE_BY_EXTENSION,
  MIME_BY_EXTENSION,
  workspaceFilePreviewKind,
  workspaceFileRevision,
} from './workspace-file-content'
import { resolveExistingWorkspaceFile } from './workspace-file-paths'
import { rememberWorkspaceFile } from './workspace-file-search'
import { shebangLanguage, vscodeLanguageAssociation } from './workspace-language-detection'

const FILE_KIND_SAMPLE_BYTES = 8 * 1024

interface WorkspaceFileReadBase {
  readonly path: string
  readonly basename: string
  readonly size: number
  readonly modifiedAt: number
  readonly revision: string
  readonly mimeType: string
}

function supportedText(data: Uint8Array, forcedEncoding?: WorkspaceTextEncoding) {
  if (!forcedEncoding) return decodeWorkspaceText(data)
  const content = decodeWorkspaceTextAs(data, forcedEncoding)
  return content === null ? null : { content, encoding: forcedEncoding }
}

async function textReadResult(input: {
  readonly base: WorkspaceFileReadBase
  readonly data: Uint8Array
  readonly extension: string
  readonly projectRoot: string
  readonly realFilePath: string
  readonly relativePath: string
  readonly previewKind: 'text' | 'markdown' | 'html' | 'binary'
  readonly forcedEncoding?: WorkspaceTextEncoding
}): Promise<WorkspaceFileReadResult> {
  const decoded = supportedText(input.data, input.forcedEncoding)
  if (!decoded) {
    return {
      ...input.base,
      previewKind: 'binary',
      reason:
        input.previewKind === 'binary'
          ? 'Binary files cannot be edited as text.'
          : 'This file is not valid UTF-8 or supported BOM-marked UTF-16 text.',
    }
  }
  const lineEnding = detectWorkspaceLineEnding(decoded.content)
  const content = editorModelContent(decoded.content, lineEnding)
  const editorConfig = await parseEditorConfig(input.realFilePath, { root: input.projectRoot })
  const inferredIndentation = inferIndentation(content)
  const editorConfigPolicy = resolveEditorConfigPolicy(editorConfig)
  const indentStyle = resolveEditorConfigIndentStyle(
    editorConfig.indent_style,
    inferredIndentation.indentStyle,
  )
  const indentSize =
    typeof editorConfig.indent_size === 'number'
      ? editorConfig.indent_size
      : typeof editorConfig.tab_width === 'number'
        ? editorConfig.tab_width
        : inferredIndentation.indentSize
  const existingSession = workspaceDocumentSession(input.projectRoot, input.relativePath)
  const canReuseVersion =
    existingSession?.revision === input.base.revision &&
    existingSession.content === content &&
    existingSession.encoding === decoded.encoding &&
    existingSession.lineEnding === lineEnding
  const documentVersion = canReuseVersion ? existingSession.version : 0
  const language =
    (await vscodeLanguageAssociation(input.projectRoot, input.relativePath)) ??
    LANGUAGE_BY_EXTENSION[input.extension] ??
    shebangLanguage(content)
  storeWorkspaceDocumentSession({
    projectRoot: input.projectRoot,
    relativePath: input.relativePath,
    content,
    encoding: decoded.encoding,
    lineEnding,
    revision: input.base.revision,
    version: documentVersion,
    editorConfigPolicy,
  })
  return {
    ...input.base,
    previewKind: input.previewKind === 'binary' ? 'text' : input.previewKind,
    content,
    documentVersion,
    fidelity: {
      encoding: decoded.encoding,
      lineEnding,
      finalNewline: /(?:\r\n|\r|\n)$/u.test(decoded.content),
      indentStyle,
      indentSize,
      editorConfigApplied: Object.keys(editorConfig).length > 0,
      editorConfigPolicy,
    },
    ...(language ? { language } : {}),
  }
}

async function oversizedReadResult(input: {
  readonly base: WorkspaceFileReadBase
  readonly extension: string
  readonly projectRoot: string
  readonly realFilePath: string
  readonly relativePath: string
}): Promise<WorkspaceFileReadResult> {
  const handle = await fs.open(input.realFilePath, 'r')
  const sample = Buffer.alloc(Math.min(FILE_KIND_SAMPLE_BYTES, input.base.size))
  try {
    await handle.read(sample, 0, sample.length, 0)
  } finally {
    await handle.close()
  }
  const marker = detectWorkspaceTextEncodingMarker(sample)
  const sampledKind = workspaceFilePreviewKind(input.extension, sample)
  if (
    sampledKind === 'image' ||
    sampledKind === 'pdf' ||
    (hasBinaryBytes(sample) && marker.encoding === 'utf-8')
  ) {
    return {
      ...input.base,
      previewKind: 'binary',
      reason: 'This binary file is too large to preview safely in memory.',
    }
  }
  const language =
    (await vscodeLanguageAssociation(input.projectRoot, input.relativePath)) ??
    LANGUAGE_BY_EXTENSION[input.extension]
  return {
    ...input.base,
    previewKind: 'oversized',
    reason: 'This text file is larger than 1 MiB. Browse it in paged source view.',
    ...(language ? { language } : {}),
  }
}

export async function readWorkspaceFile(
  input: { readonly projectPath: string; readonly path: string },
  forcedEncoding?: WorkspaceTextEncoding,
): Promise<WorkspaceFileReadResult> {
  const resolved = await resolveExistingWorkspaceFile(input)
  rememberWorkspaceFile(resolved.projectRoot, resolved.relativePath)
  const extension = path.extname(resolved.relativePath).toLowerCase()
  const base: WorkspaceFileReadBase = {
    path: resolved.relativePath,
    basename: path.posix.basename(resolved.relativePath),
    size: resolved.stats.size,
    modifiedAt: resolved.stats.mtimeMs,
    revision: workspaceFileRevision(resolved.stats.mtimeMs, resolved.stats.size),
    mimeType: MIME_BY_EXTENSION[extension] ?? 'application/octet-stream',
  }
  const supportsRichBinaryPreview =
    base.mimeType.startsWith('image/') || base.mimeType === 'application/pdf'
  if (
    resolved.stats.size > WORKSPACE_EDITOR_PERFORMANCE.BINARY_PREVIEW_MAX_BYTES ||
    (resolved.stats.size > WORKSPACE_EDITOR_PERFORMANCE.FOCUSED_EDIT_MAX_BYTES &&
      !supportsRichBinaryPreview)
  ) {
    return oversizedReadResult({
      base,
      extension,
      projectRoot: resolved.projectRoot,
      realFilePath: resolved.realFilePath,
      relativePath: resolved.relativePath,
    })
  }
  const data = await fs.readFile(resolved.realFilePath)
  const observedBase = {
    ...base,
    revision: workspaceFileRevision(resolved.stats.mtimeMs, resolved.stats.size, data),
  }
  const kind = workspaceFilePreviewKind(extension, data)
  if (kind === 'image' || kind === 'pdf') {
    return { ...observedBase, previewKind: kind, data: new Uint8Array(data) }
  }
  return textReadResult({
    base: observedBase,
    data,
    extension,
    projectRoot: resolved.projectRoot,
    realFilePath: resolved.realFilePath,
    relativePath: resolved.relativePath,
    previewKind: kind,
    ...(forcedEncoding ? { forcedEncoding } : {}),
  })
}
