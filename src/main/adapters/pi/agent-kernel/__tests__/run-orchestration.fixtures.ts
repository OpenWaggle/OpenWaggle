import type { HydratedAgentSendPayload } from '@shared/types/agent'
import { PRIMARY_MODEL, SECONDARY_MODEL } from './run-orchestration.test-utils'

export const WAGGLE_ATTACHMENTS = [
  {
    id: 'img-1',
    kind: 'image',
    name: 'diagram.png',
    path: '/tmp/diagram.png',
    mimeType: 'image/png',
    sizeBytes: 128,
    extractedText: 'Architecture diagram OCR',
    source: { type: 'data', value: 'base64-image', mimeType: 'image/png' },
  },
  {
    id: 'text-1',
    kind: 'text',
    name: 'notes.txt',
    path: '/tmp/notes.txt',
    mimeType: 'text/plain',
    sizeBytes: 64,
    extractedText: 'Important notes for every Waggle turn',
    source: null,
  },
] satisfies HydratedAgentSendPayload['attachments']

export const EXPECTED_WAGGLE_TURN_EVENTS = [
  { type: 'turn-start', turnNumber: 0, agentIndex: 0, agentLabel: 'Architect' },
  {
    type: 'turn-end',
    turnNumber: 0,
    agentIndex: 0,
    agentLabel: 'Architect',
    agentColor: 'blue',
    agentModel: PRIMARY_MODEL,
  },
  { type: 'turn-start', turnNumber: 1, agentIndex: 1, agentLabel: 'Reviewer' },
  {
    type: 'turn-end',
    turnNumber: 1,
    agentIndex: 1,
    agentLabel: 'Reviewer',
    agentColor: 'amber',
    agentModel: SECONDARY_MODEL,
  },
  { type: 'turn-start', turnNumber: 2, agentIndex: 0, agentLabel: 'Architect' },
  {
    type: 'turn-end',
    turnNumber: 2,
    agentIndex: 0,
    agentLabel: 'Architect',
    agentColor: 'blue',
    agentModel: PRIMARY_MODEL,
  },
  { type: 'turn-start', turnNumber: 3, agentIndex: 1, agentLabel: 'Reviewer' },
  {
    type: 'turn-end',
    turnNumber: 3,
    agentIndex: 1,
    agentLabel: 'Reviewer',
    agentColor: 'amber',
    agentModel: SECONDARY_MODEL,
  },
  {
    type: 'collaboration-complete',
    reason: 'Reached maximum turns (4)',
    totalTurns: 4,
  },
] as const
