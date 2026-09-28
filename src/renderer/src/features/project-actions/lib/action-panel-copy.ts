import type { ActionDefinition, ActionStorage } from '@shared/types/action-definitions'

/**
 * Plain-language wording for the guided action panel (ADR 0038). One label is used everywhere a
 * user sees it, so the panel, Settings and the docs never need translating between each other.
 */
export const RUN_BEHAVIOUR_COPY = {
  question: 'Does it stop on its own?',
  task: {
    title: 'Yes, it finishes by itself',
    description: 'Like tests, builds or a linter. It runs, reports and stops.',
    short: 'Stops when it finishes',
    label: 'Stops when done',
  },
  service: {
    title: 'No, it keeps running until I stop it',
    description: 'Like a dev server or a file watcher. You stop it yourself.',
    short: 'Keeps running until you stop it',
    label: 'Keeps running',
  },
} as const satisfies Record<ActionDefinition['kind'] | 'question', unknown>

export const REPEAT_CLICK_COPY = {
  question: 'If you click it while it is still running',
  reuse: {
    title: 'Show me the run that is already going',
    description: 'Recommended. Avoids two copies fighting over the same files or port.',
    short: 'Shows the run already going',
  },
  concurrent: {
    title: 'Start another copy',
    description: 'Useful for quick checks you want to compare side by side.',
    short: 'Starts another copy',
  },
} as const

export const PREVIEW_COPY = {
  question: 'Open it in the browser preview?',
  open: {
    title: 'Yes, open the preview when the server is ready',
    description: 'OpenWaggle reads the address from the output and waits until it responds.',
    short: 'Opens the browser preview when ready',
  },
  manual: {
    title: 'No, I will open it myself',
    description: 'You can still open it from the run’s output.',
    short: 'Does not open the preview',
  },
  urlLabel: 'Only if it opens the wrong address: preview URL (optional)',
} as const

type StorageCopy = Readonly<
  Record<
    ActionStorage,
    { readonly title: string; readonly description: string; readonly short: string }
  >
>

export const NEW_STORAGE_COPY = {
  question: 'Who should have this action?',
  options: {
    local: {
      title: 'Just me',
      description: 'Saved on this computer. Works in every worktree of this project.',
      short: 'Only you',
    },
    project: {
      title: 'Everyone working on this project',
      description:
        'Saved in .openwaggle/actions.json in the repository. Commit that file to share it.',
      short: 'Everyone on the project',
    },
  } satisfies StorageCopy,
} as const

/** Editing a shared definition: "Only me" means a Local definition override, not a move. */
export const SHARED_EDIT_STORAGE_COPY = {
  question: 'Who should get these changes?',
  options: {
    local: {
      title: 'Only me',
      description:
        'Keeps the shared version for everyone else. You’ll use your own version on this computer.',
      short: 'Only you get these changes',
    },
    project: {
      title: 'Everyone on the project',
      description: 'Updates the shared action in .openwaggle/actions.json. Commit it to share.',
      short: 'Everyone gets these changes',
    },
  } satisfies StorageCopy,
} as const

export const FOLDER_QUESTION = 'Which folder should it run in?'

export function folderLabel(directory: string) {
  return directory === '.' ? 'the project folder' : `the ${directory} folder`
}

export function capitalized(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

type PreparationPhase = 'setup' | 'cleanup'

export const PREPARATION_COPY = {
  setup: {
    title: 'Set up new worktrees',
    description:
      'Runs once in each new worktree before the agent’s first message, and must finish first. Anything it exports stays private to that worktree.',
    noun: 'setup',
  },
  cleanup: {
    title: 'Clean up worktrees',
    description: 'Runs before a worktree is removed, while its files are still there.',
    noun: 'cleanup',
  },
} as const satisfies Record<PreparationPhase, unknown>

export function preparationStorageCopy(phase: PreparationPhase, sharedEdit: boolean) {
  const noun = PREPARATION_COPY[phase].noun
  if (sharedEdit)
    return {
      question: 'Who should get these changes?',
      options: {
        local: {
          title: 'Only me',
          description: `Keeps the shared ${noun} for everyone else. You’ll use your own version on this computer.`,
          short: 'Only you get these changes',
        },
        project: {
          title: 'Everyone on the project',
          description: `Updates the shared ${noun} in .openwaggle/actions.json. Teammates are asked to check it before it runs for them.`,
          short: 'Everyone gets these changes',
        },
      },
    } as const
  return {
    question: `Who should have this ${noun}?`,
    options: {
      local: {
        title: 'Just me',
        description: `Saved on this computer. Runs for every new worktree of this project.`,
        short: 'Only you',
      },
      project: {
        title: 'Everyone working on this project',
        description: `Saved in .openwaggle/actions.json. Teammates are asked to check it before it runs for them.`,
        short: 'Everyone on the project',
      },
    },
  } as const
}

export const SHARED_PREPARATION_SAVE_NOTE =
  'It will be on for you. Teammates will be asked to check it before it runs for them.'
