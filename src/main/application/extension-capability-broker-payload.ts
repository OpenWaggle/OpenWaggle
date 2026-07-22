export function emptyObjectPayload(payload: unknown) {
  return (
    payload === undefined ||
    (typeof payload === 'object' &&
      payload !== null &&
      !Array.isArray(payload) &&
      Object.keys(payload).length === 0)
  )
}

function unsupportedKeys(payload: unknown, keys: ReadonlySet<string>) {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return []
  }

  return Object.keys(payload).filter((key) => !keys.has(key))
}

export function unsupportedPayloadIssues(payload: unknown, keys: ReadonlySet<string>) {
  const invalidKeys = unsupportedKeys(payload, keys)
  return invalidKeys.length > 0 ? [`Unsupported payload keys: ${invalidKeys.join(', ')}.`] : []
}
