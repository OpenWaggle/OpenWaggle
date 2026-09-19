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
const sessionsTool = read('src/main/adapters/pi/sessions-tool-extension.ts')
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
    // Identity is the stable instance id, so a rename cannot move the grant.
    expect(clientInteractions).toContain('requesterId: input.serverInstanceId')
  })

  it('routes Session export writes through the filesystem authorization channel', () => {
    expect(sessionsTool).toContain('Allow Session export write?')
    expect(sessionsTool).toContain("capability: 'sessions.export-write'")
    expect(sessionsTool).toContain("requesterId: 'openwaggle:sessions'")
  })

  it('routes Session attachment reads through the filesystem authorization channel', () => {
    expect(sessionsTool).toContain('Allow Session attachment read?')
    expect(sessionsTool).toContain("capability: 'sessions.attachment-read'")
  })

  it('routes Session export resource reads through the filesystem authorization channel', () => {
    expect(sessionsTool).toContain('Allow Session export resource read?')
    expect(sessionsTool).toContain("capability: 'sessions.resource-read'")
  })

  it('declares opening an external URL as external navigation', () => {
    // The consequence continues outside the app at a destination a third party chose, so no access
    // mode may start it. Declaring the purpose is what makes that rule checkable; labelling it
    // `user-input` happened to behave correctly but left CONTEXT.md's rule about external navigation
    // describing a purpose no request ever carried.
    const elicitation = clientInteractions.slice(
      clientInteractions.indexOf('Open MCP elicitation URL?') - 400,
      clientInteractions.indexOf('Open MCP elicitation URL?') + 400,
    )
    expect(elicitation).toContain("purpose: 'external-navigation'")
    expect(elicitation).not.toContain('getOpenWaggleAuthorize')
  })

  it('declares the input request as a disclosure', () => {
    // Auto-granting this would skip the screen naming the server and the requested schema, then hand
    // the user a bare editor. It saves no work, it only removes the explanation.
    const disclosure = clientInteractions.slice(
      clientInteractions.indexOf('Review MCP input request?') - 400,
      clientInteractions.indexOf('Review MCP input request?') + 400,
    )
    expect(disclosure).toContain("purpose: 'disclosure'")
    expect(disclosure).not.toContain('getOpenWaggleAuthorize')
  })

  it('uses every purpose the domain language defines', () => {
    // CONTEXT.md names four purposes and states that disclosure and external navigation are never
    // answered automatically. A purpose with no producer makes that rule unverifiable, so each one
    // has to be declared somewhere.
    const declared = [
      clientInteractions,
      uiContext,
      read('src/main/application/agent-authorization-request.ts'),
    ].join('\n')

    for (const purpose of ['authorization', 'user-input', 'disclosure', 'external-navigation']) {
      expect(declared).toContain(`purpose: '${purpose}'`)
    }
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

  it('has exactly five authorization call sites in the whole application', () => {
    const authorizationSites = [toolExecution, clientInteractions, sessionsTool].reduce(
      (total, source) => total + source.split('getOpenWaggleAuthorize(').length - 1,
      0,
    )
    expect(authorizationSites).toBe(5)
  })
})
