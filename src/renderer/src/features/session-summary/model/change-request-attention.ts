import type {
  SourceControlAttention,
  SourceControlCli,
  SourceControlProviderId,
  VcsStatus,
} from '@shared/types/git'

/** Install guides linked next to the copyable install command. */
export const SOURCE_CONTROL_CLI_INSTALL_GUIDES: Readonly<Record<SourceControlCli, string>> = {
  gh: 'https://github.com/cli/cli#installation',
  glab: 'https://gitlab.com/gitlab-org/cli#installation',
}

const WINGET_PACKAGES: Readonly<Record<SourceControlCli, string>> = {
  gh: 'GitHub.cli',
  glab: 'GLab.GLab',
}

/** "A", "A or B", "A, B or C". */
export function formatAlternatives(values: readonly string[]) {
  if (values.length <= 1) return values[0] ?? ''
  return `${values.slice(0, -1).join(', ')} or ${values.at(-1) ?? ''}`
}

/**
 * What the user must fix before change requests work. The remote half wins because it is the
 * newer answer; an offline provider question is moot once the remote probe decided a provider.
 */
export function effectiveChangeRequestAttention(
  status: VcsStatus | null,
): SourceControlAttention | null {
  if (status === null) return null
  if (status.changeRequestAttention) return status.changeRequestAttention
  const local = status.sourceControlAttention
  if (local?.kind === 'choose-provider' && status.sourceControlProvider) return null
  return local ?? null
}

/** Best-effort provider of a change request URL, for provider-specific fallback copy. */
export function changeRequestProviderFromUrl(url: string): SourceControlProviderId | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.pathname.includes('/-/merge_requests/') || parsed.hostname.includes('gitlab')) {
    return 'gitlab'
  }
  if (/\/pull\/\d+/u.test(parsed.pathname) || parsed.hostname.includes('github')) return 'github'
  return null
}

/**
 * The one-line install command for this platform, or null on Linux, where the package depends on
 * the distribution and the install guide is the better answer.
 */
export function sourceControlCliInstallCommand(
  cli: SourceControlCli,
  userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent,
) {
  if (/Mac/iu.test(userAgent)) return `brew install ${cli}`
  if (/Windows|Win32|Win64/iu.test(userAgent)) return `winget install --id ${WINGET_PACKAGES[cli]}`
  return null
}

/**
 * Label for opening a provider page: "Open on GitHub" / "Open on GitLab", or the page's host when
 * the provider is unknown.
 */
export function providerSiteLabel(provider: SourceControlProviderId | null, url: string) {
  const resolved = provider ?? changeRequestProviderFromUrl(url)
  if (resolved === 'github') return 'Open on GitHub'
  if (resolved === 'gitlab') return 'Open on GitLab'
  try {
    return `Open on ${new URL(url).hostname}`
  } catch {
    return 'Open on provider'
  }
}

/** Lowercase host of a URL, or null when it is not a URL. */
export function urlHost(url: string) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}
