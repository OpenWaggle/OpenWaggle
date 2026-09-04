import { shouldVirtualizeSyntaxSource } from '@shared/syntax-highlighting-performance'
import type { WorkspaceTextFileReadResult } from '@shared/types/workspace-files'
import { type SetStateAction, useEffect, useState } from 'react'
import { useSyntaxThemeCatalogStore } from '@/features/settings'
import { languageFromPath, resolveSyntaxLanguage } from '@/shared/lib/syntax/language-registry'
import {
  setWorkspaceLanguageAssociation,
  setWorkspaceLanguagePatternAssociation,
  workspaceLanguageAssociation,
} from '../lib/workspace-language-associations'
import { useWorkspaceFileSaveQueue } from './useWorkspaceFileSaveQueue'
import type { SaveStatus } from './workspace-save-queue'

const WRAP_STORAGE_KEY = 'openwaggle:file-editor-word-wrap'

export type { SaveStatus }

export function useWorkspaceFileEditing({
  projectPath,
  file,
  targetLine,
}: {
  readonly projectPath: string
  readonly file: WorkspaceTextFileReadResult
  readonly targetLine: number | null
}) {
  const registeredLanguages = useSyntaxThemeCatalogStore((state) => state.languages)
  const loadSyntaxResources = useSyntaxThemeCatalogStore((state) => state.load)
  const queue = useWorkspaceFileSaveQueue(projectPath, file)
  const [preview, setPreview] = useState(
    file.previewKind === 'markdown' &&
      targetLine === null &&
      !shouldVirtualizeSyntaxSource(file.content),
  )
  const [wordWrap, setWordWrap] = useState(
    () => window.localStorage.getItem(WRAP_STORAGE_KEY) !== 'false',
  )
  const [language, setLanguage] = useState(() =>
    resolveSyntaxLanguage(
      workspaceLanguageAssociation(window.localStorage, projectPath, file.path) ??
        file.language ??
        languageFromPath(file.path),
    ),
  )

  useEffect(() => {
    void loadSyntaxResources(projectPath)
  }, [loadSyntaxResources, projectPath])

  function selectLanguage(nextLanguage: string) {
    const resolved = resolveSyntaxLanguage(nextLanguage)
    setLanguage(resolved)
    setWorkspaceLanguageAssociation(window.localStorage, projectPath, file.path, resolved)
  }

  function associateLanguagePattern() {
    setWorkspaceLanguagePatternAssociation(window.localStorage, projectPath, file.path, language)
  }

  useEffect(() => {
    const associated = workspaceLanguageAssociation(window.localStorage, projectPath, file.path)
    if (associated) {
      setLanguage(resolveSyntaxLanguage(associated, registeredLanguages))
      return
    }
    setLanguage(
      resolveSyntaxLanguage(
        file.language ?? languageFromPath(file.path, registeredLanguages),
        registeredLanguages,
      ),
    )
  }, [file.language, file.path, projectPath, registeredLanguages])

  function toggleWordWrap() {
    const next = !wordWrap
    setWordWrap(next)
    window.localStorage.setItem(WRAP_STORAGE_KEY, String(next))
  }

  function updatePreview(action: SetStateAction<boolean>) {
    const next = typeof action === 'function' ? action(preview) : action
    if (next) queue.captureSnapshot()
    setPreview(next)
  }

  return {
    ...queue,
    language,
    setLanguage: selectLanguage,
    associateLanguagePattern,
    canPreview: file.previewKind === 'markdown' || file.previewKind === 'html',
    preview,
    setPreview: updatePreview,
    toggleWordWrap,
    wordWrap,
  }
}
