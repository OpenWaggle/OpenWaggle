import * as Effect from 'effect/Effect'
import {
  acknowledgeFirstLaunchLocalStorageImport,
  continueElectronSecretsMigration,
  electronMigrationNotice,
  skipElectronSecretsMigration,
} from '../electron-migration/first-launch'
import { typedHandle, typedOn } from './typed-ipc'

/** The first-launch migration's notice and the preload's `localStorage` acknowledgement. */
export function registerElectronMigrationHandlers() {
  typedHandle('electron-migration:get-notice', () =>
    Effect.promise(() => electronMigrationNotice()),
  )
  typedHandle('electron-migration:continue-secrets', () =>
    Effect.promise(() => continueElectronSecretsMigration()),
  )
  typedHandle('electron-migration:skip-secrets', () =>
    Effect.promise(() => skipElectronSecretsMigration()),
  )
  typedOn('electron-migration:local-storage-applied', (_event, importId) =>
    Effect.promise(() => acknowledgeFirstLaunchLocalStorageImport(importId)),
  )
}
