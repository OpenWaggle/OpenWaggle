import { isSourceControlHostName, sourceControlHostKey } from '@shared/types/source-control'

/** Where a Git remote points, as OpenWaggle needs it to address the provider. */
export interface RemoteLocation {
  readonly host: string
  /** Hostname plus a non-default port, as the provider's web and API addresses use it. */
  readonly webAuthority: string
  readonly sshTransport: boolean
  /** The server address exactly as the remote names it, including any SSH or HTTPS port. */
  readonly authority: string
  readonly owner: string
  readonly repository: string
}

const SCP_REMOTE = /^(?:[^@/\s]+@)?(?<host>[^:/\s]+):(?<path>[^/].*)$/u
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//iu
const WINDOWS_DRIVE = /^[a-z]$/iu
const NETWORK_SCHEMES = new Set(['http:', 'https:', 'ssh:', 'git:', 'git+ssh:', 'ssh+git:'])

function splitRepositoryPath(rawPath: string) {
  const segments = rawPath
    .replace(/\.git\/?$/u, '')
    .split('/')
    .filter(Boolean)
  const repository = segments.at(-1)
  const owner = segments.slice(0, -1).join('/')
  return repository && owner ? { owner, repository } : null
}

/** `user@host:owner/repo`; a single-letter host is a Windows drive, not a remote. */
function parseScpRemote(remoteUrl: string): RemoteLocation | null {
  const scp = SCP_REMOTE.exec(remoteUrl)
  const host = scp?.groups?.host
  const path = scp?.groups?.path ? splitRepositoryPath(scp.groups.path) : null
  if (!host || !path || WINDOWS_DRIVE.test(host)) return null
  const key = sourceControlHostKey(host)
  if (!isSourceControlHostName(key)) return null
  return { host: key, webAuthority: key, sshTransport: true, authority: key, ...path }
}

function parseUrl(value: string) {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

/** A URL path with its escapes decoded; a malformed escape is kept as written. */
function decodedPath(pathname: string) {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return pathname
  }
}

function parseUrlRemote(remoteUrl: string): RemoteLocation | null {
  const url = parseUrl(remoteUrl)
  if (!url || !NETWORK_SCHEMES.has(url.protocol.toLowerCase()) || !url.hostname) return null
  const path = splitRepositoryPath(decodedPath(url.pathname))
  if (!path) return null
  const http = url.protocol === 'http:' || url.protocol === 'https:'
  const host = sourceControlHostKey(url.hostname)
  const webAuthority = http ? sourceControlHostKey(url.host) : host
  // Only plain hostnames ever reach a CLI argument, a settings key, or a terminal command.
  if (!isSourceControlHostName(host) || !isSourceControlHostName(webAuthority)) return null
  return {
    host,
    webAuthority,
    sshTransport: !http && url.protocol !== 'git:',
    authority: sourceControlHostKey(url.host),
    ...path,
  }
}

/**
 * Host, owner, and repository from an SCP-style or URL Git remote; null for local paths and for
 * any host that is not a plain hostname (ADR 0048).
 */
export function parseRemoteLocation(remoteUrl: string): RemoteLocation | null {
  const trimmed = remoteUrl.trim()
  return URL_SCHEME.test(trimmed) ? parseUrlRemote(trimmed) : parseScpRemote(trimmed)
}
