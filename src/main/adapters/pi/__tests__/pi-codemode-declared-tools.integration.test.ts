import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { type Context, fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai'
import { createAgentSessionFromServices, SessionManager } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it } from 'vitest'
import { createPiRuntimeServices } from '../pi-provider-catalog'

/**
 * With codemode on, Pi appended "Codemode: `tools.<name>(args)` resolves to a string." to the
 * description of every declared tool (82 tools cost 3.6k tokens on every request). The codemode
 * description now says it once; only tools that resolve to something else keep the line.
 */

const directories: string[] = []

afterEach(() => {
  while (directories.length > 0) {
    const directory = directories.pop()
    if (directory) rmSync(directory, { recursive: true, force: true })
  }
})

async function firstRequestTools() {
  const projectPath = mkdtempSync(path.join(tmpdir(), 'openwaggle-codemode-suffix-'))
  directories.push(projectPath)
  const services = await createPiRuntimeServices(projectPath)
  const faux = fauxProvider({
    provider: 'codemode-provider',
    models: [{ id: 'codemode-model', contextWindow: 200_000, maxTokens: 1_000 }],
  })
  services.modelRuntime.registerNativeProvider(faux.provider)
  await services.modelRuntime.setRuntimeApiKey(faux.provider.id, 'test-key')
  const requests: Context[] = []
  faux.setResponses([
    (context) => {
      requests.push(context)
      return fauxAssistantMessage('OK')
    },
  ])
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager: SessionManager.inMemory(projectPath),
    model: faux.getModel(),
  })
  try {
    await session.prompt('hello')
  } finally {
    session.dispose()
    await services.modelRuntime.refresh({ allowNetwork: false })
  }
  const leading = requests[0]?.messages[0]
  if (leading?.role !== 'system') throw new Error('The request has no leading system message')
  return new Map((leading.toolsAdded ?? []).map((tool) => [tool.name, tool.description]))
}

describe('declared tools with codemode on', () => {
  it('describe a string-returning tool without a per-tool codemode line', async () => {
    const tools = await firstRequestTools()

    expect(tools.get('codemode')).toContain('Tools declared to you are callable this way too')
    const declared = [...tools].filter(([name]) => name !== 'codemode')
    expect(declared.length).toBeGreaterThan(3)
    for (const [, description] of declared) {
      expect(description).not.toContain('resolves to a string.')
    }
    expect(declared.some(([, description]) => !description.includes('Codemode:'))).toBe(true)
    // bash resolves to an object in scripts, which the description still says.
    expect(tools.get('bash')).toContain('Codemode: `tools.bash(args)` resolves to')
  })
})
