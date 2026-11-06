import { captureBrowserPreview } from './website-screenshot-browser-capture'
import {
  captureBrowserAnnotation,
  captureBrowserAnnotationChip,
  captureBrowserDeviceToolbar,
} from './website-screenshot-browser-device-captures'
import {
  captureComposerAgentAccessMenu,
  captureComposerNewSession,
  captureComposerPlusMenu,
  captureComposerThinkingMenu,
} from './website-screenshot-composer-captures'
import {
  captureCodingAgent,
  captureGitWorkflow,
  captureSessionTree,
} from './website-screenshot-conversation-captures'
import {
  captureApprovalRequest,
  captureCommandPalette,
  captureQueuedFollowUps,
  captureSidebarStates,
  captureSlashCommandMenu,
  captureToolRows,
  captureWorktreeFirstSend,
} from './website-screenshot-essentials-captures'
import {
  captureSettingsApiKeyProviders,
  captureSettingsConnections,
  captureSettingsOAuthProviders,
} from './website-screenshot-essentials-settings-captures'
import {
  captureActionOutputTerminal,
  captureCommitDialog,
  captureDiffReviewComment,
  captureProjectActionAdd,
  captureProjectActionsPanel,
} from './website-screenshot-essentials-workspace-captures'
import {
  captureExtensionReview,
  captureExtensionSettingsSection,
  captureExtensionSurfaces,
} from './website-screenshot-extension-captures'
import {
  captureAllPanels,
  captureCodemodeCard,
  captureCompactionMarker,
  captureMissingWorktree,
  captureSettingsAgents,
  captureSettingsPermissions,
  captureSettingsShortcuts,
  captureSettingsSkills,
} from './website-screenshot-feature-captures'
import {
  captureHiveNextActor,
  captureHiveTree,
  captureScheduledTasks,
  captureSessionResourcesBrowser,
  captureSessionSummary,
  captureSessionSummaryAddSource,
  captureSettingsWorktrees,
} from './website-screenshot-hive-captures'
import type { WebsiteScreenshot } from './website-screenshot-manifest'
import {
  captureMcpServerDetail,
  captureMcpServerError,
  captureMcpServers,
} from './website-screenshot-mcp-captures'
import {
  captureTerminalAddToChat,
  captureTerminalContextChip,
  captureTerminalSplitPanes,
} from './website-screenshot-terminal-captures'
import type { CaptureContext } from './website-screenshot-ui'
import {
  captureUsageCostPage,
  captureUsageCostSidebarButton,
} from './website-screenshot-usage-cost-captures'
import {
  captureVisualizationExpanded,
  captureVisualizationInline,
} from './website-screenshot-visualization-captures'
import { captureVisualizationChoice } from './website-screenshot-visualization-choice-captures'
import { captureVisualizationPrototype } from './website-screenshot-visualization-prototype-captures'
import {
  captureContextMeter,
  captureWaggleConversation,
  captureWaggleSettings,
} from './website-screenshot-waggle-captures'

/** Every website image and the capture that makes it; the manifest's order is the run order. */
export const CAPTURES: Readonly<
  Record<WebsiteScreenshot, (context: CaptureContext) => Promise<void>>
> = {
  'hive-sessions.png': captureHiveTree,
  'hive-next-actor.png': captureHiveNextActor,
  'session-summary.png': captureSessionSummary,
  'session-summary-add-source.png': captureSessionSummaryAddSource,
  'session-resources-browser.png': captureSessionResourcesBrowser,
  'scheduled-tasks.png': captureScheduledTasks,
  'settings-worktrees.png': captureSettingsWorktrees,
  'usage-cost-page.png': captureUsageCostPage,
  'usage-cost-sidebar-button.png': captureUsageCostSidebarButton,
  'feature-coding-agent.png': captureCodingAgent,
  'feature-git-workflow.png': captureGitWorkflow,
  'session-tree-panel.png': captureSessionTree,
  'feature-browser-preview.png': captureBrowserPreview,
  'right-panel-all-panels.png': captureAllPanels,
  'codemode-script-card.png': captureCodemodeCard,
  'context-compacted.png': captureCompactionMarker,
  'missing-worktree.png': captureMissingWorktree,
  'settings-skills.png': captureSettingsSkills,
  'settings-agents.png': captureSettingsAgents,
  'settings-permissions.png': captureSettingsPermissions,
  'settings-shortcuts.png': captureSettingsShortcuts,
  'settings-waggle-mode.png': captureWaggleSettings,
  'waggle-conversation.png': captureWaggleConversation,
  'context-meter.png': captureContextMeter,
  'terminal-split-panes.png': captureTerminalSplitPanes,
  'terminal-add-to-chat.png': captureTerminalAddToChat,
  'terminal-context-chip.png': captureTerminalContextChip,
  'mcp-servers.png': captureMcpServers,
  'mcp-server-detail.png': captureMcpServerDetail,
  'mcp-server-error.png': captureMcpServerError,
  'browser-preview-device-toolbar.png': captureBrowserDeviceToolbar,
  'browser-preview-annotation.png': captureBrowserAnnotation,
  'browser-preview-annotation-chip.png': captureBrowserAnnotationChip,
  'extensions-review.png': captureExtensionReview,
  'extensions-settings-section.png': captureExtensionSettingsSection,
  'extensions-surfaces.png': captureExtensionSurfaces,
  'composer-new-session.png': captureComposerNewSession,
  'composer-plus-menu.png': captureComposerPlusMenu,
  'composer-thinking-menu.png': captureComposerThinkingMenu,
  'composer-agent-access-menu.png': captureComposerAgentAccessMenu,
  'settings-connections.png': captureSettingsConnections,
  'settings-api-key-providers.png': captureSettingsApiKeyProviders,
  'settings-oauth-providers.png': captureSettingsOAuthProviders,
  'slash-command-menu.png': captureSlashCommandMenu,
  'command-palette.png': captureCommandPalette,
  'approval-request.png': captureApprovalRequest,
  'queued-follow-ups.png': captureQueuedFollowUps,
  'sidebar-states.png': captureSidebarStates,
  'tool-rows.png': captureToolRows,
  'diff-review-comment.png': captureDiffReviewComment,
  'commit-dialog.png': captureCommitDialog,
  'worktree-first-send.png': captureWorktreeFirstSend,
  'project-actions-panel.png': captureProjectActionsPanel,
  'project-action-add.png': captureProjectActionAdd,
  'action-output-terminal.png': captureActionOutputTerminal,
  'visualization-inline.png': captureVisualizationInline,
  'visualization-expanded.png': captureVisualizationExpanded,
  'visualization-prototype.png': captureVisualizationPrototype,
  'visualization-choice.png': captureVisualizationChoice,
}
