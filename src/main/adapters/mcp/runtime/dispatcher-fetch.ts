import { type Dispatcher1Wrapper, fetch as undiciFetch } from 'undici'

/**
 * A request sent through `dispatcher` by undici's own `fetch`. The global `fetch` of Bun ignores
 * an undici `dispatcher`, which would bypass the pinned DNS lookup (MCP's rebinding guard), so
 * the request goes through the npm package and its answer is handed on as a global `Response`.
 * undici's request and response types are its own, so both cross here through runtime checks.
 */
export async function fetchThroughDispatcher(
  url: URL,
  init: RequestInit,
  dispatcher: Dispatcher1Wrapper,
): Promise<Response> {
  const answer: unknown = await Reflect.apply(undiciFetch, undefined, [
    url,
    { ...init, dispatcher },
  ])
  return globalResponse(answer)
}

function isIterable(value: unknown): value is Iterable<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, Symbol.iterator) === 'function'
  )
}

/** undici's `Headers` iterates `[name, value]` pairs, as the global one does. */
function headerEntries(headers: unknown): [string, string][] {
  if (!isIterable(headers)) return []
  const pairs: [string, string][] = []
  for (const pair of headers) {
    if (Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string') {
      pairs.push([pair[0], pair[1]])
    }
  }
  return pairs
}

function globalResponse(answer: unknown) {
  if (answer instanceof Response) return answer
  if (typeof answer !== 'object' || answer === null) {
    throw new TypeError('undici fetch returned no response.')
  }
  const body: unknown = Reflect.get(answer, 'body')
  const status: unknown = Reflect.get(answer, 'status')
  const statusText: unknown = Reflect.get(answer, 'statusText')
  if (!(body === null || body instanceof ReadableStream) || typeof status !== 'number') {
    throw new TypeError('undici fetch returned a response this runtime cannot read.')
  }
  return new Response(body, {
    status,
    statusText: typeof statusText === 'string' ? statusText : '',
    headers: headerEntries(Reflect.get(answer, 'headers')),
  })
}
