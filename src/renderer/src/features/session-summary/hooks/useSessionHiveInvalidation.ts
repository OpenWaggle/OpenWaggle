import { type InfiniteData, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { queryKeys } from '@/queries/query-keys'
import type { HiveRelationsPage } from '@/queries/session-hive-contract'
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
          // A Host restart invalidates continuation cursors, but clearing the first page
          // unmounts the visible Hive until the fresh read returns.
          queryClient.setQueriesData<InfiniteData<HiveRelationsPage>>(
            { queryKey: queryKeys.sessionHives },
            (data) =>
              data
                ? { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) }
                : data,
          )
          void queryClient.invalidateQueries({ queryKey: queryKeys.sessionHives })
        },
      }),
    [queryClient],
  )
}
