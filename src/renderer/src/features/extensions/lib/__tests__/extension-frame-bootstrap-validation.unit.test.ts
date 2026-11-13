import { EXTENSION_FRAME_MESSAGE_CHANNEL } from '@shared/constants/extension-frame'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { createOpenWaggleExtensionTheme } from '@shared/extension-theme'
import type { ExtensionFrameConfig } from '@shared/types/extension-frame'
import { describe, expect, it } from 'vitest'
import { decodedParentMessage } from '../extension-frame-bootstrap-validation'

const CONFIG = {
  moduleUrl: 'openwaggle-extension://runtime/module/sample/dist/settings.js',
  context: {
    extension: {
      id: 'sample-extension',
      name: 'Sample Extension',
      version: '1.0.0',
    },
    contribution: {
      id: 'sample.settings',
      title: 'Sample settings',
      family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SETTINGS_SECTIONS,
    },
    surface: {
      family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SETTINGS_SECTIONS,
      execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.FRAME,
    },
    packagePath: '/tmp/project/.openwaggle/extensions/sample-extension',
    projectPaths: ['/tmp/project'],
    theme: createOpenWaggleExtensionTheme(),
  },
} satisfies ExtensionFrameConfig

describe('extension frame bootstrap validation', () => {
  it('accepts configure messages with the shared theme token payload', () => {
    expect(
      decodedParentMessage(
        {
          channel: EXTENSION_FRAME_MESSAGE_CHANNEL,
          frameId: 'frame-1',
          type: 'configure',
          config: CONFIG,
        },
        'frame-1',
      ),
    ).toEqual({ type: 'configure', config: CONFIG })
  })

  // Regression: the mount context schema once left out `sessionId`, so the decode stripped it and
  // every frame-mounted extension saw `context.sessionId === undefined`.
  it('keeps the Session id and surface payload of a configure message', () => {
    const config = {
      ...CONFIG,
      context: {
        ...CONFIG.context,
        surface: { ...CONFIG.context.surface, payload: { draft: 'hello', count: 2 } },
        sessionId: 'session-1',
      },
    } satisfies ExtensionFrameConfig

    const message = decodedParentMessage(
      { channel: EXTENSION_FRAME_MESSAGE_CHANNEL, frameId: 'frame-1', type: 'configure', config },
      'frame-1',
    )

    expect(message).toEqual({ type: 'configure', config })
  })

  it('rejects legacy configure messages that only send a theme scheme', () => {
    const legacyConfig = {
      ...CONFIG,
      context: {
        ...CONFIG.context,
        theme: { colorScheme: 'dark' },
      },
    }

    expect(
      decodedParentMessage(
        {
          channel: EXTENSION_FRAME_MESSAGE_CHANNEL,
          frameId: 'frame-1',
          type: 'configure',
          config: legacyConfig,
        },
        'frame-1',
      ),
    ).toBeNull()
  })

  it('accepts complete syntax results and marks malformed tokens invalid', () => {
    const valid = {
      channel: EXTENSION_FRAME_MESSAGE_CHANNEL,
      frameId: 'frame-1',
      type: 'syntax-highlight-result',
      requestId: 'syntax-1',
      result: {
        status: 'highlighted',
        language: 'typescript',
        lines: [[{ content: 'const', color: 'var(--color-text-primary)', fontStyle: 2 }]],
      },
    }
    expect(decodedParentMessage(valid, 'frame-1')).toMatchObject({
      type: 'syntax-highlight-result',
      requestId: 'syntax-1',
    })
    expect(
      decodedParentMessage(
        {
          ...valid,
          result: { ...valid.result, lines: [[{ content: 42 }]] },
        },
        'frame-1',
      ),
    ).toEqual({
      type: 'invalid-result',
      resultType: 'syntax-highlight-result',
      requestId: 'syntax-1',
      issuePaths: ['lines.0.0.content: Type'],
    })
  })

  // The parent message is decoded with the broker's invoke result schema; the earlier guard took
  // any string as an audit outcome and any object as a success value.
  it('accepts a broker invoke result and marks one the broker schema does not declare invalid', () => {
    const audit = {
      extensionId: 'sample-extension',
      contributionId: 'sample.settings',
      capability: 'openwaggle.storage',
      method: 'list',
      scope: { kind: 'app' },
      outcome: 'succeeded',
      timestamp: 1,
    }
    const message = {
      channel: EXTENSION_FRAME_MESSAGE_CHANNEL,
      frameId: 'frame-1',
      type: 'invoke-result',
      requestId: 'invoke-1',
      result: {
        ok: true,
        value: {
          extensionId: 'sample-extension',
          contributionId: 'sample.settings',
          capability: 'openwaggle.storage',
          method: 'list',
          storageKind: 'state',
          storageScope: { kind: 'global' },
          keys: ['draft'],
        },
        audit,
      },
    }
    expect(decodedParentMessage(message, 'frame-1')).toMatchObject({ requestId: 'invoke-1' })
    expect(decodedParentMessage(message, 'frame-2')).toBeNull()
    expect(
      decodedParentMessage(
        { ...message, result: { ...message.result, audit: { ...audit, outcome: 'maybe' } } },
        'frame-1',
      ),
    ).toMatchObject({ type: 'invalid-result', resultType: 'invoke-result', requestId: 'invoke-1' })
  })
})
