const UNSAFE_FETCH_TRANSPORT_PROPERTIES = [
  ['agent', 'Custom fetch agents can bypass the declared origin.'],
  ['dispatcher', 'Custom fetch dispatchers can bypass the declared origin.'],
  ['proxy', 'Fetch proxies can bypass the declared origin.'],
  ['unix', 'Unix socket paths can bypass the declared origin.'],
] as const
const UNSAFE_FETCH_REQUEST_REASON =
  'Request objects can preserve custom fetch agents or dispatchers that bypass the declared origin.'

export function parseUrl(value: string) {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function requestInputUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') {
    return parseUrl(input)
  }
  if (input instanceof URL) {
    return input
  }
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return parseUrl(input.url)
  }
  return null
}

function requestInputUnsafeTransportReason(input: RequestInfo | URL) {
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return UNSAFE_FETCH_REQUEST_REASON
  }

  return null
}

function objectHasOwn(value: object, property: string) {
  return Object.hasOwn(value, property)
}

function unsafeFetchTransportReason(init?: RequestInit) {
  if (typeof init !== 'object' || init === null) {
    return null
  }

  for (const [property, reason] of UNSAFE_FETCH_TRANSPORT_PROPERTIES) {
    if (objectHasOwn(init, property)) {
      return reason
    }
  }

  return null
}

export function fetchInitWithRedirectError(init?: RequestInit): RequestInit {
  return {
    ...init,
    redirect: 'error',
  }
}

/** The URL a fetch call targets and, when it carries one, a transport that can bypass it. */
export function fetchRequestTarget(input: RequestInfo | URL, init?: RequestInit) {
  return {
    url: requestInputUrl(input),
    unsafeTransportReason:
      requestInputUnsafeTransportReason(input) ?? unsafeFetchTransportReason(init),
  }
}
