import { app } from 'electron';
import { join } from 'node:path';

/** Everything the shop owns lives in %APPDATA%\Counter Pay. */
export const userDir = (...parts: string[]) => join(app.getPath('userData'), ...parts);

/** The built display page: bundled as an extra resource when packaged, the workspace build in development. */
export function displayPageDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'display') : join(app.getAppPath(), '..', 'display', 'dist');
}

export function rendererUrl(page: 'popup' | 'toast' | 'app'): { url: string } | { file: string } {
  const devServer = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && devServer) return { url: `${devServer}/${page}/index.html` };
  return { file: join(__dirname, '../renderer', page, 'index.html') };
}

export function preloadPath(): string {
  return join(__dirname, '../preload/index.js');
}

export function iconPath(name: 'tray.png' | 'tray-dot.png' | 'icon.png'): string {
  return app.isPackaged ? join(process.resourcesPath, 'icons', name) : join(app.getAppPath(), 'resources', 'icons', name);
}
