export type SessionCopyCommand = { readonly type: 'fork' } | { readonly type: 'clone' }

export function parseSessionCopyCommand(input: string): SessionCopyCommand | null {
  const trimmed = input.trim()
  if (trimmed === '/fork') {
    return { type: 'fork' }
  }
  if (trimmed === '/clone') {
    return { type: 'clone' }
  }
  return null
}
