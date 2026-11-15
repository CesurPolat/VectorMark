import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

const source = readFileSync(new URL('../src/services/databaseBridge.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const context = { exports: {} };
vm.runInNewContext(compiled, context);
const { createDatabaseClient, registerDatabaseBridge } = context.exports;

function setup({ privateWindow = true, firefox = true } = {}) {
  let handler;
  let sender = { id: 'vectormark', url: 'moz-extension://test/src/popup/popup.html' };
  const api = {
    extension: { inIncognitoContext: privateWindow },
    runtime: {
      id: 'vectormark', getURL: () => 'moz-extension://test/',
      getManifest: () => firefox ? { browser_specific_settings: {} } : {},
      onMessage: { addListener(fn) { handler = fn; } },
      sendMessage(message, callback) { handler(message, sender, callback); }
    }
  };
  return { api, setSender(value) { sender = value; } };
}

test('private Firefox CRUD executes on background instead of private IndexedDB', async () => {
  const { api } = setup();
  const rows = new Map();
  registerDatabaseBridge({
    save: async (url, title) => { rows.set(url, title); return 'saved'; },
    read: async url => rows.get(url),
    remove: async url => rows.delete(url)
  }, api);
  const fail = () => { throw new Error('Private IndexedDB must not be used'); };
  const client = createDatabaseClient({ save: fail, read: fail, remove: fail }, api);
  assert.equal(await client.save('https://example.com', 'Example'), 'saved');
  assert.equal(await client.read('https://example.com'), 'Example');
  await client.remove('https://example.com');
  assert.equal(rows.size, 0);
});

test('normal Firefox and Chrome keep local storage path', () => {
  const local = { read() {} };
  assert.equal(createDatabaseClient(local, setup({ privateWindow: false }).api), local);
  assert.equal(createDatabaseClient(local, setup({ firefox: false }).api), local);
});

test('content script and unknown operation cannot mutate the collection', async () => {
  const harness = setup();
  let writes = 0;
  const local = { save: async () => { writes++; } };
  registerDatabaseBridge(local, harness.api);
  const client = createDatabaseClient(local, harness.api);
  harness.setSender({ id: 'vectormark', url: 'https://example.com' });
  await assert.rejects(client.save(), /Invalid database request/);
  harness.setSender({ id: 'vectormark', url: 'moz-extension://test/src/popup/popup.html' });
  const response = await new Promise(resolve => harness.api.runtime.sendMessage({
    type: 'vectormark-database-request', method: 'constructor', args: []
  }, resolve));
  assert.equal(response.ok, false);
  assert.equal(writes, 0);
});

test('permanent private mode reports storage failure without false success', async () => {
  const { api } = setup();
  registerDatabaseBridge({ read: async () => { throw { name: 'DatabaseClosedError' }; } }, api);
  const client = createDatabaseClient({ read() {} }, api);
  await assert.rejects(client.read(), /Always use private browsing mode is not supported/);
});
