import type { McpAppFrameRegisterResult } from '@shared/types/mcp-app-frame'
import { useEffect, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import type { ParsedMcpAppResource } from './mcp-app-resource'

interface RegistrationState {
  readonly resource: ParsedMcpAppResource
  readonly registration: McpAppFrameRegisterResult | null
  readonly error: string | null
}

/**
 * The URL the Host serves `resource`'s App document at, with a policy of its own (ADR 0053),
 * registered while the frame is shown. A new resource is a new frame and a new registration.
 */
export function useMcpAppFrameRegistration(resource: ParsedMcpAppResource | null) {
  const [state, setState] = useState<RegistrationState | null>(null)

  useEffect(() => {
    if (!resource) return
    let active = true
    let registered: McpAppFrameRegisterResult | null = null
    const frameId = globalThis.crypto.randomUUID()
    void api
      .registerMcpAppFrame({ frameId, html: resource.html, csp: resource.csp })
      .then((result) => {
        registered = result
        if (active) setState({ resource, registration: result, error: null })
        else {
          void api
            .unregisterMcpAppFrame({ frameId, registrationId: result.registrationId })
            .catch(() => undefined)
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            resource,
            registration: null,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })
    return () => {
      active = false
      if (registered) {
        void api
          .unregisterMcpAppFrame({ frameId, registrationId: registered.registrationId })
          .catch(() => undefined)
      }
    }
  }, [resource])

  return state?.resource === resource
    ? { frameUrl: state.registration?.frameUrl ?? null, error: state.error }
    : { frameUrl: null, error: null }
}
