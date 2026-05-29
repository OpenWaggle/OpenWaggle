export type PiWaggleCommandIntent =
  | { readonly type: 'menu' }
  | { readonly type: 'activate-preset'; readonly presetId: string; readonly prompt?: string }
  | { readonly type: 'create-preset' }
  | { readonly type: 'edit-preset'; readonly presetId?: string }
  | { readonly type: 'edit-config' }
  | { readonly type: 'edit-turns'; readonly maxTurns?: string }
  | { readonly type: 'disable' }

function splitFirstToken(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const firstWhitespace = trimmed.search(/\s/)
  if (firstWhitespace < 0) {
    return { token: trimmed, rest: '' }
  }

  return {
    token: trimmed.slice(0, firstWhitespace),
    rest: trimmed.slice(firstWhitespace).trim(),
  }
}

export function parsePiWaggleCommandArgs(args: string): PiWaggleCommandIntent {
  const first = splitFirstToken(args)
  if (!first) {
    return { type: 'menu' }
  }

  if (first.token === 'off') {
    return { type: 'disable' }
  }

  if (first.token === 'new') {
    return { type: 'create-preset' }
  }

  if (first.token === 'edit') {
    return first.rest ? { type: 'edit-preset', presetId: first.rest } : { type: 'edit-preset' }
  }

  if (first.token === 'config') {
    return { type: 'edit-config' }
  }

  if (first.token === 'turns' || first.token === 'max-turns') {
    return first.rest ? { type: 'edit-turns', maxTurns: first.rest } : { type: 'edit-turns' }
  }

  return {
    type: 'activate-preset',
    presetId: first.token,
    ...(first.rest ? { prompt: first.rest } : {}),
  }
}
