import { useQueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { rendererQueryClient } from '@/queries/query-client'
import { router } from '@/router'

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
})
