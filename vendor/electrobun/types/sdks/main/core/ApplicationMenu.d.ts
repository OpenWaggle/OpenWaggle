import { type ApplicationMenuItemConfig } from "../proc/native";
export declare const setApplicationMenu: (menu: Array<ApplicationMenuItemConfig>) => void;
export declare const on: (name: "application-menu-clicked", handler: (event: unknown) => void) => void;
