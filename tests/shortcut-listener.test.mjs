import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

const source = readFileSync(new URL('../src/content/shortcut-listener.ts', import.meta.url), 'utf8');
const script = ts.transpileModule(source, {}).outputText;

function setup(settings = {}, native = false) {
  let keydown, changed;
  const messages = [];
  vm.runInNewContext(script, {
    window: { location: { href: 'https://example.com' }, addEventListener: (_, fn) => { keydown = fn; } },
    document: { title: 'Example', querySelector: () => null },
    chrome: {
      runtime: {
        getManifest: () => ({ commands: native ? { '_execute_action': {}, 'toggle-sidebar': {} } : {} }),
        sendMessage: message => messages.push(message)
      },
      storage: {
        local: { get: (_, fn) => fn({ vectormarkSettings: settings }) },
        onChanged: { addListener: fn => { changed = fn; } }
      }
    }
  });
  return {
    messages,
    press(key, modifiers = {}) {
      keydown({ key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false,
        repeat: false, preventDefault() {}, ...modifiers });
    },
    update(value) { changed({ vectormarkSettings: { newValue: value } }, 'local'); }
  };
}

test('old settings retain default popup shortcut', () => {
  const page = setup();
  page.press('D', { ctrlKey: true, shiftKey: true });
  assert.equal(page.messages[0].type, 'open-popup-shortcut');
});

test('popup shortcut updates live and stops matching the old combination', () => {
  const page = setup();
  page.update({ popupShortcut: 'Alt+Shift+D', sidePanelShortcut: 'Alt+Shift+O' });
  page.press('D', { ctrlKey: true, shiftKey: true });
  assert.equal(page.messages.length, 0);
  page.press('D', { altKey: true, shiftKey: true });
  assert.equal(page.messages[0].type, 'open-popup-shortcut');
  page.press('D', { ctrlKey: true, altKey: true, shiftKey: true });
  assert.equal(page.messages.length, 1);
});

test('space combinations match and Firefox native commands are not duplicated', () => {
  const page = setup({ popupShortcut: 'Ctrl+Space' });
  page.press(' ', { ctrlKey: true });
  assert.equal(page.messages[0].type, 'open-popup-shortcut');
  const firefox = setup({}, true);
  firefox.press('D', { ctrlKey: true, shiftKey: true });
  firefox.press('O', { altKey: true, shiftKey: true });
  assert.equal(firefox.messages.length, 0);
});
