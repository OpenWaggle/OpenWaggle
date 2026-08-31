import { describe, expect, it } from 'vitest'
import { sessionsToolSchemaForCapabilities } from '../sessions-tool-capability-schema'

function exposedActions(schema: ReturnType<typeof sessionsToolSchemaForCapabilities>) {
  return schema.anyOf.flatMap((alternative) => {
    const action = alternative.properties.action
    if ('const' in action && typeof action.const === 'string') return [action.const]
    if ('anyOf' in action && Array.isArray(action.anyOf)) {
      return action.anyOf.flatMap((candidate) =>
        'const' in candidate && typeof candidate.const === 'string' ? [candidate.const] : [],
      )
    }
    return []
  })
}

describe('Sessions tool capability schema', () => {
  it('removes operations the current Session grant does not carry', () => {
    const actions = exposedActions(
      sessionsToolSchemaForCapabilities({
        capabilities: ['sessions:read', 'delegations:contribute'],
        modelMultiAgentEnabled: true,
      }),
    )

    expect(actions).toContain('read')
    expect(actions).toContain('delegation_submit')
    expect(actions).toContain('delegation_claim')
    expect(actions).toContain('agent_definitions_search')
    expect(actions).not.toContain('spawn')
    expect(actions).not.toContain('launch')
    expect(actions).not.toContain('steer')
    expect(actions).not.toContain('delegation_accept')
    expect(actions).not.toContain('queue_list')
    expect(actions).not.toContain('export')
    expect(actions).not.toContain('export_create')
    expect(actions).not.toContain('exports_wait')
  })

  it('exposes export only with both export and transcript read capabilities', () => {
    const actions = exposedActions(
      sessionsToolSchemaForCapabilities({
        capabilities: ['sessions:read', 'sessions:export'],
        modelMultiAgentEnabled: true,
      }),
    )

    expect(actions).toContain('export')
    expect(actions).toContain('export_create')
    expect(actions).toContain('export_cancel')
    expect(actions).toContain('exports_list')
    expect(actions).toContain('exports_read')
    expect(actions).toContain('exports_wait')
  })

  it('removes model spawning without disabling unrelated Session operations', () => {
    const actions = exposedActions(
      sessionsToolSchemaForCapabilities({
        capabilities: ['sessions:create', 'sessions:start', 'sessions:spawn', 'sessions:discover'],
        modelMultiAgentEnabled: false,
      }),
    )

    expect(actions).not.toContain('spawn')
    expect(actions).not.toContain('launch')
    expect(actions).toContain('create')
    expect(actions).toContain('list')
    expect(actions).toContain('search')
  })

  it('exposes individual and descendant interruption under the same narrow capability', () => {
    const actions = exposedActions(
      sessionsToolSchemaForCapabilities({
        capabilities: ['sessions:interrupt'],
        modelMultiAgentEnabled: true,
      }),
    )

    expect(actions).toContain('interrupt')
    expect(actions).toContain('interrupt_descendants')
  })

  it('keeps response and approval actions behind separate grants', () => {
    const responder = exposedActions(
      sessionsToolSchemaForCapabilities({
        capabilities: ['sessions:read', 'sessions:respond'],
        modelMultiAgentEnabled: true,
      }),
    )
    const approver = exposedActions(
      sessionsToolSchemaForCapabilities({
        capabilities: ['sessions:read', 'sessions:approve'],
        modelMultiAgentEnabled: true,
      }),
    )

    expect(responder).toContain('requests_list')
    expect(responder).toContain('request_respond')
    expect(responder).not.toContain('approval_respond')
    expect(approver).toContain('approval_respond')
    expect(approver).not.toContain('request_respond')
  })

  it('requires the complete capability set for compound Run controls', () => {
    const partial = exposedActions(
      sessionsToolSchemaForCapabilities({
        capabilities: ['sessions:start', 'sessions:queue'],
        modelMultiAgentEnabled: true,
      }),
    )
    const complete = exposedActions(
      sessionsToolSchemaForCapabilities({
        capabilities: ['sessions:start', 'sessions:interrupt', 'sessions:queue', 'sessions:steer'],
        modelMultiAgentEnabled: true,
      }),
    )

    expect(partial).toContain('start')
    expect(partial).not.toContain('replace')
    expect(partial).not.toContain('promote')
    expect(complete).toContain('replace')
    expect(complete).toContain('promote')
  })
})
