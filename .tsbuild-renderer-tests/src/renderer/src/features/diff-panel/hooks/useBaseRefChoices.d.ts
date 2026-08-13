import { type BaseRefChoice } from '@/features/diff-panel/lib/base-ref-choices';
/** Load the repository's branches and shape them into base-ref combobox choices (WS6b). */
export declare function useBaseRefChoices(projectPath: string | null): readonly BaseRefChoice[];
