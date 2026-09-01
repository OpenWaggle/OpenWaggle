import { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type RenderResult, render } from '@testing-library/react'
import { SessionResourceViewer } from '../SessionResourceViewer'

export function image(
  id: string,
  title: string,
  nodeId: string | null = null,
  updatedAt = 1000,
): SessionResource {
  return {
    id,
    sessionId: SessionId('session-1'),
    canonicalKey: `sha256:${id}`,
    kind: 'image',
    title,
    mimeType: 'image/png',
    locator: `session-resource://${id}`,
    managed: true,
    available: true,
    isSource: true,
    isOutput: false,
    occurrences: nodeId
      ? [
          {
            id: `occurrence-${id}`,
            nodeId,
            branchId: null,
            actor: 'agent',
            activity: 'created',
            label: null,
            createdAt: 1000,
          },
        ]
      : [],
    createdAt: 1000,
    updatedAt,
  }
}

export function remoteImage(id: string, title: string): SessionResource {
  return {
    ...image(id, title),
    canonicalKey: `url:https://images.example/${id}.png`,
    mimeType: null,
    locator: `https://images.example/${id}.png`,
  }
}

export function httpImage(id: string, title: string): SessionResource {
  return {
    ...image(id, title),
    canonicalKey: `url:http://images.example/${id}.png`,
    mimeType: null,
    locator: `http://images.example/${id}.png`,
  }
}

interface ViewerRenderResult extends RenderResult {
  readonly queryClient: QueryClient
  readonly rerenderSession: (sessionId: string | null) => void
}

export function renderViewer(
  activeSessionId: string | null,
  activeMessageIds: ReadonlySet<string> = new Set(),
): ViewerRenderResult {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SessionResourceViewer
        activeSessionId={activeSessionId}
        activeMessageIds={activeMessageIds}
      />
    </QueryClientProvider>,
  )
  return {
    ...view,
    queryClient,
    rerenderSession: (sessionId: string | null) =>
      view.rerender(
        <QueryClientProvider client={queryClient}>
          <SessionResourceViewer activeSessionId={sessionId} activeMessageIds={activeMessageIds} />
        </QueryClientProvider>,
      ),
  }
}
