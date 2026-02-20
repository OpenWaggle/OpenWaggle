import type { DevtoolsEventBusConfig } from '@shared/types/devtools'
import { ipcMain } from 'electron'
import { getDevtoolsEventBusConfig } from '../devtools/event-bus'

export function registerDevtoolsHandlers(): void {
  ipcMain.handle(
    'devtools:get-event-bus-config',
    (): DevtoolsEventBusConfig => getDevtoolsEventBusConfig(),
  )
}
