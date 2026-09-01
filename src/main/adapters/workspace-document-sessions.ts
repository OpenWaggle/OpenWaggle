import type {
  WorkspaceEditorConfigPolicy,
  WorkspaceLineEnding,
  WorkspaceTextEncoding,
} from '@shared/types/workspace-files'

export interface WorkspaceDocumentSession {
  readonly projectRoot: string
  readonly relativePath: string
  content: string
  encoding: WorkspaceTextEncoding
  lineEnding: WorkspaceLineEnding
  revision: string
  version: number
  readonly editorConfigPolicy: WorkspaceEditorConfigPolicy
}

const DOCUMENT_SESSION_MAX_ENTRIES = 16
const DOCUMENT_SESSION_MAX_CODE_UNITS = 4 * 1024 * 1024

interface StoredDocumentSession {
  readonly session: WorkspaceDocumentSession
  readonly codeUnits: number
}

const documentSessions = new Map<string, StoredDocumentSession>()
let documentSessionCodeUnits = 0

function documentSessionKey(projectRoot: string, relativePath: string) {
  return `${projectRoot}\u0000${relativePath}`
}

export function resolveEditorConfigIndentStyle(
  value: unknown,
  fallback: 'space' | 'tab',
): 'space' | 'tab' {
  if (value === 'tab') return 'tab'
  if (value === 'space') return 'space'
  return fallback
}

export function resolveEditorConfigPolicy(
  editorConfig: Readonly<Record<string, unknown>>,
): WorkspaceEditorConfigPolicy {
  const charset = editorConfig.charset
  const encoding =
    charset === 'utf-8' ||
    charset === 'utf-8-bom' ||
    charset === 'utf-16le' ||
    charset === 'utf-16be'
      ? charset
      : undefined
  const endOfLine = editorConfig.end_of_line
  const lineEnding = endOfLine === 'lf' || endOfLine === 'crlf' ? endOfLine : undefined
  return {
    ...(encoding ? { encoding } : {}),
    ...(lineEnding ? { lineEnding } : {}),
    ...(typeof editorConfig.insert_final_newline === 'boolean'
      ? { finalNewline: editorConfig.insert_final_newline }
      : {}),
    ...(typeof editorConfig.trim_trailing_whitespace === 'boolean'
      ? { trimTrailingWhitespace: editorConfig.trim_trailing_whitespace }
      : {}),
  }
}

export function editorModelContent(content: string, lineEnding: WorkspaceLineEnding) {
  return lineEnding === 'crlf' ? content.replaceAll('\r\n', '\n') : content
}

export function diskContent(content: string, lineEnding: WorkspaceLineEnding) {
  return lineEnding === 'crlf' ? content.replaceAll('\n', '\r\n') : content
}

export function storeWorkspaceDocumentSession(session: WorkspaceDocumentSession) {
  const key = documentSessionKey(session.projectRoot, session.relativePath)
  const existing = documentSessions.get(key)
  if (existing) {
    documentSessionCodeUnits -= existing.codeUnits
    documentSessions.delete(key)
  }
  const stored = { session, codeUnits: session.content.length }
  documentSessions.set(key, stored)
  documentSessionCodeUnits += stored.codeUnits
  while (
    documentSessions.size > DOCUMENT_SESSION_MAX_ENTRIES ||
    documentSessionCodeUnits > DOCUMENT_SESSION_MAX_CODE_UNITS
  ) {
    const oldest = documentSessions.entries().next()
    if (oldest.done) break
    documentSessions.delete(oldest.value[0])
    documentSessionCodeUnits -= oldest.value[1].codeUnits
  }
}

export function workspaceDocumentSession(projectRoot: string, relativePath: string) {
  const key = documentSessionKey(projectRoot, relativePath)
  const stored = documentSessions.get(key)
  if (!stored) return undefined
  documentSessions.delete(key)
  documentSessions.set(key, stored)
  return stored.session
}

export function retargetWorkspaceDocumentSessions(
  projectRoot: string,
  previousPath: string,
  nextPath: string,
) {
  const affected = [...documentSessions.entries()].filter(
    ([, stored]) =>
      stored.session.projectRoot === projectRoot &&
      (stored.session.relativePath === previousPath ||
        stored.session.relativePath.startsWith(`${previousPath}/`)),
  )
  for (const [key, stored] of affected) {
    documentSessions.delete(key)
    documentSessionCodeUnits -= stored.codeUnits
    const session = stored.session
    const relativePath = `${nextPath}${session.relativePath.slice(previousPath.length)}`
    storeWorkspaceDocumentSession({ ...session, relativePath })
  }
}

export function removeWorkspaceDocumentSessions(projectRoot: string, relativePath: string) {
  for (const [key, stored] of documentSessions) {
    const session = stored.session
    if (
      session.projectRoot === projectRoot &&
      (session.relativePath === relativePath || session.relativePath.startsWith(`${relativePath}/`))
    ) {
      documentSessions.delete(key)
      documentSessionCodeUnits -= stored.codeUnits
    }
  }
}
