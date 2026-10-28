import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ChatIndexRouteView } from '../-chat-index-route-view'
import { ChatSessionRouteView } from '../-chat-route-views'

interface SurfaceProbeProps {
  readonly workspace: { readonly sessionId: string | null }
}

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ sessionId: 'session-1' }),
  useSearch: () => ({}),
  useRouterState: ({ select }: { select: (state: { status: 'idle' }) => unknown }) =>
    select({ status: 'idle' }),
}))

vi.mock('../-chat-route-surface', () => ({
  ChatRouteSurface: ({ workspace }: SurfaceProbeProps) => (
    <div>chat surface {workspace.sessionId ?? 'new'}</div>
  ),
}))

/*
 * Both chat routes are their own lazy chunks already. A second, nested `lazy()` around the chat
 * surface fetched its chunks only after the shell rendered and committed a "Loading chat…"
 * fallback that React then held for its 300 ms fallback throttle (renderer-load B1). The
 * surface must render in the route component's first commit.
 */
describe('chat route views', () => {
  it('renders the New session chat surface in the first commit, with no Suspense fallback', () => {
    render(<ChatIndexRouteView />)

    expect(screen.getByText('chat surface new')).toBeInTheDocument()
    expect(screen.queryByText('Loading chat…')).not.toBeInTheDocument()
  })

  it('renders a Session chat surface in the first commit, with no Suspense fallback', () => {
    render(<ChatSessionRouteView />)

    expect(screen.getByText('chat surface session-1')).toBeInTheDocument()
    expect(screen.queryByText('Loading chat…')).not.toBeInTheDocument()
  })
})
