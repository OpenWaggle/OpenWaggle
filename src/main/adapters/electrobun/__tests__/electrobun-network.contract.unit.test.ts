import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PortContract } from '../../../ports/desktop-shell/__tests__/contracts/port-contract'
import { networkFetchContract } from '../../../ports/desktop-shell/__tests__/contracts/network-fetch.contract'
import { createBunNetworkFetch, electrobunNetworkFetch } from '../electrobun-network-fetch'
import {
  parseScutilProxy,
  parseWindowsProxy,
  applySystemProxyOnce,
  readSystemProxy,
  systemProxyEnvironment,
} from '../electrobun-system-proxy'

/** One test per contract case, each against a fresh harness of the Electrobun adapter. */
function runContract<Harness>(contract: PortContract<Harness>, setup: () => Promise<Harness>) {
  describe(`${contract.port} contract (Electrobun)`, () => {
    it.for(Object.entries(contract.cases))('%s', async ([, check]) => check(await setup()))
  })
}

runContract(networkFetchContract, async () => {
  const sent: string[] = []
  const subject = createBunNetworkFetch(async (input) => {
    sent.push(typeof input === 'string' ? input : input.url)
    return new Response('ok')
  })
  return { subject, sent: () => sent, fetchAsExtension: (url) => subject.fetch(url) }
})

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('Electrobun network stack', () => {
  it('reads file URLs with their content type', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'openwaggle-fetch-'))
    directories.push(directory)
    const file = path.join(directory, 'index.html')
    await writeFile(file, '<p>hi</p>')
    const response = await electrobunNetworkFetch.fetch(pathToFileURL(file).toString())
    expect(response.headers.get('content-type')).toMatch(/^text\/html/u)
    expect(await response.text()).toBe('<p>hi</p>')
  })

  it('reads the macOS proxies scutil prints', () => {
    const output = [
      '<dictionary> {',
      '  ExceptionsList : <array> {',
      '    0 : *.local',
      '    1 : 169.254/16',
      '  }',
      '  HTTPEnable : 1',
      '  HTTPPort : 8080',
      '  HTTPProxy : proxy.corp',
      '  HTTPSEnable : 0',
      '}',
    ].join('\n')
    expect(parseScutilProxy(output)).toEqual({
      http: 'http://proxy.corp:8080',
      noProxy: '*.local,169.254/16',
    })
  })

  it('reads the Windows Internet Settings proxies, shared or per scheme', () => {
    const key = (server: string) =>
      `    ProxyEnable    REG_DWORD    0x1\n    ProxyServer    REG_SZ    ${server}\n    ProxyOverride    REG_SZ    <local>;*.corp`
    expect(parseWindowsProxy(key('proxy:3128'))).toEqual({
      http: 'http://proxy:3128',
      https: 'http://proxy:3128',
      noProxy: 'localhost,127.0.0.1,::1,*.corp',
    })
    expect(parseWindowsProxy(key('http=a:1;https=b:2')).https).toBe('http://b:2')
    expect(parseWindowsProxy('    ProxyEnable    REG_DWORD    0x0')).toEqual({})
  })

  it('reads the system proxy once per process, however many bundles apply it', () => {
    const environment: Record<string, string | undefined> = {}
    const marks = {}
    const read = vi.fn(() => ({ https: 'http://gw:8080' }))
    applySystemProxyOnce(environment, read, marks)
    applySystemProxyOnce(environment, read, marks)
    expect(read).toHaveBeenCalledTimes(1)
    expect(environment).toEqual({ HTTPS_PROXY: 'http://gw:8080' })
  })

  it('reads a manual GNOME proxy and keeps the user variables first', () => {
    const settings: Record<string, string> = {
      'org.gnome.system.proxy mode': "'manual'",
      'org.gnome.system.proxy ignore-hosts': "['localhost', '127.0.0.0/8']",
      'org.gnome.system.proxy.http host': "'gw'",
      'org.gnome.system.proxy.http port': '3128',
      'org.gnome.system.proxy.https host': "''",
      'org.gnome.system.proxy.https port': '0',
    }
    const proxy = readSystemProxy(
      'linux',
      (_command, args) => settings[args.slice(1).join(' ')] ?? '',
    )
    expect(proxy).toEqual({ http: 'http://gw:3128', noProxy: 'localhost,127.0.0.0/8' })
    expect(systemProxyEnvironment({}, proxy)).toEqual({
      HTTP_PROXY: 'http://gw:3128',
      NO_PROXY: 'localhost,127.0.0.0/8',
    })
    expect(systemProxyEnvironment({ https_proxy: 'http://mine' }, proxy)).toEqual({})
  })
})
