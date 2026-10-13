import { describe, expect, it } from 'vitest'
import { mcpMissingSecrets } from '../mcp-server-model'

describe('the vault secrets a configured MCP server lacks', () => {
  it('lists those it reads that the vault does not hold, by name', () => {
    const server = { vaultSecrets: ['API_TOKEN', 'WEB_AUTH'] }

    expect(mcpMissingSecrets(server, [{ name: 'WEB_AUTH' }])).toEqual(['API_TOKEN'])
    expect(mcpMissingSecrets(server, [{ name: 'API_TOKEN' }, { name: 'WEB_AUTH' }])).toEqual([])
    expect(mcpMissingSecrets({}, [])).toEqual([])
  })
})
