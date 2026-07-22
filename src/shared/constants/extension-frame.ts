export const EXTENSION_FRAME_MESSAGE_CHANNEL = 'openwaggle-extension-frame'

export const OPENWAGGLE_EXTENSION_FRAME_PROTOCOL = {
  SCHEME: 'openwaggle-extension-frame',
  HOST: 'frame',
  FRAME_PATH_PREFIX: '/frames',
  DOCUMENT_PATH: 'index.html',
  STYLE_PATH: 'frame.css',
  BOOTSTRAP_PATH: 'bootstrap.js',
} as const

export const OPENWAGGLE_EXTENSION_FRAME_ROOT_ID = 'openwaggle-extension-root'

export const EXTENSION_FRAME_SURFACE_ACTION = {
  CUSTOM_INTERACTION_RESPONSE: 'custom-interaction-response',
} as const
