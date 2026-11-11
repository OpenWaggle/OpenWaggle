export interface WindowsUpdateTaskCommand {
    executable: string;
    args: string[];
}
export interface WindowsUpdateTaskPlan {
    create: WindowsUpdateTaskCommand;
    configure: WindowsUpdateTaskCommand;
    run: WindowsUpdateTaskCommand;
    deleteTask: WindowsUpdateTaskCommand;
}
export type WindowsUpdateTaskCommandExecutor = (command: WindowsUpdateTaskCommand) => void;
export declare function createWindowsUpdateTaskName(transactionId: string): string;
/** Register the copied native manager itself as the scheduled task action. */
export declare function createWindowsUpdateTaskPlan(taskName: string, helperPath: string, planPath: string): WindowsUpdateTaskPlan;
/** Configure and start a scheduled update task as one cleanup-aware action. */
export declare function executeWindowsUpdateTaskPlan(plan: WindowsUpdateTaskPlan, execute: WindowsUpdateTaskCommandExecutor): void;
