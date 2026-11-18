import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionLifecycleRepository } from '../../ports/session-lifecycle-repository'
import {
  makeSessionLifecycleTestLayer,
  rootLifecycleInput,
  spawnLifecycleInput,
} from './sqlite-session-lifecycle-test-support'

/**
 * A Session's MCP switch is part of what a new Session inherits from the one that made it: a
 * Worker from its parent, and a root launched by a Session's agent from that Session.
 */

let temporaryRoot = ''

/** The Sessions with MCP off after running `input` while `session-parent` has it off. */
function mcpOffAfter(input: Parameters<(typeof SessionLifecycleRepository.Service)['execute']>[0]) {
  const layer = makeSessionLifecycleTestLayer(path.join(temporaryRoot, 'mcp-switch.sqlite'))
  return Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        INSERT INTO session_mcp_disabled (session_id, disabled_at)
        VALUES (${'session-parent'}, ${1})
      `
      yield* (yield* SessionLifecycleRepository).execute(input)
      const rows = yield* sql<{ readonly session_id: string }>`
        SELECT session_id FROM session_mcp_disabled ORDER BY session_id
      `
      return rows.map((row) => row.session_id)
    }).pipe(Effect.provide(layer)),
  )
}

describe("A new Session's MCP switch", () => {
  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-lifecycle-mcp-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it("keeps a Worker's MCP off when its parent has it off", async () => {
    expect(await mcpOffAfter(spawnLifecycleInput())).toEqual(['session-parent', 'session-worker'])
  })

  it("keeps MCP off for a root a Session's agent launched from a Session with it off", async () => {
    const launch = {
      ...rootLifecycleInput('launch'),
      callerId: 'session-agent:session-parent:run-1',
    }

    expect(await mcpOffAfter(launch)).toEqual(['session-launch', 'session-parent'])
  })

  it('starts a root the user launched with MCP on', async () => {
    expect(await mcpOffAfter(rootLifecycleInput('launch'))).toEqual(['session-parent'])
  })
})
