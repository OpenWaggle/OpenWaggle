import { Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'
import { createFilesystemMcpImportService } from '../filesystem-mcp-import-service'

const HOME = '/home/user'

describe('the filesystem MCP import service', () => {
  it('says to import for every project when the project is the home folder', async () => {
    const service = createFilesystemMcpImportService({
      homeDir: HOME,
      piAgentDir: `${HOME}/.pi/agent`,
      platform: 'linux',
      reader: { readText: () => undefined },
      readSourceText: async () => undefined,
    })

    const exit = await Effect.runPromiseExit(
      service.apply(
        { projectPath: HOME, fingerprints: ['fp'], target: 'project', conflictPolicy: 'skip' },
        () => Effect.void,
      ),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    expect(JSON.stringify(exit)).toContain(
      'This project is your home folder, so its .openwaggle/mcp.json is the global file. Import into All projects instead.',
    )
  })
})
