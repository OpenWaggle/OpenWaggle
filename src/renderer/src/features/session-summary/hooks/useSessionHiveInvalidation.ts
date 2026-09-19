import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { queryKeys } from '@/queries/query-keys'
import { subscribeSessionHiveUpdates } from '@/queries/session-hive-events'
import { api } from '@/shared/lib/ipc'

export function useSessionHiveInvalidation() {
  const queryClient = useQueryClient()
  useEffect(
    () =>
      subscribeSessionHiveUpdates(api, {
        invalidate: () => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.sessionHives })
        },
        resync: () => {
          void queryClient.resetQueries({ queryKey: queryKeys.sessionHives })
        },
      }),
    [queryClient],
  )
}
