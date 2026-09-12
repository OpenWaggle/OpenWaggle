export type CliShimManagement = 'user-shim' | 'installer' | 'unsupported'
export type CliShimState = 'installed' | 'outdated' | 'not-installed' | 'conflict' | 'unavailable'

export interface CliShimStatus {
  readonly management: CliShimManagement
  readonly state: CliShimState
  readonly commandPath: string | null
  readonly onPath: boolean
  readonly detail?: string
}

export type CliShimMutationResult =
  | { readonly ok: true; readonly status: CliShimStatus }
  | { readonly ok: false; readonly error: string; readonly status: CliShimStatus }
