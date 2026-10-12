import { app } from 'electron';
import { join } from 'node:path';
import { Agent } from './agent';
import { loadPlatform } from './platform';

// A development build keeps its settings and History apart from the installed app.
if (!app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'Counter Pay Dev'));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
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
    await agent.start({ hidden: process.argv.includes('--hidden') });
  });
}
