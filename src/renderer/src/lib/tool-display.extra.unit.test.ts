/**
 * Additional unit tests for tool-display — covers branches
 * not exercised by the existing tool-display.unit.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { getToolActionText, getToolConfig, getToolVerbs } from './tool-display'

describe('getToolConfig', () => {
  it('returns the configured icon and primaryArg for a known tool', () => {
    const config = getToolConfig('readFile')
    expect(config.displayName).toBe('Read File')
    expect(config.primaryArg).toBe('path')
  })

  it('returns default config with tool name as displayName for unknown tool', () => {
    const config = getToolConfig('myCustomTool')
    expect(config.displayName).toBe('myCustomTool')
    expect(config.primaryArg).toBe('')
  })

  it('returns correct config for browser tools', () => {
    const navigate = getToolConfig('browserNavigate')
    expect(navigate.displayName).toBe('Navigate')
    expect(navigate.primaryArg).toBe('url')

    const screenshot = getToolConfig('browserScreenshot')
    expect(screenshot.displayName).toBe('Screenshot')
    expect(screenshot.primaryArg).toBe('')
  })

  it('returns correct config for loadAgents', () => {
    const config = getToolConfig('loadAgents')
    expect(config.displayName).toBe('Load Agents')
    expect(config.primaryArg).toBe('')
  })
})

describe('getToolVerbs — additional tools', () => {
  it('returns verbs for browser tools', () => {
    expect(getToolVerbs('browserNavigate')).toEqual({
      running: 'Navigating to',
      completed: 'Navigated to',
    })
    expect(getToolVerbs('browserClick')).toEqual({ running: 'Clicking', completed: 'Clicked' })
    expect(getToolVerbs('browserScreenshot')).toEqual({
      running: 'Taking screenshot',
      completed: 'Took screenshot',
    })
    expect(getToolVerbs('browserClose')).toEqual({
      running: 'Closing browser',
      completed: 'Closed browser',
    })
  })

  it('returns verbs for webFetch', () => {
    expect(getToolVerbs('webFetch')).toEqual({ running: 'Fetching', completed: 'Fetched' })
  })
})

describe('getToolActionText — additional branches', () => {
  it('returns verb only for completed unknown tool', () => {
    const text = getToolActionText('customTool', {}, false)
    expect(text).toBe('customTool')
  })

  it('returns verb with ellipsis when primary arg value is not a string (running)', () => {
    // The primary arg for readFile is `path` — pass a non-string value
    const text = getToolActionText('readFile', { path: 123 }, true)
    expect(text).toBe('Reading...')
  })

  it('returns verb only when primary arg value is not a string (completed)', () => {
    const text = getToolActionText('readFile', { path: null }, false)
    expect(text).toBe('Read')
  })

  it('wraps command in backticks for running runCommand', () => {
    const text = getToolActionText('runCommand', { command: 'ls -la' }, true)
    expect(text).toBe('Running `ls -la`')
  })

  it('returns verb for tools with empty primaryArg (loadAgents)', () => {
    // loadAgents has primaryArg: '' — empty args object
    const running = getToolActionText('loadAgents', {}, true)
    expect(running).toBe('Loading agents...')

    const completed = getToolActionText('loadAgents', {}, false)
    expect(completed).toBe('Loaded agents')
  })

  it('returns verb text for browserNavigate with url arg', () => {
    const text = getToolActionText('browserNavigate', { url: 'https://example.com' }, true)
    expect(text).toBe('Navigating to https://example.com...')

    const completed = getToolActionText('browserNavigate', { url: 'https://example.com' }, false)
    expect(completed).toBe('Navigated to https://example.com')
  })

  it('returns verb for askUser with questions arg', () => {
    // askUser has no entry in TOOL_VERBS, so getToolVerbs falls back to tool name
    const text = getToolActionText('askUser', { questions: 'Should I proceed?' }, false)
    expect(text).toBe('askUser Should I proceed?')
  })
})
