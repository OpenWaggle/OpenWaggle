import { describe, expect, it } from 'vitest'
import { safeDecodeUnknown } from '@shared/schema'
import { actionManagementRequestSchema } from '../action-management'
import { usageCostSessionQuerySchema } from '../usage-cost'

function refusal(path: string) {
  return { success: false, issues: expect.arrayContaining([expect.stringContaining(path)]) }
}

// A missing key and a key set to undefined differ: these IPC requests' optional fields are exact,
// so the window leaves a key out instead of sending undefined.
describe('exact optional IPC request fields', () => {
  it('refuses an action management scope field set to undefined, naming the field', () => {
    const request = { scope: { projectPath: '/repo' }, operation: { type: 'preparation' } }
    expect(safeDecodeUnknown(actionManagementRequestSchema, request)).toMatchObject({
      success: true,
    })
    expect(
      safeDecodeUnknown(actionManagementRequestSchema, {
        ...request,
        scope: { projectPath: '/repo', sessionId: undefined },
      }),
    ).toMatchObject(refusal('scope.sessionId: '))
  })

  it('refuses a usage and cost session query field set to undefined, naming the field', () => {
    const query = { preset: '30d', origin: 'all' }
    expect(safeDecodeUnknown(usageCostSessionQuerySchema, query)).toMatchObject({ success: true })
    expect(
      safeDecodeUnknown(usageCostSessionQuerySchema, { ...query, day: undefined }),
    ).toMatchObject(refusal('day: '))
  })
})
