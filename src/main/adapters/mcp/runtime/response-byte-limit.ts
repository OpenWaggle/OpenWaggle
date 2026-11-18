function responseMediaType(response: Response) {
  return response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
}

function declaredContentLength(response: Response) {
  const raw = response.headers.get('content-length')?.trim()
  if (!raw || !/^\d+$/.test(raw)) return null
  return Number(raw)
}

function responseLimitError(maxBytes: number) {
  return new Error(`MCP HTTP response exceeded the ${String(maxBytes)} byte safety limit.`)
}

function boundedResponseStream(
  source: ReadableStream<Uint8Array>,
  maxBytes: number,
  eventStream: boolean,
) {
  const reader = source.getReader()
  let responseBytes = 0
  let eventBytes = 0
  let lineHasContent = false
  let previousWasCarriageReturn = false
  let carriageReturnEndedBlankLine = false

  function accountForLineBoundary(byte: number) {
    if (byte === CARRIAGE_RETURN) {
      carriageReturnEndedBlankLine = !lineHasContent
      if (carriageReturnEndedBlankLine) eventBytes = 0
      lineHasContent = false
      previousWasCarriageReturn = true
      return
    }
    if (byte === LINE_FEED) {
      if (previousWasCarriageReturn) {
        if (carriageReturnEndedBlankLine) eventBytes = 0
      } else {
        if (!lineHasContent) eventBytes = 0
        lineHasContent = false
      }
      previousWasCarriageReturn = false
      carriageReturnEndedBlankLine = false
      return
    }
    lineHasContent = true
    previousWasCarriageReturn = false
    carriageReturnEndedBlankLine = false
  }

  function accountForEventBytes(chunk: Uint8Array) {
    for (const byte of chunk) {
      eventBytes += 1
      accountForLineBoundary(byte)
      if (eventBytes > maxBytes) throw responseLimitError(maxBytes)
    }
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read()
        if (next.done) {
          controller.close()
          return
        }
        if (eventStream) accountForEventBytes(next.value)
        else {
          responseBytes += next.value.byteLength
          if (responseBytes > maxBytes) throw responseLimitError(maxBytes)
        }
        controller.enqueue(next.value)
      } catch (error) {
        void reader.cancel(error).catch(() => undefined)
        controller.error(error)
      }
    },
    cancel: (reason) => reader.cancel(reason),
  })
}

/** Bounds buffered HTTP bodies and each long-lived SSE event before SDK parsing. */
export function limitMcpResponseBytes(response: Response, maxBytes: number) {
  const eventStream = responseMediaType(response) === 'text/event-stream'
  const contentLength = declaredContentLength(response)
  if (!eventStream && contentLength !== null && contentLength > maxBytes) {
    void response.body?.cancel(responseLimitError(maxBytes)).catch(() => undefined)
    throw responseLimitError(maxBytes)
  }
  if (!response.body) return response

  const limited = new Response(boundedResponseStream(response.body, maxBytes, eventStream), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
  if (response.url) Object.defineProperty(limited, 'url', { value: response.url })
  return limited
}
const CARRIAGE_RETURN = 13
const LINE_FEED = 10
