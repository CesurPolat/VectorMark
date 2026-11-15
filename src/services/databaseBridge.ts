const DATABASE_MESSAGE = 'vectormark-database-request';

export function createDatabaseClient<T extends Record<string, any>>(local: T, api: typeof chrome): T {
  const privateFirefox = api.runtime.getManifest().browser_specific_settings != null
    && api.extension.inIncognitoContext;
  if (!privateFirefox) return local;

  return new Proxy(local, {
    get(target, method: string) {
      if (typeof target[method] !== 'function') return target[method];
      return (...args: unknown[]) => new Promise((resolve, reject) => {
        api.runtime.sendMessage({ type: DATABASE_MESSAGE, method, args }, response => {
          const transportError = api.runtime.lastError;
          if (transportError) {
            reject(new Error(transportError.message || 'Database background is unavailable.'));
          } else if (!response?.ok) {
            reject(new Error(response?.error || 'Could not access the bookmark database.'));
          } else {
            resolve(response.value);
          }
        });
      });
    }
  });
}

export function registerDatabaseBridge(local: Record<string, any>, api: typeof chrome) {
  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== DATABASE_MESSAGE) return;
    // Content scripts and arbitrary web pages cannot invoke database mutations.
    if (sender.id !== api.runtime.id || !sender.url?.startsWith(api.runtime.getURL(''))
      || !Object.prototype.hasOwnProperty.call(local, message.method)
      || typeof local[message.method] !== 'function' || !Array.isArray(message.args)) {
      sendResponse({ ok: false, error: 'Invalid database request.' });
      return;
    }

    Promise.resolve().then(() => local[message.method](...message.args)).then(
      value => sendResponse({ ok: true, value: value ?? null }),
      error => sendResponse({ ok: false, error:
        error?.name === 'DatabaseClosedError' || error?.name === 'InvalidStateError'
          ? 'Firefox cannot access the bookmark database in this browsing mode. Open a normal Firefox window; Always use private browsing mode is not supported.'
          : String(error?.message || 'Database operation failed.') })
    );
    return true;
  });
}
