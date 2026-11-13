import { BrowserWindow, type WindowOptionsType } from "./core/BrowserWindow";
import { BrowserView, type BrowserViewCreatedHandler, type BrowserViewOptions } from "./core/BrowserView";
import { GpuWindow, type GpuWindowOptionsType } from "./core/GpuWindow";
import { WGPUView, type WGPUViewOptions } from "./core/WGPUView";
import { Tray, type TrayOptions } from "./core/Tray";
import * as ApplicationMenu from "./core/ApplicationMenu";
import * as ContextMenu from "./core/ContextMenu";
import { Updater, type UpdateStatusType, type UpdateStatusEntry, type UpdateStatusDetails } from "./core/Updater";
import * as Utils from "./core/Utils";
import type { MessageBoxOptions, MessageBoxResponse, NotificationOptions } from "./core/Utils";
import { type RPCSchema, type RPCRequestOptions, type ElectrobunRPCSchema, createRPC, defineElectrobunRPC } from "../../shared/rpc.js";
import type ElectrobunEvent from "./events/event";
import * as PATHS from "./core/Paths";
import * as Socket from "./core/Socket";
import WGPU from "./webGPU";
import webgpu from "./webgpuAdapter";
import type { ElectrobunConfig } from "../../config/ElectrobunConfig";
import type { WindowsWebView2Permission } from "../../config/windowsPermissions";
import { GlobalShortcut, Screen, Session, WGPUBridge } from "./proc/native";
import type { Display, Rectangle, Point, Cookie, CookieFilter, StorageType, MenuItemConfig, ApplicationMenuItemConfig } from "./proc/native";
import { BuildConfig, type BuildConfigType } from "./core/BuildConfig";
export declare const Carrots: {
    invoke<T = unknown>(carrotId: string, method: string, params?: unknown, options?: {
        windowId?: string;
    }): Promise<T>;
    emit(carrotId: string, name: string, payload?: unknown): void;
    list(): Promise<{
        id: string;
        name: string;
        description: string;
        version: string;
        mode: string;
        status: string;
        devMode: boolean;
        remoteUIs?: Array<{
            id: string;
            name: string;
            path: string;
        }>;
        slateUIs?: Array<{
            id: string;
            name: string;
            path: string;
        }>;
        contributions?: {
            fileActivators?: Array<{
                baseName?: string;
                nodeType?: "file" | "dir" | "any";
                slate: {
                    type: string;
                    name?: string;
                    icon?: string;
                    config?: import("../../json").ElectrobunJsonObject;
                };
            }>;
        };
    }[]>;
    start(carrotId: string): Promise<{
        ok: boolean;
    }>;
    stop(carrotId: string): Promise<{
        ok: boolean;
    }>;
};
export declare const app: {
    on(name: string, handler: (payload: unknown) => void): () => void;
    quit(): void;
    readonly isPackaged: boolean;
    readonly isCarrotMode: boolean;
    readonly manifest: import("../../json").ElectrobunJsonObject | null;
    readonly currentDir: string;
    readonly statePath: string;
    readonly logsPath: string;
    readonly authToken: string | null;
    fetchAuthToken(): Promise<string | null>;
    setAuthToken(token: string): Promise<void>;
    setDeviceToken(token: string, tokenId?: string): Promise<void>;
    getMachineInfo(): Promise<{
        machineId: string;
        hostname: string;
        platform: string;
    }>;
    updateCarrots(): Promise<void>;
    getWebBridgePort(): Promise<number | null>;
    readonly channel: string;
    openManager(): void;
    openBunnyWindow(payload?: {
        screenX?: number;
        screenY?: number;
    }): void;
    getWindowFrame(windowId?: string): Promise<{
        x: number;
        y: number;
        width: number;
        height: number;
    } | null>;
};
export { type RPCSchema, type RPCRequestOptions, type ElectrobunRPCSchema, type ElectrobunEvent, type ElectrobunConfig, type WindowsWebView2Permission, type BuildConfigType, type WindowOptionsType, type BrowserViewOptions, type BrowserViewCreatedHandler, type GpuWindowOptionsType, type WGPUViewOptions, type TrayOptions, type MessageBoxOptions, type MessageBoxResponse, type NotificationOptions, type MenuItemConfig, type ApplicationMenuItemConfig, type Display, type Rectangle, type Point, type Cookie, type CookieFilter, type StorageType, type UpdateStatusType, type UpdateStatusEntry, type UpdateStatusDetails, createRPC, defineElectrobunRPC, BrowserWindow, BrowserView, GpuWindow, WGPUView, Tray, Updater, Utils, ApplicationMenu, ContextMenu, PATHS, Socket, WGPU, webgpu, GlobalShortcut, Screen, Session, WGPUBridge, BuildConfig, };
