import { type ApplicationMenuItemConfig } from "../proc/native";
export declare const showContextMenu: (menu: Array<ApplicationMenuItemConfig>) => void;
export declare const on: (name: "context-menu-clicked", handler: (event: unknown) => void) => void;
