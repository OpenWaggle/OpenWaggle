import { expect, it } from 'vitest'
import { migrateOpenWaggleMcpFilesOnce } from '../../adapters/pi/mcp/openwaggle-mcp-migration'

it("never migrates the developer's own MCP files from a test", async () => {
  await expect(migrateOpenWaggleMcpFilesOnce('/repo')).resolves.toBeUndefined()
  expect(migrateOpenWaggleMcpFilesOnce.toString()).not.toContain('homedir')
})
