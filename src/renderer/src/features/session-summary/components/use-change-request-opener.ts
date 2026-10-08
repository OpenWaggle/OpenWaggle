import type { ChangeRequestOpenDestination } from '@shared/types/git'
import { useQuery } from '@tanstack/react-query'
import {
  changeRequestOpenDestinationQueryOptions,
  useSourceControlQueryFreshness,
} from '@/queries/source-control'
import { openWorkspaceWebLink } from '@/shell/open-workspace-web-link'
import { useUIStore } from '@/shell/ui-store'
import type { ChangeRequestOpener } from './ChangeRequestLinkRow'

const WEBSITE_FALLBACK: ChangeRequestOpenDestination = 'website'

interface ChangeRequestOpenerInput {
  readonly sessionId: string | null
  readonly projectPath: string | null
  readonly enabled: boolean
  readonly onOpenInspector: (url: string) => void
}

/**
 * The Session's Change request open destination, resolved by the Session Host from the project
 * override, the user's choice, the project's shared file, or the default. Rows wait for that
 * answer rather than guess. A Host that cannot answer cannot serve the inspector either
 * (ADR 0048), so rows then open the provider website, wherever the user's web links open.
 */
export function useChangeRequestOpener(input: ChangeRequestOpenerInput): ChangeRequestOpener {
  const showToast = useUIStore((state) => state.showToast)
  useSourceControlQueryFreshness()
  const resolution = useQuery({
    ...changeRequestOpenDestinationQueryOptions(input.projectPath),
    enabled: input.enabled,
  })
  return {
    destination: resolution.data?.destination ?? (resolution.isError ? WEBSITE_FALLBACK : null),
    openInInspector: input.onOpenInspector,
    openOnWebsite: (url) => {
      void openWorkspaceWebLink(input.sessionId ?? '', url).catch((cause: unknown) => {
        showToast(cause instanceof Error ? cause.message : 'Could not open this request.', 'error')
      })
    },
  }
}
