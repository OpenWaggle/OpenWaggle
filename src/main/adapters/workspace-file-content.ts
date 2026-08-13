import type { WorkspaceFilePreviewKind } from '@shared/types/workspace-files'

const BYTE_ZERO = 0
const BINARY_SAMPLE_BYTES = 8 * 1024

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
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
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

export function workspaceFileRevision(modifiedAt: number, size: number) {
  return `${String(modifiedAt)}:${String(size)}`
}
