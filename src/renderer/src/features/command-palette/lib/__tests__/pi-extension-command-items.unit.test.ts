import { describe, expect, it, vi } from 'vitest'
import { createPiExtensionCommandItems } from '../pi-extension-command-items'

const commands = [
  { name: 'mcp', description: 'Manage MCP servers' },
  { name: 'qa-hello' },
  // OpenWaggle's own /compact wins over an extension command of the same name.
  { name: 'compact', description: 'An extension compact' },
]

describe('the slash menu items of Pi extension commands', () => {
  it('lists each command with its description and inserts it when chosen', () => {
    const insertCommand = vi.fn()

    const items = createPiExtensionCommandItems({ commands, lowerQuery: '', insertCommand })

    expect(
      items.map(({ label, description, trailing }) => ({ label, description, trailing })),
    ).toEqual([
      { label: 'mcp', description: 'Manage MCP servers', trailing: '/mcp' },
      { label: 'qa-hello', description: 'Pi extension command', trailing: '/qa-hello' },
    ])
    items[0]?.action()
    expect(insertCommand).toHaveBeenCalledWith('/mcp')
  })

  it('keeps the commands whose name starts with the query', () => {
    const items = createPiExtensionCommandItems({
      commands,
      lowerQuery: 'qa',
      insertCommand: vi.fn(),
    })

    expect(items.map((item) => item.label)).toEqual(['qa-hello'])
  })
})
