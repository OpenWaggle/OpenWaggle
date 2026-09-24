import { realpath } from 'node:fs/promises'
import { basename } from 'node:path'
import type { QuotedBuiltinSyntax } from './preparation-quoted-builtin'

export async function quotedBuiltinSyntaxForShell(shell: string): Promise<QuotedBuiltinSyntax> {
  const name = basename(shell).toLowerCase()
  const resolvedName =
    name === 'sh' ? basename(await realpath(shell).catch(() => shell)).toLowerCase() : name
  if (resolvedName === 'dash') return { ansi: false, locale: false }
  if (resolvedName === 'zsh') return { ansi: true, locale: false }
  if (resolvedName === 'sh' && process.platform !== 'darwin') return { ansi: false, locale: false }
  return { ansi: true, locale: true }
}
