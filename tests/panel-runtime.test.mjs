import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = readFileSync(new URL('../src/background.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '');

function event() {
  const listeners = [];
  return { addListener: fn => listeners.push(fn), fire: (...args) => listeners.forEach(fn => fn(...args)) };
}

function runtime(firefox = false, modernClose = true) {
  const calls = [];
  const chrome = {
    runtime: { onConnect: event(), onInstalled: event(), onStartup: event(), onMessage: event() },
    commands: { onCommand: event() },
    webNavigation: { onHistoryStateUpdated: event(), onCommitted: event() },
    tabs: { onActivated: event() },
    sidePanel: firefox ? undefined : {
      open: async options => calls.push(['open', options]),
      close: modernClose ? async options => calls.push(['close', options]) : undefined,
      setOptions: async options => calls.push(['options', options]),
      setPanelBehavior: async () => {}
    }
  };
  const browser = firefox ? {
    sidebarAction: { open() {}, toggle: async () => calls.push(['toggle']) },
    commands: { update: async options => calls.push(['shortcut', options]) }
  } : undefined;
  vm.runInNewContext(source, {
    chrome, browser, console,
    databaseOperations: {}, registerDatabaseBridge() {},
    getSettings: async () => ({ sidePanelShortcut: 'Alt+Shift+O', popupShortcut: 'Ctrl+Shift+D' }),
    isUrlExist: async () => false
  });
  return { chrome, calls };
}

test('Chrome opens, closes, reopens and isolates browser windows', async () => {
  const { chrome, calls } = runtime();
  const press = windowId => chrome.runtime.onMessage.fire(
    { type: 'open-side-panel-shortcut' }, { tab: { id: 7, windowId } });
  press(1);
  const port = { name: 'vectormark-panel:1', onDisconnect: event() };
  chrome.runtime.onConnect.fire(port);
  press(1);
  press(2);
  port.onDisconnect.fire();
  press(1);
  assert.deepEqual(calls.map(call => call[0]), ['open', 'close', 'open', 'open']);
  assert.equal(calls[1][1].windowId, 1);
});

test('older Chrome waits for disable before re-enabling the panel', async () => {
  const { chrome, calls } = runtime(false, false);
  chrome.runtime.onConnect.fire({ name: 'vectormark-panel:1', onDisconnect: event() });
  chrome.runtime.onMessage.fire({ type: 'open-side-panel-shortcut' }, { tab: { id: 7, windowId: 1 } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].enabled, false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls[1][1].enabled, true);
});

test('Firefox toggles directly from native command and configures saved shortcut', async () => {
  const { chrome, calls } = runtime(true);
  chrome.commands.onCommand.fire('toggle-sidebar');
  assert.equal(calls[0][0], 'toggle');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls[1][1].shortcut, 'Alt+Shift+O');
  assert.equal(calls[2][1].name, '_execute_action');
  assert.equal(calls[2][1].shortcut, 'Ctrl+Shift+D');
  chrome.runtime.onInstalled.fire();
  chrome.runtime.onStartup.fire();
});

test('Firefox manifest loads background imports as modules; content script is classic', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.firefox.json', import.meta.url)));
  assert.equal(manifest.background.type, 'module');
  assert.ok(manifest.commands['toggle-sidebar']);
  new vm.Script(readFileSync(new URL('../dist/shortcutListener.js', import.meta.url), 'utf8'));
});
