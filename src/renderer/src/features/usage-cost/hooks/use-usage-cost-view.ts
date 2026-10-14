import type {
  UsageCostModelRow,
  UsageCostProjectRow,
  UsageCostQuery,
  UsageCostSessionQuery,
} from '@shared/types/usage-cost'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import {
  usageCostQueryKeys,
  usageCostSessionsQueryOptions,
  usageCostViewQueryOptions,
} from '@/queries/usage-cost'

/** The drill-down selections derived from clicking a chart bar or a breakdown row. */
export interface UsageCostDrillDown {
  readonly day?: string
  readonly provider?: string
  readonly modelId?: string
  readonly cwd?: string | null
}

const DEFAULT_QUERY: UsageCostQuery = { preset: '30d', origin: 'all' }

export function useUsageCostView() {
  const [query, setQuery] = useState(DEFAULT_QUERY)
  const [drillDown, setDrillDown] = useState<UsageCostDrillDown>({})
  const queryClient = useQueryClient()

  const viewQuery = useQuery(usageCostViewQueryOptions(query))
  const sessionQuery: UsageCostSessionQuery = useMemo(
    () => ({ ...query, ...drillDown }),
    [query, drillDown],
  )
  const sessionsQuery = useQuery(usageCostSessionsQueryOptions(sessionQuery))

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: usageCostQueryKeys.view(query) })
    void queryClient.invalidateQueries({ queryKey: usageCostQueryKeys.sessions(sessionQuery) })
  }, [queryClient, query, sessionQuery])

  const setRange = useCallback((preset: UsageCostQuery['preset']) => {
    setQuery((current) => ({ ...current, preset }))
  }, [])

  const setOrigin = useCallback((origin: UsageCostQuery['origin']) => {
    setQuery((current) => ({ ...current, origin }))
  }, [])

  const toggleDay = useCallback((day: string) => {
    setDrillDown((current) => ({ ...current, day: current.day === day ? undefined : day }))
  }, [])

  const toggleModel = useCallback((model: Pick<UsageCostModelRow, 'provider' | 'modelId'>) => {
    setDrillDown((current) => {
      const active = current.provider === model.provider && current.modelId === model.modelId
      return {
        ...current,
        provider: active ? undefined : model.provider,
        modelId: active ? undefined : model.modelId,
      }
    })
  }, [])

  const toggleProject = useCallback((project: Pick<UsageCostProjectRow, 'cwd'>) => {
    setDrillDown((current) => ({
      ...current,
      cwd: current.cwd === project.cwd ? undefined : project.cwd,
    }))
  }, [])

  const clearDrillDown = useCallback(() => {
    setDrillDown({})
  }, [])

  return {
    query,
    drillDown,
    view: viewQuery.data ?? null,
    isLoading: viewQuery.isLoading,
    isError: viewQuery.isError,
    errorMessage: viewQuery.error instanceof Error ? viewQuery.error.message : null,
    sessions: sessionsQuery.data?.sessions ?? [],
    sessionsLoading: sessionsQuery.isLoading,
    refresh,
    setRange,
    setOrigin,
    toggleDay,
    toggleModel,
    toggleProject,
    clearDrillDown,
  }
}
