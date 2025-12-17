/**
 * Desktop type definitions for window management.
 */

export interface WindowConfig {
  title: string;
  icon?: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  app?: string;       // for grouping in taskbar
  appName?: string;   // friendly name for taskbar button
}

export interface AppWindowConfig extends WindowConfig {
  app: string;        // e.g. "org.mycomp.chat.v1"
  appName?: string;   // friendly name, defaults to last part of app
  windowType: string; // e.g. "main", "settings", "dialog"
  src: string;
  origin: string;
}

export interface WindowState {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  maximized: boolean;
  zIndex: number;
  prevState?: { x: number; y: number; width: number; height: number };
  app?: string;
  appName?: string;
  icon?: string;
}

// Mobile breakpoint - must match CSS media queries in style.css and themes/*.css
export const MOBILE_BREAKPOINT = 768;
export const isMobileViewport = () => window.innerWidth <= MOBILE_BREAKPOINT;
