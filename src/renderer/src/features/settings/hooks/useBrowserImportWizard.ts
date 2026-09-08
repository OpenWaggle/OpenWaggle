import type {
  BrowserImportSource,
  BrowserImportTarget,
  GuidedBrowserImportResult,
} from '@shared/types/browser-import'
import { useEffect, useRef, useState } from 'react'
import {
  type BrowserImportWizardStep,
  canCloseBrowserImportWizard,
  guidedImportResultToStep,
  initialBrowserImportWizardStep,
  initialTargetSelection,
  refreshedSourceProfileDirectory,
  resolveWizardTarget,
  type WizardTargetProfile,
  type WizardTargetSelection,
} from '@/features/settings/lib/browser-import-wizard-logic'

export interface BrowserImportWizardOptions {
  readonly source: BrowserImportSource
  readonly targetProfiles: readonly WizardTargetProfile[]
  readonly canCreateProfile: boolean
  readonly onImport: (input: {
    readonly sourceProfileDirectory: string
    readonly target: BrowserImportTarget
  }) => Promise<GuidedBrowserImportResult>
  readonly onRefreshSource: () => Promise<BrowserImportSource | undefined>
  readonly onOpenFullDiskAccessSettings: () => Promise<boolean>
  readonly onClose: () => void
}

type RecheckStepResolver = (refreshed: BrowserImportSource | undefined) => BrowserImportWizardStep

export function useBrowserImportWizard(options: BrowserImportWizardOptions) {
  const [source, setSource] = useState(options.source)
  const [step, setStep] = useState<BrowserImportWizardStep>(() =>
    initialBrowserImportWizardStep(options.source),
  )
  const [sourceProfileDirectory, setSourceProfileDirectory] = useState(
    () => options.source.profiles[0]?.directory ?? '',
  )
  const [target, setTarget] = useState<WizardTargetSelection>(() =>
    initialTargetSelection(options.canCreateProfile, options.targetProfiles),
  )
  const [targetError, setTargetError] = useState<string>()
  const [settingsError, setSettingsError] = useState<string>()
  const [openingSettings, setOpeningSettings] = useState(false)
  const newProfileId = useRef(`profile-${crypto.randomUUID()}`)
  const importInFlight = useRef(false)
  const checkInFlight = useRef(false)
  const settingsInFlight = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  function runImport() {
    if (importInFlight.current) return
    const chosen = resolveWizardTarget(target, newProfileId.current, options.targetProfiles)
    if (!chosen) {
      setTargetError('That profile is no longer available. Choose where to import these cookies.')
      setStep({ step: 'configure' })
      return
    }
    if (!source.profiles.some((profile) => profile.directory === sourceProfileDirectory)) {
      setStep({ step: 'blocked', reason: 'unknown-source-profile' })
      return
    }
    setTargetError(undefined)
    importInFlight.current = true
    setStep({ step: 'importing' })
    void options
      .onImport({ sourceProfileDirectory, target: chosen })
      .then((outcome) => {
        if (mounted.current) setStep(guidedImportResultToStep(outcome))
      })
      .catch(() => {
        if (mounted.current) setStep({ step: 'blocked', reason: 'read-failed' })
      })
      .finally(() => {
        importInFlight.current = false
      })
  }

  function recheckSource(check: 'browser' | 'full-disk-access', resolveStep: RecheckStepResolver) {
    if (checkInFlight.current) return
    checkInFlight.current = true
    setStep({ step: 'checking', check })
    void options
      .onRefreshSource()
      .then((refreshed) => {
        if (!mounted.current) return
        if (refreshed) {
          setSource(refreshed)
          setSourceProfileDirectory((current) =>
            refreshedSourceProfileDirectory(current, refreshed),
          )
        }
        setStep(resolveStep(refreshed))
      })
      .catch(() => {
        if (mounted.current) setStep({ step: 'blocked', reason: 'read-failed' })
      })
      .finally(() => {
        checkInFlight.current = false
      })
  }

  function openFullDiskAccessSettings() {
    if (settingsInFlight.current) return
    settingsInFlight.current = true
    setOpeningSettings(true)
    setSettingsError(undefined)
    void options
      .onOpenFullDiskAccessSettings()
      .then((opened) => {
        if (mounted.current && !opened) {
          setSettingsError('Open Privacy & Security, then Full Disk Access, manually.')
        }
      })
      .catch(() => {
        if (mounted.current) {
          setSettingsError('Open Privacy & Security, then Full Disk Access, manually.')
        }
      })
      .finally(() => {
        settingsInFlight.current = false
        if (mounted.current) setOpeningSettings(false)
      })
  }

  function selectTarget(selection: WizardTargetSelection) {
    setTarget(selection)
    setTargetError(undefined)
  }

  function requestClose() {
    if (canCloseBrowserImportWizard(step)) options.onClose()
  }

  return {
    ...options,
    openingSettings,
    settingsError,
    source,
    sourceProfileDirectory,
    step,
    target,
    targetError,
    clearSettingsError: () => setSettingsError(undefined),
    openFullDiskAccessSettings,
    recheckSource,
    requestClose,
    runImport,
    selectTarget,
    setSourceProfileDirectory,
    setStep,
  }
}

export type BrowserImportWizardController = ReturnType<typeof useBrowserImportWizard>
