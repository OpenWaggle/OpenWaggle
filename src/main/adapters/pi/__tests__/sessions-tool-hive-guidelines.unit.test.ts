import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { createSessionsToolExtension } from '../sessions-tool-extension'
import { hiveHelpText } from './hive-help.test-utils'

describe('Hive tool Hive cleanup guidance', () => {
  it('tells the Queen that finished untouched Workers are archived and come back with new work', async () => {
    const registerTool = vi.fn()
    await createSessionsToolExtension({
      sessionId: 'session-queen',
      runId: 'run-current',
      workingDirectory: '/project',
    })(fromPartial<ExtensionAPI>({ registerTool }))

    const guidelines = (await hiveHelpText(registerTool.mock.calls[0]?.[0])).split('\n')
    expect(guidelines).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/accept or cancel a Worker.*archives it on your behalf/),
      ]),
    )
    expect(guidelines).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /start, follow_up, steer, or replace to a Worker that cleanup archived, or reopening or requesting revision of its Delegation, restores it/,
        ),
      ]),
    )
    expect(guidelines).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/archived explicitly stays archived; use unarchive to show it again/),
      ]),
    )
  })
})

describe('Hive tool cross-project guidance', () => {
  it('tells the agent how to reach Sessions and start work in another repository', async () => {
    const registerTool = vi.fn()
    await createSessionsToolExtension({
      sessionId: 'session-independent',
      runId: 'run-current',
      workingDirectory: '/project',
    })(fromPartial<ExtensionAPI>({ registerTool }))

    const guidelines = (await hiveHelpText(registerTool.mock.calls[0]?.[0])).split('\n')
    expect(guidelines).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /root Session started from the desktop or from a catalog-wide CLI profile reaches Sessions in every project OpenWaggle knows.*current Run was started by the desktop user.*Workers and project-scoped callers stay in their own scope.*catalogScope project.*projectPath to launch or create with workspace local or new-worktree/,
        ),
      ]),
    )
  })
})

describe('Hive tool next-actor guidance (#380)', () => {
  it('explains nextActor in the description and the guidelines', async () => {
    const registerTool = vi.fn()
    await createSessionsToolExtension({
      sessionId: 'session-queen',
      runId: 'run-current',
      workingDirectory: '/project',
    })(fromPartial<ExtensionAPI>({ registerTool }))

    const tool = registerTool.mock.calls[0]?.[0]
    expect(tool?.description).toMatch(/carry nextActor: user, parent, worker, or none/)
    expect((await hiveHelpText(tool)).split('\n')).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /carries nextActor.*user when only the person can unblock it.*parent when its parent agent acts next.*worker when it is working or revising.*none once its Delegation is accepted or cancelled/,
        ),
      ]),
    )
  })
})

// `queueState: "running"` with `activeRunId: null` read as a stuck Session to an agent; it is a
// Follow-up queue that is not paused on an idle Session (#351 fixed only the CLI's human output).
describe('Hive tool status guidance', () => {
  it('explains status queueState and activeRunId', async () => {
    const registerTool = vi.fn()
    await createSessionsToolExtension({
      sessionId: 'session-queen',
      runId: 'run-current',
      workingDirectory: '/project',
    })(fromPartial<ExtensionAPI>({ registerTool }))

    const help = JSON.parse(await hiveHelpText(registerTool.mock.calls[0]?.[0], 'status'))
    expect(help.rules.join('\n')).toMatch(
      /status queueState running means the Follow-up queue is not paused.*activeRunId null means the Session is idle/,
    )
  })
})
