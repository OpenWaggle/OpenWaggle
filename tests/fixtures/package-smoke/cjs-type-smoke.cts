import { Button } from '@openwaggle/extension-react'
import { defineExtensionManifest } from '@openwaggle/extension-sdk'
import { PI_WAGGLE_TURN_CUSTOM_TYPE } from '@openwaggle/pi-waggle'
import { WAGGLE_INHERIT_MODEL } from '@openwaggle/waggle-core'

const button: typeof Button = Button
const defineManifest: typeof defineExtensionManifest = defineExtensionManifest
const turnType: typeof PI_WAGGLE_TURN_CUSTOM_TYPE = PI_WAGGLE_TURN_CUSTOM_TYPE
const inheritedModel: typeof WAGGLE_INHERIT_MODEL = WAGGLE_INHERIT_MODEL

void button
void defineManifest
void turnType
void inheritedModel
