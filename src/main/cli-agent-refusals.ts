// What an agent Run is told when a CLI command refuses it the user's own authority.

/**
 * What an agent Run is told when it reaches for `openwaggle schedules` with the user's authority.
 * Its hive tool has the schedule actions when its Session holds the capabilities, and its help
 * says why when it does not, so the refusal points there rather than at a path that may be empty.
 */
export const SCHEDULES_CLI_AGENT_REFUSAL =
  'OpenWaggle agents cannot run openwaggle schedules with the user\'s own access. Use the schedule_* actions of your hive tool; if hive({ action: "help" }) lists none, its "Not available to this Session" section says why. Otherwise ask the user to set the task up, or pass --profile with an access profile that has schedules:read or schedules:manage.'

/** A wake check waits for the user's own approval; an agent Run never gives it for them. */
export const WAKE_CHECK_APPROVAL_AGENT_REFUSAL =
  'OpenWaggle agents cannot approve a wake check. Ask the user to approve it in the Scheduled panel or with openwaggle schedules approve-wake-check.'

/** What an agent Run is told when it runs `openwaggle status` with the user's authority. */
export const STATUS_CLI_AGENT_REFUSAL =
  "OpenWaggle agents cannot run openwaggle status with the user's own access. Use the list and status actions of your hive tool for Sessions, and schedule_list for Scheduled tasks when it offers it, or pass --profile with an access profile."
