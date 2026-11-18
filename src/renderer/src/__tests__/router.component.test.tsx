import { useQueryClient } from '@tanstack/react-query'
import { render, renderHook, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { rendererQueryClient } from '@/queries/query-client'
import { router, startInitialRouteLoad, useInitialRouteLoadSettled } from '@/router'

function QueryClientProbe() {
  const queryClient = useQueryClient()
  return <span>{queryClient === rendererQueryClient ? 'integrated' : 'missing'}</span>
}

describe('router', () => {
  it('exposes the renderer query client through typed router context', () => {
    expect(router.options.context.queryClient).toBe(rendererQueryClient)
  })

  it('disables router preload caching when TanStack Query owns cached data', () => {
    expect(router.options.defaultPreloadStaleTime).toBe(0)
  })

  it('registers the controlled extension route namespace', () => {
    expect(router.routesById['/extensions/$extensionId/$']?.fullPath).toBe(
      '/extensions/$extensionId/$',
    )
  })

  it('wraps route rendering with the renderer query client provider', () => {
    const Wrap = router.options.Wrap
    if (!Wrap) throw new Error('Router Query integration did not install a Wrap component.')

    render(
      <Wrap>
        <QueryClientProbe />
      </Wrap>,
    )

    expect(screen.getByText('integrated')).toBeInTheDocument()
  })

  it('loads the launch location once, before RouterProvider mounts', async () => {
    const load = vi.spyOn(router, 'load')
    const initialLoad = startInitialRouteLoad()

    expect(startInitialRouteLoad()).toBe(initialLoad)
    await initialLoad

    expect(load).toHaveBeenCalledTimes(1)
    expect(router.state.matches.map((match) => match.routeId)).toContain('__root__')
    expect(router.state.matches.every((match) => match.status === 'success')).toBe(true)
    load.mockRestore()
  })

  it('reports the launch route load as settled for the boot gate', async () => {
    const { result } = renderHook(() => useInitialRouteLoadSettled())

    await waitFor(() => expect(result.current).toBe(true))
  })
})
