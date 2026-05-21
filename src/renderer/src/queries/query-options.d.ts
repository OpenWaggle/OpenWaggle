import type { DataTag, QueryKey, UndefinedInitialDataOptions } from '@tanstack/react-query'

export type OpenWaggleQueryOptions<
  TQueryFnData,
  TError = Error,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
> = UndefinedInitialDataOptions<TQueryFnData, TError, TData, TQueryKey> & {
  readonly queryKey: DataTag<TQueryKey, TQueryFnData, TError>
}
