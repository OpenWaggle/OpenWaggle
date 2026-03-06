import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { RenderHookResult, RenderResult } from '@testing-library/react'
import { render, renderHook } from '@testing-library/react'
import type { PropsWithChildren, ReactElement } from 'react'
import { createRendererQueryClient } from '@/queries/query-client'

interface QueryWrapperProps extends PropsWithChildren {
  readonly client?: QueryClient
}

function QueryWrapper({ children, client }: QueryWrapperProps): React.JSX.Element {
  const queryClient = client ?? createRendererQueryClient()
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

export function renderWithQueryClient(
  ui: ReactElement,
  client: QueryClient = createRendererQueryClient(),
): RenderResult & { readonly client: QueryClient } {
  return {
    client,
    ...render(<QueryWrapper client={client}>{ui}</QueryWrapper>),
  }
}

export function renderHookWithQueryClient<Result, Props>(
  renderCallback: (initialProps: Props) => Result,
  options?: {
    readonly client?: QueryClient
    readonly initialProps?: Props
  },
): RenderHookResult<Result, Props> & { readonly client: QueryClient } {
  const client = options?.client ?? createRendererQueryClient()

  return {
    client,
    ...renderHook(renderCallback, {
      initialProps: options?.initialProps,
      wrapper: ({ children }: PropsWithChildren) => (
        <QueryWrapper client={client}>{children}</QueryWrapper>
      ),
    }),
  }
}
