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
})
