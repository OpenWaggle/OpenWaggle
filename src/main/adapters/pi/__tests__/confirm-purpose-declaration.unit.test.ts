import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Ties every confirmation call site to its declared purpose.
 *
 * Purpose used to be inferred by exact-matching four English titles inside
 * `interaction-ui-context.ts`, so renaming a title silently changed what full access was allowed to
 * answer, and nothing in typecheck, lint or the suite noticed. These assertions fail if a site
 * changes how it asks without also changing what it declares.
 */

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..')

function read(relativePath: string) {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf-8')
}

const toolExecution = read('src/main/adapters/pi/mcp-tool-execution.ts')
const clientInteractions = read('src/main/adapters/pi/mcp-client-interactions.ts')
const uiContext = read('src/main/adapters/pi/agent-kernel/interaction-ui-context.ts')
const presetManagement = read('packages/pi-waggle/src/default-preset-management.ts')

describe('declared confirmation purpose', () => {
  it('no longer infers purpose from the wording of a title', () => {
    expect(uiContext).not.toContain('confirmPurpose')
    expect(uiContext).not.toContain("title === 'Allow MCP tool call?'")
    expect(uiContext).not.toContain("title === 'Open MCP elicitation URL?'")
    expect(uiContext).not.toContain("title === 'Review MCP input request?'")
    expect(uiContext).not.toContain("title === 'Allow legacy MCP sampling?'")
  })

  it('makes plain confirm a question addressed to the user', () => {
    // The safe default. Anything that does not explicitly declare authorization cannot be
    // auto-granted, so a new call site is safe before anyone thinks about its purpose.
    expect(uiContext).toContain("purpose: 'user-input'")
    expect(uiContext).not.toContain("purpose: 'authorization'")
  })

  it('routes the MCP tool call through the authorization channel, keyed on server and tool', () => {
    expect(toolExecution).toContain('Allow MCP tool call?')
    expect(toolExecution).toContain('getOpenWaggleAuthorize')
    expect(toolExecution).toContain("capability: 'mcp.tool-call'")
    expect(toolExecution).toContain('requester: attribution.serverLabel')
    expect(toolExecution).toContain('resource: attribution.toolName')
  })

  it('keeps the tool call arguments out of the grant key', () => {
    // Arguments belong in the message a human reads, never in the identity of a kept approval.
    const scopeKeyBlock = toolExecution.slice(
      toolExecution.indexOf('scopeKey: {'),
      toolExecution.indexOf("capability: 'mcp.tool-call'") + 200,
    )
    expect(scopeKeyBlock).not.toContain('arguments')
  })

  it('routes MCP sampling through the authorization channel, keyed on the server alone', () => {
    expect(clientInteractions).toContain('Allow legacy MCP sampling?')
    expect(clientInteractions).toContain("capability: 'mcp.sampling'")
    expect(clientInteractions).toContain('requester: input.serverLabel')
  })

  it('leaves opening an external URL on the plain confirm path', () => {
    // External navigation continues outside the app at a destination a third party chose, so no
    // access mode may start it. Reaching plain confirm is what guarantees that.
    const elicitation = clientInteractions.slice(
      clientInteractions.indexOf('Open MCP elicitation URL?') - 400,
      clientInteractions.indexOf('Open MCP elicitation URL?') + 400,
    )
    expect(elicitation).toContain('ui.confirm')
    expect(elicitation).not.toContain('getOpenWaggleAuthorize')
  })

  it('leaves the input disclosure on the plain confirm path', () => {
    // Auto-granting this would skip the screen naming the server and the requested schema, then
    // hand the user a bare editor. It saves no work, it only removes the explanation.
    const disclosure = clientInteractions.slice(
      clientInteractions.indexOf('Review MCP input request?') - 400,
      clientInteractions.indexOf('Review MCP input request?') + 400,
    )
    expect(disclosure).toContain('ui.confirm')
    expect(disclosure).not.toContain('getOpenWaggleAuthorize')
  })

  it('leaves the elicitation completion check on the plain confirm path', () => {
    const completion = clientInteractions.slice(
      clientInteractions.indexOf('MCP elicitation opened') - 200,
      clientInteractions.indexOf('MCP elicitation opened') + 400,
    )
    expect(completion).toContain('ui.confirm')
    expect(completion).not.toContain('getOpenWaggleAuthorize')
  })

  it('leaves both Waggle preset confirmations on the plain confirm path', () => {
    expect(presetManagement).toContain('Hide built-in Waggle preset')
    expect(presetManagement).toContain('Delete Waggle preset')
    expect(presetManagement).toContain('ui.confirm')
    expect(presetManagement).not.toContain('getOpenWaggleAuthorize')
  })

  it('has exactly two authorization call sites in the whole application', () => {
    const authorizationSites = [toolExecution, clientInteractions].reduce(
      (total, source) => total + source.split('getOpenWaggleAuthorize(').length - 1,
      0,
    )
    expect(authorizationSites).toBe(2)
  })
})
