import { QueryClient } from '@tanstack/react-query'

const DEFAULT_STALE_TIME_MS = 30_000

function buildQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: 'always',
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        staleTime: DEFAULT_STALE_TIME_MS,
      },
      mutations: {
        networkMode: 'always',
        retry: false,
      },
    },
  })
}

export const rendererQueryClient = buildQueryClient()

export function createRendererQueryClient(): QueryClient {
  return buildQueryClient()
}
