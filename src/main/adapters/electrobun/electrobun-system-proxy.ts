import { execFileSync } from 'node:child_process'

/**
 * The operating system's proxy settings, read once at startup for Bun's `fetch` (ADR 0064):
 * Bun reads `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` but no system setting, where Electron's
 * network stack followed the system. Sources: `scutil --proxy` on macOS, the Internet Settings
 * registry key on Windows, GNOME's `gsettings` on Linux (other desktops export the variables).
 *
 * Costs and risks: one helper process at startup (10 to 40 ms); a PAC file or WPAD (automatic
 * configuration) is not evaluated, so such networks need the variables set by hand; a change of
 * network settings applies from the next launch.
 */
export interface SystemProxy {
  readonly http?: string
  readonly https?: string
  /** Hosts that bypass the proxy, in `NO_PROXY` syntax. */
  readonly noProxy?: string
}

const HELPER_TIMEOUT_MS = 3_000
const DECIMAL = 10
const HEXADECIMAL = 16
const SCHEME_GROUP = 1
const ADDRESS_GROUP = 2

type CommandReader = (command: string, args: readonly string[]) => string

const readCommand: CommandReader = (command, args) =>
  execFileSync(command, [...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: HELPER_TIMEOUT_MS,
    windowsHide: true,
  })

function proxyUrl(host: string | undefined, port: string | undefined) {
  if (!host) return undefined
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//iu.test(host) ? host : `http://${host}`
  return port ? `${withScheme}:${port}` : withScheme
}

function scutilValue(output: string, key: string) {
  const match = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, 'mu').exec(output)
  return match?.[1]
}

function scutilExceptions(output: string) {
  const block = /ExceptionsList\s*:\s*<array>\s*\{([^}]*)\}/u.exec(output)?.[1] ?? ''
  return [...block.matchAll(/^\s*\d+\s*:\s*(.+?)\s*$/gmu)].map((match) => match[1] ?? '')
}

/** `scutil --proxy` prints the active network service's proxies as a property list dump. */
export function parseScutilProxy(output: string): SystemProxy {
  const enabled = (key: string) => Number.parseInt(scutilValue(output, key) ?? '0', DECIMAL) === 1
  const http = enabled('HTTPEnable')
    ? proxyUrl(scutilValue(output, 'HTTPProxy'), scutilValue(output, 'HTTPPort'))
    : undefined
  const https = enabled('HTTPSEnable')
    ? proxyUrl(scutilValue(output, 'HTTPSProxy'), scutilValue(output, 'HTTPSPort'))
    : undefined
  const exceptions = scutilExceptions(output).filter((entry) => entry.length > 0)
  return {
    ...(http ? { http } : {}),
    ...(https ? { https } : {}),
    ...(exceptions.length > 0 ? { noProxy: exceptions.join(',') } : {}),
  }
}

function registryValue(output: string, name: string) {
  const match = new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.*?)\\s*$`, 'mu').exec(output)
  return match?.[1]
}

/**
 * `reg query ...\Internet Settings`: `ProxyEnable` and `ProxyServer`, either one `host:port` for
 * every scheme or `http=host:port;https=host:port`, and `ProxyOverride` with `;` separators.
 */
export function parseWindowsProxy(output: string): SystemProxy {
  const enable = registryValue(output, 'ProxyEnable')
  if (enable === undefined || Number.parseInt(enable, HEXADECIMAL) !== 1) return {}
  const server = registryValue(output, 'ProxyServer') ?? ''
  const perScheme = new Map(
    server
      .split(';')
      .map((part) => /^([^=]+)=(.+)$/u.exec(part))
      .filter((match) => match !== null)
      .map((match) => [(match[SCHEME_GROUP] ?? '').toLowerCase(), match[ADDRESS_GROUP] ?? '']),
  )
  const shared = server.includes('=') ? undefined : server
  const http = proxyUrl(perScheme.get('http') ?? shared, undefined)
  const https = proxyUrl(perScheme.get('https') ?? shared, undefined)
  const override = (registryValue(output, 'ProxyOverride') ?? '')
    .split(';')
    .map((entry) => (entry === '<local>' ? 'localhost,127.0.0.1,::1' : entry))
    .filter((entry) => entry.length > 0)
  return {
    ...(http ? { http } : {}),
    ...(https ? { https } : {}),
    ...(override.length > 0 ? { noProxy: override.join(',') } : {}),
  }
}

function gsettingsText(value: string) {
  return value.trim().replace(/^'(.*)'$/u, '$1')
}

function gnomeProxy(read: CommandReader): SystemProxy {
  const get = (schema: string, key: string) =>
    gsettingsText(read('gsettings', ['get', schema, key]))
  if (get('org.gnome.system.proxy', 'mode') !== 'manual') return {}
  const address = (scheme: 'http' | 'https') => {
    const schema = `org.gnome.system.proxy.${scheme}`
    const port = get(schema, 'port')
    return proxyUrl(get(schema, 'host') || undefined, port === '0' ? undefined : port)
  }
  const http = address('http')
  const https = address('https')
  const ignored = [...get('org.gnome.system.proxy', 'ignore-hosts').matchAll(/'([^']+)'/gu)].map(
    (match) => match[1] ?? '',
  )
  return {
    ...(http ? { http } : {}),
    ...(https ? { https } : {}),
    ...(ignored.length > 0 ? { noProxy: ignored.join(',') } : {}),
  }
}

/** The system's proxies, or none when they cannot be read. */
export function readSystemProxy(
  platform: NodeJS.Platform = process.platform,
  read: CommandReader = readCommand,
): SystemProxy {
  try {
    if (platform === 'darwin') return parseScutilProxy(read('scutil', ['--proxy']))
    if (platform === 'win32') {
      return parseWindowsProxy(
        read('reg.exe', [
          'query',
          'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
        ]),
      )
    }
    if (platform === 'linux') return gnomeProxy(read)
  } catch {
    // No helper, or no settings: Bun's fetch connects directly, as it would without them.
  }
  return {}
}

const PROXY_VARIABLES = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'] as const

/**
 * The environment variables that carry `proxy` to Bun's `fetch` here and in child processes,
 * unless the user set proxy variables already (those win, as they do for every CLI tool).
 */
export function systemProxyEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  proxy: SystemProxy,
): Record<string, string> {
  if (PROXY_VARIABLES.some((name) => environment[name])) return {}
  return {
    ...(proxy.http ? { HTTP_PROXY: proxy.http } : {}),
    ...(proxy.https ? { HTTPS_PROXY: proxy.https } : {}),
    ...(proxy.noProxy && !environment['NO_PROXY'] && !environment['no_proxy']
      ? { NO_PROXY: proxy.noProxy }
      : {}),
  }
}
