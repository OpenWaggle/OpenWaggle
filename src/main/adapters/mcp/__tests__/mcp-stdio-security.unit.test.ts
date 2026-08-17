import { describe, expect, it, vi } from 'vitest'
import { createMacosProfile, resolveStdioExecutionPaths } from '../runtime/stdio-sandbox'
import { createMcpStderrObserver } from '../runtime/stdio-stderr'
import { server, snapshot } from './mcp-runtime-test-utils'

describe('MCP stdio security', () => {
  it('suppresses server stderr content whenever vault secrets were injected', () => {
    const log = vi.fn()
    const observe = createMcpStderrObserver({
      serverName: 'private-server',
      suppressContent: true,
      log,
    })

    observe('token=super-secret-value')
    observe('super-secret-value split across another chunk')

    expect(log).toHaveBeenCalledOnce()
    expect(JSON.stringify(log.mock.calls)).not.toContain('super-secret-value')
    expect(log.mock.calls[0]?.[1]).toEqual({
      server: 'private-server',
      message: '[content suppressed because vault secrets were injected]',
    })
  })

  it('retains bounded stderr diagnostics when no vault secret is present', () => {
    const log = vi.fn()
    const observe = createMcpStderrObserver({
      serverName: 'public-server',
      suppressContent: false,
      log,
    })

    observe('diagnostic output\n')

    expect(log.mock.calls[0]?.[1]).toEqual({
      server: 'public-server',
      message: 'diagnostic output',
    })
  })

  it('resolves cwd and sandbox grants from the execution worktree', () => {
    const logicalProject = '/projects/openwaggle'
    const executionPath = '/worktrees/session-1'
    const configuredServer = server({
      permissions: {
        readRoots: ['packages/docs', 'docs'],
        writeRoots: ['.cache'],
        allowNetwork: false,
      },
      definition: {
        command: 'docs-mcp',
        cwd: 'packages/docs',
        security: { readRoots: ['ignored-request'], allowNetwork: true },
      },
    })

    expect(
      resolveStdioExecutionPaths(
        snapshot({ projectPath: logicalProject, executionPath }),
        configuredServer,
      ),
    ).toEqual({
      projectPath: executionPath,
      cwd: '/worktrees/session-1/packages/docs',
      readRoots: ['/worktrees/session-1/packages/docs', '/worktrees/session-1/docs'],
      writeRoots: ['/worktrees/session-1/.cache'],
    })
  })

  it('grants macOS writes only to approved roots and an isolated temporary directory', () => {
    const profile = createMacosProfile({
      executable: '/opt/mcp/bin/server',
      cwd: '/worktrees/session-1',
      temporaryDirectory: '/isolated/mcp-temp',
      readRoots: ['/worktrees/session-1/docs'],
      writeRoots: ['/worktrees/session-1/.cache'],
      allowNetwork: false,
    })

    expect(profile).toContain('(allow file-read* (subpath "/isolated/mcp-temp"))')
    expect(profile).toContain('(allow file-write* (subpath "/isolated/mcp-temp"))')
    expect(profile).toContain('(allow file-write* (subpath "/worktrees/session-1/.cache"))')
    expect(profile).not.toContain('(allow file-read* (subpath "/worktrees/session-1"))')
    expect(profile).not.toContain('(allow network-outbound)')
  })
})
