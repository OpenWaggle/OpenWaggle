import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildMcpSessionPayloadV2,
  prepareMcpSessionFilesystemScope,
} from '../openwaggle-mcp-session-tool-v2'

describe('OpenWaggle MCP Session export v2 adapter', () => {
  const temporaryRoots: string[] = []

  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
    )
  })

  it('maps durable destination export lifecycle operations', () => {
    expect(
      buildMcpSessionPayloadV2({
        operation: 'export-create',
        sessionId: 'worker',
        exportFormat: 'bundle',
        destinationPath: '/allowed/worker.zip',
        branchScope: 'tree',
        exportResources: ['docs/architecture.md'],
        overwriteExisting: true,
      }),
    ).toMatchObject({
      request: {
        command: {
          operation: 'export-create',
          sessionId: 'worker',
          format: 'bundle',
          destinationPath: '/allowed/worker.zip',
          resources: [{ kind: 'workspace-file', path: 'docs/architecture.md' }],
          overwriteExisting: true,
        },
      },
    })
    expect(
      buildMcpSessionPayloadV2({
        operation: 'exports-wait',
        sessionId: 'worker',
        exportOperationId: 'export-1',
        timeoutMs: 30_000,
      }),
    ).toMatchObject({
      request: {
        query: {
          operation: 'exports-wait',
          sessionId: 'worker',
          exportOperationId: 'export-1',
          timeoutMs: 30_000,
        },
      },
    })
    expect(
      buildMcpSessionPayloadV2({
        operation: 'export-cancel',
        sessionId: 'worker',
        exportOperationId: 'export-1',
      }),
    ).toMatchObject({
      request: { command: { operation: 'export-cancel', exportOperationId: 'export-1' } },
    })
  })

  it('injects the canonical granted root into the async Host export operation', async () => {
    const root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-mcp-export-scope-')),
    )
    temporaryRoots.push(root)
    const workspace = path.join(root, 'workspace')
    const canonicalDirectory = path.join(workspace, 'exports')
    await fs.mkdir(canonicalDirectory, { recursive: true })
    await fs.symlink(canonicalDirectory, path.join(workspace, 'linked-exports'))
    const payload = buildMcpSessionPayloadV2({
      operation: 'export-create',
      sessionId: 'worker',
      destinationPath: path.join(workspace, 'linked-exports', 'worker.zip'),
      exportFormat: 'bundle',
    })

    await expect(
      prepareMcpSessionFilesystemScope(
        { workspaceRoots: [workspace], exportRoots: [workspace], sessionIds: new Set() },
        payload,
      ),
    ).resolves.toMatchObject({
      request: {
        command: {
          destinationPath: path.join(await fs.realpath(canonicalDirectory), 'worker.zip'),
          destinationRoot: await fs.realpath(workspace),
        },
      },
    })
  })

  it('rejects lifecycle and export paths that escape through an in-root symlink', async () => {
    const root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-mcp-path-scope-')),
    )
    temporaryRoots.push(root)
    const workspace = path.join(root, 'workspace')
    const outside = path.join(root, 'outside')
    await Promise.all([fs.mkdir(workspace), fs.mkdir(outside)])
    const escaped = path.join(workspace, 'escaped')
    await fs.symlink(outside, escaped)
    const scope = {
      workspaceRoots: [workspace],
      exportRoots: [workspace],
      sessionIds: new Set<string>(),
    }

    await expect(
      prepareMcpSessionFilesystemScope(
        scope,
        buildMcpSessionPayloadV2({ operation: 'create', projectPath: escaped }),
      ),
    ).rejects.toThrow('outside this server profile')
    await expect(
      prepareMcpSessionFilesystemScope(
        scope,
        buildMcpSessionPayloadV2({
          operation: 'export-create',
          sessionId: 'worker',
          destinationPath: path.join(escaped, 'worker.zip'),
        }),
      ),
    ).rejects.toThrow('outside the granted filesystem scope')
  })
})
