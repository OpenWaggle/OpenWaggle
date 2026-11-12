import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { RenderHookResult, RenderResult } from '@testing-library/react'
import { render, renderHook } from '@testing-library/react'
import type { PropsWithChildren, ReactElement } from 'react'
import { createRendererQueryClient } from '@/queries/query-client'

interface QueryWrapperProps extends PropsWithChildren {
  readonly client?: QueryClient
}

function QueryWrapper({ children, client }: QueryWrapperProps) {
  const queryClient = client ?? createRendererQueryClient()
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

/** Interfaces, so declarations name them instead of spelling out Testing Library's queries. */
export interface QueryClientRenderResult extends RenderResult {
  readonly client: QueryClient
}

export interface QueryClientRenderHookResult<Result, Props> extends RenderHookResult<
  Result,
  Props
> {
  readonly client: QueryClient
}

export function renderWithQueryClient(
  ui: ReactElement,
  client: QueryClient = createRendererQueryClient(),
) {
  const result: QueryClientRenderResult = {
    client,
    ...render(<QueryWrapper client={client}>{ui}</QueryWrapper>),
  }
  return result
}

export function renderHookWithQueryClient<Result, Props>(
  renderCallback: (initialProps: Props) => Result,
  options?: {
    readonly client?: QueryClient
    readonly initialProps?: Props
  },
) {
  const client = options?.client ?? createRendererQueryClient()

  const result: QueryClientRenderHookResult<Result, Props> = {
    client,
    ...renderHook(renderCallback, {
      initialProps: options?.initialProps,
      wrapper: ({ children }: PropsWithChildren) => (
        <QueryWrapper client={client}>{children}</QueryWrapper>
      ),
    }),
  }
  return result
}
