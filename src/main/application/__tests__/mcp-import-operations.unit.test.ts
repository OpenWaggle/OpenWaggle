import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyMcpImportsOperation,
  getMcpConfigurationOperation,
  getMcpServerStatusesOperation,
  inspectMcpServerOperation,
  previewMcpImportsOperation,
  signInMcpServerOperation,
  signOutMcpServerOperation,
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

  it('passes inspection, sign-in, and sign-out to the MCP runtime after decoding them', async () => {
    await expect(
      run(inspectMcpServerOperation({ projectPath: null, name: 'docs' })),
    ).resolves.toMatchObject({ name: 'docs', state: 'connected' })
    await expect(
      run(signInMcpServerOperation({ projectPath: harness.state.projectPath, name: 'docs' })),
    ).resolves.toEqual({ signedIn: false, authorizationUrl: 'https://auth.example/start' })
    await run(signOutMcpServerOperation({ projectPath: null, name: 'docs' }))
    await expect(
      failureMessage(signInMcpServerOperation({ projectPath: null, name: '' })),
    ).resolves.toMatch(/name/)

    expect(harness.state.runtimeCalls).toEqual([
      { operation: 'inspect', input: { projectPath: null, name: 'docs' } },
      { operation: 'sign-in', input: { projectPath: harness.state.projectPath, name: 'docs' } },
      { operation: 'sign-out', input: { projectPath: null, name: 'docs' } },
    ])
    await expect(
      failureMessage(
        signInMcpServerOperation({ projectPath: '/not-a-known-project', name: 'docs' }),
      ),
    ).resolves.toMatch(/Open this project in OpenWaggle/)
    expect(harness.state.runtimeCalls).toHaveLength(3)
  })

  it('opens Settings with the files and every server state without connecting to a server', async () => {
    harness.writeJson(harness.piGlobal(), { mcpServers: { docs: { command: 'docs-mcp' } } })

    const view = await run(getMcpConfigurationOperation({ projectPath: harness.state.projectPath }))
    const statuses = await run(
      getMcpServerStatusesOperation({ projectPath: harness.state.projectPath }),
    )

    expect(view.servers.map((server) => server.name)).toEqual(['docs'])
    expect(statuses).toEqual([{ name: 'docs', source: 'not-checked' }])
    expect(harness.state.runtimeCalls).toEqual([
      { operation: 'statuses', input: { projectPath: harness.state.projectPath } },
    ])
    await expect(
      failureMessage(getMcpServerStatusesOperation({ projectPath: '/not-a-known-project' })),
    ).resolves.toMatch(/Open this project in OpenWaggle/)
  })
})
