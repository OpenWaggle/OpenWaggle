import type { ElectronMigrationNotice } from './electron-migration'

/** The notice about what the first launch after the Electron build could not move. */
export interface OpenWaggleElectronMigrationApi {
  getElectronMigrationNotice(): Promise<ElectronMigrationNotice | null>
  continueElectronSecretsMigration(): Promise<ElectronMigrationNotice | null>
  skipElectronSecretsMigration(): Promise<ElectronMigrationNotice | null>
}
