import { DEFAULT_SYNTAX_THEME_SELECTIONS, type SyntaxThemeSelections } from '@shared/types/syntax'
import type { SyntaxThemeResource } from '@shared/types/syntax-resources'
import { create } from 'zustand'

interface SyntaxThemeRuntimeState {
  readonly selections: SyntaxThemeSelections
  readonly resources: readonly SyntaxThemeResource[]
}

export const useSyntaxThemeRuntimeStore = create<SyntaxThemeRuntimeState>(() => ({
  selections: DEFAULT_SYNTAX_THEME_SELECTIONS,
  resources: [],
}))

export function setRuntimeSyntaxThemeSelections(selections: SyntaxThemeSelections) {
  useSyntaxThemeRuntimeStore.setState({ selections })
}

export function setRuntimeSyntaxThemeResources(resources: readonly SyntaxThemeResource[]) {
  useSyntaxThemeRuntimeStore.setState({ resources })
}
