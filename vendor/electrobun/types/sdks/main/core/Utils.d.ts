import { type SupportedOS } from "../../../shared/platform";
export declare const moveToTrash: (path: string) => boolean;
export declare const showItemInFolder: (path: string) => void;
/**
 * Open a URL in the default browser or appropriate application.
 * Works with http/https URLs, mailto: links, custom URL schemes, etc.
 *
 * @param url - The URL to open (e.g., "https://example.com", "mailto:test@example.com")
 * @returns true if the URL was opened successfully, false otherwise
 *
 * @example
 * // Open a website
 * openExternal("https://example.com");
 *
 * // Open an email
 * openExternal("mailto:support@example.com?subject=Help");
 *
 * // Open a custom URL scheme
 * openExternal("slack://open");
 */
export declare const openExternal: (url: string) => boolean;
/**
 * Open a file or folder with the default application.
 * For files, opens with the associated application (e.g., .pdf with PDF reader).
 * For folders, opens in the file manager.
 *
 * @param path - The absolute path to the file or folder
 * @returns true if the path was opened successfully, false otherwise
 *
 * @example
 * // Open a document with default app
 * openPath("/Users/me/Documents/report.pdf");
 *
 * // Open a folder in file manager
 * openPath("/Users/me/Downloads");
 */
export declare const openPath: (path: string) => boolean;
export declare const setDockIconVisible: (visible: boolean) => void;
export declare const isDockIconVisible: () => boolean;
export type NotificationOptions = {
    /**
     * The title of the notification (required)
     */
    title: string;
    /**
     * The main body text of the notification
     */
    body?: string;
    /**
     * A subtitle displayed below the title (macOS only, shown as additional line on other platforms)
     */
    subtitle?: string;
    /**
     * If true, the notification will not play a sound
     */
    silent?: boolean;
};
/**
 * Show a native desktop notification.
 *
 * @param options - Notification options
 * @param options.title - The title of the notification (required)
 * @param options.body - The main body text
 * @param options.subtitle - A subtitle (macOS shows this between title and body)
 * @param options.silent - If true, no sound will be played
 *
 * @example
 * // Simple notification
 * showNotification({ title: "Download Complete" });
 *
 * // Notification with body
 * showNotification({
 *   title: "New Message",
 *   body: "You have a new message from John"
 * });
 *
 * // Full notification
 * showNotification({
 *   title: "Reminder",
 *   subtitle: "Calendar Event",
 *   body: "Team meeting in 15 minutes",
 *   silent: false
 * });
 *
 * // Silent notification
 * showNotification({
 *   title: "Sync Complete",
 *   body: "All files have been synchronized",
 *   silent: true
 * });
 */
export declare const showNotification: (options: NotificationOptions) => void;
declare const quitApprovalBrand: unique symbol;
export interface QuitApproval {
    readonly [quitApprovalBrand]: true;
}
/** Ask before-quit handlers once, without starting native shutdown yet. */
export declare const requestQuitApproval: () => QuitApproval | null;
/** Release a reserved approval when arming a post-exit action fails. */
export declare const cancelQuitApproval: (approval: QuitApproval) => void;
/** Begin shutdown using a previously-approved request without a second veto. */
export declare const quitAfterApproval: (approval: QuitApproval, code?: number) => void;
export declare const quit: (code?: number) => boolean;
export declare const openFileDialog: (opts?: {
    startingFolder?: string;
    allowedFileTypes?: string;
    canChooseFiles?: boolean;
    canChooseDirectory?: boolean;
    allowsMultipleSelection?: boolean;
}) => Promise<string[]>;
export type MessageBoxOptions = {
    type?: "info" | "warning" | "error" | "question";
    title?: string;
    message?: string;
    detail?: string;
    buttons?: string[];
    defaultId?: number;
    cancelId?: number;
};
export type MessageBoxResponse = {
    response: number;
};
/**
 * Shows a message box dialog and returns which button was clicked.
 * Similar to Electron's dialog.showMessageBox()
 *
 * @param opts - Options for the message box
 * @param opts.type - The type of dialog: "info", "warning", "error", or "question"
 * @param opts.title - The title of the dialog window
 * @param opts.message - The main message to display
 * @param opts.detail - Additional detail text (displayed smaller on some platforms)
 * @param opts.buttons - Array of button labels (e.g., ["OK", "Cancel"])
 * @param opts.defaultId - Index of the default button (focused on open)
 * @param opts.cancelId - Index of the button to trigger on Escape key or dialog close
 * @returns Promise resolving to an object with `response` (0-based button index clicked)
 *
 * @example
 * const { response } = await showMessageBox({
 *   type: "question",
 *   title: "Confirm",
 *   message: "Are you sure you want to delete this file?",
 *   buttons: ["Delete", "Cancel"],
 *   defaultId: 1,
 *   cancelId: 1
 * });
 * if (response === 0) {
 *   // User clicked Delete
 * }
 */
export declare const showMessageBox: (opts?: MessageBoxOptions) => Promise<MessageBoxResponse>;
/**
 * Read text from the system clipboard.
 * @returns The clipboard text, or null if no text is available
 */
export declare const clipboardReadText: () => string | null;
/**
 * Write text to the system clipboard.
 * @param text - The text to write to the clipboard
 */
export declare const clipboardWriteText: (text: string) => void;
export declare const screenCapture: {
    /** Whether the app currently has Screen Recording permission. */
    hasAccess(): boolean;
    /**
     * Ask macOS for Screen Recording permission. Shows the system prompt the
     * first time; afterwards the user must grant it in System Settings →
     * Privacy & Security → Screen Recording (and relaunch the app).
     */
    requestAccess(): boolean;
    /** Open the Screen Recording pane of System Settings (macOS). */
    openSettings(): void;
};
/**
 * Read image from the system clipboard as PNG data.
 * @returns PNG image data as Uint8Array, or null if no image is available
 */
export declare const clipboardReadImage: () => Uint8Array | null;
/**
 * Write PNG image data to the system clipboard.
 * @param pngData - PNG image data as Uint8Array
 */
export declare const clipboardWriteImage: (pngData: Uint8Array) => void;
/**
 * Clear the system clipboard.
 */
export declare const clipboardClear: () => void;
/**
 * Get the available formats in the clipboard.
 * @returns Array of format names (e.g., ["text", "image", "files", "html"])
 */
export declare const clipboardAvailableFormats: () => string[];
interface RuntimeVersionInfo {
    identifier: string;
    channel: string;
    version?: string;
    hash?: string;
    name?: string;
    displayName?: string;
}
/** Resolve the physical v1/v2 root leaf used by app-scoped data paths. */
export declare function resolveInstalledRootNameForPaths(info: RuntimeVersionInfo, platform: SupportedOS, executablePath: string, appDataRoot: string, regularFileProbe?: (path: string) => boolean): string;
export declare const paths: {
    readonly home: string;
    readonly appData: string;
    readonly config: string;
    readonly cache: string;
    readonly temp: string;
    readonly logs: string;
    readonly documents: string;
    readonly downloads: string;
    readonly desktop: string;
    readonly pictures: string;
    readonly music: string;
    readonly videos: string;
    readonly userData: string;
    readonly userCache: string;
    readonly userLogs: string;
};
export {};
