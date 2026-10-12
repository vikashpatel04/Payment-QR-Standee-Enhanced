import { app } from 'electron';
import { join } from 'node:path';
import { Agent } from './agent';
import { loadPlatform } from './platform';
import { selfTest } from './self-test';

if (process.argv.includes('--self-test')) {
  // Diagnostics only: no windows, shortcuts, servers or login item, and throwaway data.
  app.setPath('userData', join(app.getPath('temp'), 'counter-pay-self-test'));
  void app.whenReady().then(async () => {
    const report = await selfTest();
    process.stdout.write(`${JSON.stringify(report)}\n`);
    app.exit(report.ok ? 0 : 1);
  });
} else {
  startAgent();
}

function startAgent(): void {
  // A development build keeps its settings and History apart from the installed app.
  if (!app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'Counter Pay Dev'));

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  let agent: Agent | null = null;

  app.setAppUserModelId('org.counterpay.app');
  app.on('second-instance', () => agent?.openMainWindow());
  // The agent lives in the tray: closing every window must not quit it.
  app.on('window-all-closed', () => {});
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });

  let stopping = false;
  app.on('before-quit', (event) => {
    if (stopping || !agent) return;
    event.preventDefault();
    stopping = true;
    void agent.stop().finally(() => app.quit());
  });

  void app.whenReady().then(async () => {
    const platform = await loadPlatform();
    agent = new Agent(platform);
    // --updated: relaunched by the installer after a quiet-hours update; stay in the tray.
    await agent.start({ hidden: process.argv.includes('--hidden') || process.argv.includes('--updated') });
  });
}
