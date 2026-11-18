import type { SourceControlConfigureRequest } from '@shared/types/git'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { configureSourceControl } from '@/queries/source-control'
import { useUIStore } from '@/shell/ui-store'

/** Applies Settings' source-control changes; failures surface as a toast unless the caller shows them. */
export function useSourceControlConfigure() {
  const queryClient = useQueryClient()
  const showToast = useUIStore((state) => state.showToast)
  const [pending, setPending] = useState(false)

  const configure = async (request: SourceControlConfigureRequest) => {
    setPending(true)
    try {
      return await configureSourceControl(queryClient, request)
    } catch (cause) {
      return {
        ok: false,
        message: cause instanceof Error ? cause.message : 'Could not save this change.',
      } as const
    } finally {
      setPending(false)
    }
  }

  const configureOrToast = (request: SourceControlConfigureRequest) => {
    void configure(request).then((result) => {
      if (!result.ok) showToast(result.message, 'error')
    })
  }

  return { configure, configureOrToast, pending }
}
