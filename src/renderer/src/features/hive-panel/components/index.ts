export function loadHivePanel() {
  return import('./HivePanel').then((module) => ({
    default: module.HivePanel,
  }))
}

export { HivePanel, type HivePanelProps } from './HivePanel'
