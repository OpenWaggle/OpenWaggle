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

export function parsePiWaggleCommandArgs(args: string) {
  const first = splitFirstToken(args)
  // One declaration of the whole union, so declarations name `PiWaggleCommandIntent`.
  const intent: PiWaggleCommandIntent = !first
    ? { type: 'menu' }
    : first.token === 'off'
      ? { type: 'disable' }
      : first.token === 'new'
        ? { type: 'create-preset' }
        : first.token === 'edit'
          ? first.rest
            ? { type: 'edit-preset', presetId: first.rest }
            : { type: 'edit-preset' }
          : first.token === 'config'
            ? { type: 'edit-config' }
            : first.token === 'turns' || first.token === 'max-turns'
              ? first.rest
                ? { type: 'edit-turns', maxTurns: first.rest }
                : { type: 'edit-turns' }
              : {
                  type: 'activate-preset',
                  presetId: first.token,
                  ...(first.rest ? { prompt: first.rest } : {}),
                }
  return intent
}
