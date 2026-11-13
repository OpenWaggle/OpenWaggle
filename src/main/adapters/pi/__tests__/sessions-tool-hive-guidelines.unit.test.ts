import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { SessionCapability } from '@shared/types/session-capability'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { createSessionsToolExtension } from '../sessions-tool-extension'
import { SELF_ARCHIVE_GUIDELINE } from '../sessions-tool-self-archive-guideline'
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

// Agents read the old "do not assume named roles exist" as "skip them" and wrote each role into
// the objective by hand next to a definition made for it.
describe('Hive tool Agent-definition guidance', () => {
  it('tells a Session that can start Sessions to pass agent when a definition fits', async () => {
    const registerTool = vi.fn()
    createSessionsToolExtension({
      sessionId: 'session-queen',
      runId: 'run-current',
      workingDirectory: '/project',
    })(fromPartial<ExtensionAPI>({ registerTool }))

    const text = await hiveHelpText(registerTool.mock.calls[0]?.[0])
    expect(text).toMatch(
      /When an Agent definition fits a role, spawn, launch, or create with agent: "<name>" and give it only the task, not the role; available_agents lists/,
    )
    expect(text).toContain('find them (projectPath for another project).')
    expect(text).not.toMatch(/do not assume named roles exist/)
  })

  it('names only spawn to a Worker that cannot launch or create', async () => {
    const registerTool = vi.fn()
    createSessionsToolExtension({
      sessionId: 'session-worker',
      runId: 'run-current',
      workingDirectory: '/project',
      sessionCapabilities: ['sessions:discover', 'sessions:read', 'sessions:spawn'],
    })(fromPartial<ExtensionAPI>({ registerTool }))

    const text = await hiveHelpText(registerTool.mock.calls[0]?.[0])
    expect(text).toMatch(/When an Agent definition fits a role, spawn with agent: "<name>"/)
    // A spawn-only Session is refused another project's catalog, so it is not offered one.
    expect(text).not.toContain('projectPath for another project')
  })

  it('offers another project only to a Session that can also list its Sessions', async () => {
    const registerTool = vi.fn()
    createSessionsToolExtension({
      sessionId: 'session-root',
      runId: 'run-current',
      workingDirectory: '/project',
      sessionCapabilities: ['sessions:create', 'sessions:start'],
    })(fromPartial<ExtensionAPI>({ registerTool }))

    const text = await hiveHelpText(registerTool.mock.calls[0]?.[0])
    expect(text).toMatch(/When an Agent definition fits a role, launch or create with agent/)
    expect(text).not.toContain('projectPath for another project')
  })
})

describe('Hive tool self-archive guidance', () => {
  it('explains a deferred self-archive only to a Session that may archive', async () => {
    const helpFor = async (sessionCapabilities?: readonly SessionCapability[]) => {
      const registerTool = vi.fn()
      await createSessionsToolExtension({
        sessionId: 'session-self',
        runId: 'run-current',
        workingDirectory: '/project',
        ...(sessionCapabilities ? { sessionCapabilities } : {}),
      })(fromPartial<ExtensionAPI>({ registerTool }))
      return hiveHelpText(registerTool.mock.calls[0]?.[0])
    }

    expect(await helpFor()).toContain(SELF_ARCHIVE_GUIDELINE)
    expect(await helpFor(['sessions:discover', 'sessions:read'])).not.toContain(
      SELF_ARCHIVE_GUIDELINE,
    )
  })
})

describe('Hive tool revision guidance (#454)', () => {
  async function queenTool() {
    const registerTool = vi.fn()
    await createSessionsToolExtension({
      sessionId: 'session-queen',
      runId: 'run-current',
      workingDirectory: '/project',
    })(fromPartial<ExtensionAPI>({ registerTool }))
    return registerTool.mock.calls[0]?.[0]
  }

  it('tells a reviewer that a revision request reaches the Worker and starts its Run', async () => {
    const tool = await queenTool()
    const overview = await hiveHelpText(tool)
    expect(overview).toMatch(
      /request revision \(it starts the Worker's Run with the feedback\) or accept/,
    )

    const topic = JSON.parse(await hiveHelpText(tool, 'delegation_request_revision'))
    const rules: string = topic.rules.join('\n')
    expect(rules).toMatch(/OpenWaggle Delegation revision request/)
    expect(rules).toMatch(/delegationId, parentSessionId, submissionRevision, feedback/)
    expect(rules).toMatch(/busy Worker runs it after its current Run/)
    expect(rules).toMatch(/refused with worker_message_denied and the Delegation does not change/)
    expect(rules).toMatch(
      /refused with parent_concurrency_limit_reached or host_run_ceiling_reached/,
    )

    const amendRules: string = JSON.parse(await hiveHelpText(tool, 'delegation_amend')).rules.join(
      '\n',
    )
    expect(amendRules).toMatch(
      /delegation_amend or delegation_dependency on a submitted result the Worker waits on you for \(ready_for_review, needs_attention or waiting\)/,
    )
    expect(amendRules).toMatch(
      /on a Worker still on the task \(working or revision_requested\) sends no Follow-up/,
    )
  })

  it('tells a Worker what a revision request from its parent looks like', async () => {
    const tool = await queenTool()
    expect(await hiveHelpText(tool)).toMatch(
      /revision request from your parent arrives as its Follow-up starting "OpenWaggle Delegation revision request", naming delegationId, submissionRevision and feedback/,
    )
  })
})
