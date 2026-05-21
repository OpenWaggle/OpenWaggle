export function NoProjectState() {
  return (
    <div className="flex h-full items-center justify-center bg-bg">
      <div className="rounded-xl border border-border bg-bg-secondary px-6 py-5 text-center">
        <p className="text-sm font-medium text-text-primary">No project selected</p>
        <p className="mt-1 text-[13px] text-text-tertiary">
          Select a project folder to manage AGENTS.md and project skills.
        </p>
      </div>
    </div>
  )
}

export function EmptySkillsState() {
  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-3 text-[12px] text-text-tertiary">
      No skills found under `.openwaggle/skills` or `.agents/skills`.
    </div>
  )
}
