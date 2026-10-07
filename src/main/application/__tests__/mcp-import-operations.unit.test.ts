import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MCP_RUNTIME_UNAVAILABLE_MESSAGE } from '../../adapters/mcp/unavailable-mcp-server-runtime-service'
import {
  applyMcpImportsOperation,
  inspectMcpServerOperation,
  previewMcpImportsOperation,
  signInMcpServerOperation,
} from '../mcp-configuration-operations'
import { createMcpOperationsHarness } from './mcp-configuration-operations.test-harness'

const harness = createMcpOperationsHarness()
const { run, failureMessage, servers, owGlobal } = harness

describe('MCP import and runtime operations', () => {
  it('previews imports from other tools and applies the chosen ones to OpenWaggle', async () => {
    harness.state.sourceFiles.set(
      path.join(harness.state.homeDir, '.cursor', 'mcp.json'),
      JSON.stringify({ mcpServers: { linear: { url: 'https://mcp.linear.app/mcp' } } }),
    )
    harness.state.sourceFiles.set(
      path.join(harness.state.homeDir, '.codex', 'config.toml'),
      '[mcp_servers.files]\ncommand = "npx"\nargs = ["files-mcp"]\n',
    )

    const preview = await run(previewMcpImportsOperation({ projectPath: null }))
    const linear = preview.candidates.find((candidate) => candidate.name === 'linear')
    expect(preview.candidates.map((candidate) => [candidate.source, candidate.target])).toEqual([
      ['codex', 'npx files-mcp'],
      ['cursor', 'https://mcp.linear.app/mcp'],
    ])
    if (!linear) throw new Error('Expected the Cursor server in the preview.')

    const result = await run(
      applyMcpImportsOperation({
        projectPath: null,
        fingerprints: [linear.fingerprint],
        target: 'global',
        conflictPolicy: 'skip',
      }),
    )

    expect(result.imported.map((item) => item.targetName)).toEqual(['linear'])
    expect(result.view.servers.map((server) => server.name)).toEqual(['linear'])
    expect(servers(owGlobal()).linear).toMatchObject({ url: 'https://mcp.linear.app/mcp' })
    const again = await run(previewMcpImportsOperation({ projectPath: null }))
    expect(again.candidates.find((candidate) => candidate.name === 'linear')?.status).toBe(
      'imported',
    )
  })

  it('rejects an import source the importer does not know', async () => {
    await expect(
      failureMessage(previewMcpImportsOperation({ projectPath: null, sources: ['pi'] })),
    ).resolves.toMatch(/sources/)
  })

  it('reports the temporary runtime as not connected and sign-in as unavailable', async () => {
    await expect(
      run(inspectMcpServerOperation({ projectPath: null, name: 'docs' })),
    ).resolves.toEqual({
      name: 'docs',
      state: 'not-connected',
      tools: [],
      error: MCP_RUNTIME_UNAVAILABLE_MESSAGE,
    })
    await expect(
      failureMessage(signInMcpServerOperation({ projectPath: null, name: 'docs' })),
    ).resolves.toMatch(/not available yet/)
  })
})
