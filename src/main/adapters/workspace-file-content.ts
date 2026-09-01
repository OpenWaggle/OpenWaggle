import { createHash } from 'node:crypto'
import type {
  WorkspaceFilePreviewKind,
  WorkspaceLineEnding,
  WorkspaceTextEncoding,
} from '@shared/types/workspace-files'

const BYTE_ZERO = 0
const BINARY_SAMPLE_BYTES = 8 * 1024
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])
const UTF16_LE_BOM = Buffer.from([0xff, 0xfe])
const UTF16_BE_BOM = Buffer.from([0xfe, 0xff])
const UTF16_CODE_UNIT_BYTES = 2
const INDENT_SAMPLE_LINES = 1_000
const DEFAULT_TAB_INDENT_SIZE = 4
const DEFAULT_SPACE_INDENT_SIZE = 2
const MIN_INDENT_SIZE = 1
const MAX_INDENT_SIZE = 8

export interface WorkspaceTextEncodingMarker {
  readonly encoding: WorkspaceTextEncoding
  readonly byteLength: number
}

export const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.md': 'text/markdown',
  '.mdx': 'text/markdown',
  '.json': 'application/json',
  '.jsonc': 'application/json',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.toml': 'text/plain',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.css': 'text/css',
  '.py': 'text/x-python',
  '.rs': 'text/x-rust',
  '.go': 'text/x-go',
  '.sh': 'text/x-shellscript',
}

export const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.json': 'json',
  '.jsonc': 'jsonc',
  '.css': 'css',
  '.html': 'html',
  '.htm': 'html',
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.sh': 'bash',
  '.zsh': 'bash',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.sql': 'sql',
}

export function hasBinaryBytes(buffer: Uint8Array) {
  const sampleLength = Math.min(buffer.length, BINARY_SAMPLE_BYTES)
  for (let index = 0; index < sampleLength; index += 1) {
    if (buffer[index] === BYTE_ZERO) return true
  }
  return false
}

function decodeOrNull(buffer: Uint8Array, encoding: 'utf-8' | 'utf-16le' | 'utf-16be') {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(buffer)
  } catch {
    return null
  }
}

export function detectWorkspaceTextEncodingMarker(buffer: Uint8Array): WorkspaceTextEncodingMarker {
  if (Buffer.from(buffer.subarray(0, UTF8_BOM.length)).equals(UTF8_BOM)) {
    return { encoding: 'utf-8-bom', byteLength: UTF8_BOM.length }
  }
  if (Buffer.from(buffer.subarray(0, UTF16_LE_BOM.length)).equals(UTF16_LE_BOM)) {
    return { encoding: 'utf-16le', byteLength: UTF16_LE_BOM.length }
  }
  if (Buffer.from(buffer.subarray(0, UTF16_BE_BOM.length)).equals(UTF16_BE_BOM)) {
    return { encoding: 'utf-16be', byteLength: UTF16_BE_BOM.length }
  }
  return { encoding: 'utf-8', byteLength: 0 }
}

export function decodeWorkspaceText(buffer: Uint8Array): {
  readonly content: string
  readonly encoding: WorkspaceTextEncoding
} | null {
  const marker = detectWorkspaceTextEncodingMarker(buffer)
  const decoderEncoding = marker.encoding === 'utf-8-bom' ? 'utf-8' : marker.encoding
  const content = decodeOrNull(buffer.subarray(marker.byteLength), decoderEncoding)
  return content === null ? null : { content, encoding: marker.encoding }
}

export function decodeWorkspaceTextAs(
  buffer: Uint8Array,
  encoding: WorkspaceTextEncoding,
): string | null {
  const marker = detectWorkspaceTextEncodingMarker(buffer)
  const matchingMarker =
    marker.encoding === encoding ||
    (encoding === 'utf-8' && marker.encoding === 'utf-8-bom') ||
    (encoding === 'utf-8-bom' && marker.encoding === 'utf-8-bom')
  const source = matchingMarker ? buffer.subarray(marker.byteLength) : buffer
  return decodeOrNull(source, encoding === 'utf-8-bom' ? 'utf-8' : encoding)
}

function swapUtf16Bytes(buffer: Buffer) {
  for (let index = 0; index + 1 < buffer.length; index += UTF16_CODE_UNIT_BYTES) {
    const first = buffer[index]
    const second = buffer[index + 1]
    if (first === undefined || second === undefined) continue
    buffer[index] = second
    buffer[index + 1] = first
  }
  return buffer
}

export function encodeWorkspaceText(content: string, encoding: WorkspaceTextEncoding) {
  if (encoding === 'utf-8') return Buffer.from(content, 'utf8')
  if (encoding === 'utf-8-bom') return Buffer.concat([UTF8_BOM, Buffer.from(content, 'utf8')])
  if (encoding === 'utf-16le') {
    return Buffer.concat([UTF16_LE_BOM, Buffer.from(content, 'utf16le')])
  }
  return Buffer.concat([UTF16_BE_BOM, swapUtf16Bytes(Buffer.from(content, 'utf16le'))])
}

export function detectWorkspaceLineEnding(content: string): WorkspaceLineEnding {
  const crlfCount = content.match(/\r\n/g)?.length ?? 0
  const withoutCrlf = content.replaceAll('\r\n', '')
  const lfCount = withoutCrlf.match(/\n/g)?.length ?? 0
  const crCount = withoutCrlf.match(/\r/g)?.length ?? 0
  const kinds = Number(crlfCount > 0) + Number(lfCount > 0 || crCount > 0)
  if (kinds === 0) return 'none'
  if (kinds > 1 || crCount > 0) return 'mixed'
  return crlfCount > 0 ? 'crlf' : 'lf'
}

export function inferIndentation(content: string) {
  const lines = content.split(/\r?\n/u, INDENT_SAMPLE_LINES)
  let tabLines = 0
  const spaceWidths: number[] = []
  for (const line of lines) {
    if (line.startsWith('\t')) tabLines += 1
    const spaces = /^ +/.exec(line)?.[0].length ?? 0
    if (spaces > 0) spaceWidths.push(spaces)
  }
  if (tabLines > spaceWidths.length) {
    return { indentStyle: 'tab' as const, indentSize: DEFAULT_TAB_INDENT_SIZE }
  }
  const smallest = spaceWidths.length > 0 ? Math.min(...spaceWidths) : DEFAULT_SPACE_INDENT_SIZE
  return {
    indentStyle: 'space' as const,
    indentSize: Math.max(MIN_INDENT_SIZE, Math.min(MAX_INDENT_SIZE, smallest)),
  }
}

export function workspaceFilePreviewKind(
  extension: string,
  buffer: Uint8Array,
): Exclude<WorkspaceFilePreviewKind, 'oversized'> {
  if (MIME_BY_EXTENSION[extension]?.startsWith('image/')) return 'image'
  if (extension === '.pdf') return 'pdf'
  if (extension === '.md' || extension === '.mdx') return 'markdown'
  if (extension === '.html' || extension === '.htm') return 'html'
  return hasBinaryBytes(buffer) ? 'binary' : 'text'
}

export function workspaceFileRevision(
  modifiedAt: number,
  size: number,
  observedContent?: Uint8Array,
) {
  const digest = observedContent
    ? createHash('sha256').update(observedContent).digest('hex')
    : 'unobserved'
  return `${String(modifiedAt)}:${String(size)}:${digest}`
}
