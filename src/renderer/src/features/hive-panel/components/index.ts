export function loadHivePanel() {
  return import('./HivePanel').then((module) => ({
    default: module.HivePanel,
  }))
}

export type { HivePanelProps } from './HivePanel'
