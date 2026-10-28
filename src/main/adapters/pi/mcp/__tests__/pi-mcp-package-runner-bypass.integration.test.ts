import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { McpClient } from '@earendil-works/pi-mcp'
import { afterEach, describe, expect, it } from 'vitest'
import { setHostPackageRunnerBypassForTests } from '../../../mcp/runtime/host-package-runner-bypass'
import type { PackageBinStore } from '../../../mcp/runtime/mcp-package-runner-bin-store'
import type { ResolvedPackageBin } from '../../../mcp/runtime/mcp-package-runner-bins'
import { PackageRunnerBypass } from '../../../mcp/runtime/mcp-package-runner-bypass'
import { openPiMcpUpstream } from '../pi-mcp-upstream'

/** An MCP server that answers a tool call with its parent pid and its arguments. */
const SERVER = `#!/usr/bin/env node
const readline = require('node:readline')
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n')
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    send({ id: message.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } })
  } else if (message.method === 'tools/call') {
    const text = JSON.stringify({ ppid: process.ppid, args: process.argv.slice(2), bin: (process.env.PATH || '').split(require('node:path').delimiter)[0] })
    send({ id: message.id, result: { content: [{ type: 'text', text }] } })
  }
})
`

/**
 * A stand-in for npx: puts its cache's \`.bin\` first on PATH, then either runs the probe command
 * (\`--package=<spec> -- cmd…\`) or stays the parent of the package's bin, as npm exec does.
 */
const FAKE_NPX = `#!/bin/sh
export PATH="$FAKE_NPX_ROOT/node_modules/.bin:$PATH"
if [ "$1" = "--yes" ] || [ "$1" = "-y" ]; then shift; fi
case "$1" in
  --package=*) shift; [ "$1" = "--" ] && shift; "$@"; exit $? ;;
esac
shift
node "$FAKE_NPX_ROOT/node_modules/fixture-mcp/server.js" "$@"
`

const directories: string[] = []
afterEach(() => {
  setHostPackageRunnerBypassForTests(undefined)
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function memoryStore(): PackageBinStore {
  let saved: Record<string, ResolvedPackageBin> = {}
  return {
    load: () => ({ ...saved }),
    save: (entries) => {
      saved = { ...entries }
    },
  }
}

async function callServer(root: string, npx: string, cwd: string) {
  const upstream = openPiMcpUpstream({
    entry: {
      name: 'fixture',
      config: {
        command: npx,
        args: ['-y', 'fixture-mcp@latest', '--flag'],
        env: { FAKE_NPX_ROOT: root },
      },
      source: 'test',
    },
    transport: 'stdio',
    cwd,
    authProvider: undefined,
  })
  const client = new McpClient({ name: 'pi', version: '1' })
  try {
    await client.connect(upstream.transport)
    const result = await client.callTool('ppid', {})
    const [content] = result.content
    if (content?.type !== 'text') throw new Error('no text')
    const parsed: { ppid: number; args: string[]; bin: string } = JSON.parse(content.text)
    return parsed
  } finally {
    await client.close()
    await upstream.close?.()
  }
}

describe.skipIf(process.platform === 'win32')('MCP package runner bypass (D1.2)', () => {
  it('spawns an npx server’s bin directly after its first launch, with the same arguments', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'ow-npx-fixture-'))
    directories.push(root)
    const packageDir = path.join(root, 'node_modules', 'fixture-mcp')
    mkdirSync(path.join(root, 'node_modules', '.bin'), { recursive: true })
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({ name: 'fixture-mcp', bin: 'server.js' }),
    )
    writeFileSync(path.join(packageDir, 'server.js'), SERVER)
    const npx = path.join(root, 'npx')
    writeFileSync(npx, FAKE_NPX)
    chmodSync(npx, 0o755)
    // Run elsewhere: a package installed in the server's folder is left to the runner.
    const cwd = mkdtempSync(path.join(tmpdir(), 'ow-npx-cwd-'))
    directories.push(cwd)
    const bypass = new PackageRunnerBypass({ store: memoryStore() })
    setHostPackageRunnerBypassForTests(bypass)

    const first = await callServer(root, npx, cwd)
    expect(first.ppid).not.toBe(process.pid)
    expect(first.args).toEqual(['--flag'])
    await bypass.settled()

    const second = await callServer(root, npx, cwd)
    // No wrapper: the server is the Host's own child.
    expect(second.ppid).toBe(process.pid)
    expect(second.args).toEqual(['--flag'])
    expect(second.bin).toBe(path.join(root, 'node_modules', '.bin'))
    expect(readFileSync(path.join(packageDir, 'server.js'), 'utf8')).toBe(SERVER)
  })
})
