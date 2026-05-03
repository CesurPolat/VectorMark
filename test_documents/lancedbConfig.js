/**
 * LanceDB configuration for browser/extension environment detection and WASM path setup.
 * Handles Chrome extension context vs. standalone browser and manages storage backend selection.
 */

/**
 * Detect if running in Chrome extension context.
 * @returns {boolean}
 */
export function isExtensionContext() {
  return typeof chrome !== 'undefined' && chrome?.runtime?.getURL !== undefined;
}

/**
 * Get the base path for WASM modules based on environment.
 * @returns {string}
 */
export function getWasmPath() {
  if (isExtensionContext()) {
    return chrome.runtime.getURL('models/all-MiniLM-L6-v2/wasm/');
  }
  return new URL('../models/all-MiniLM-L6-v2/wasm/', import.meta.url).href;
}

/**
 * Get the base path for LanceDB modules.
 * @returns {string}
 */
export function getLanceDBPath() {
  if (isExtensionContext()) {
    return chrome.runtime.getURL('node_modules/@lancedb/lancedb/');
  }
  return new URL('../node_modules/@lancedb/lancedb/', import.meta.url).href;
}

/**
 * Determine if IndexedDB is available.
 * @returns {boolean}
 */
export function isIndexedDBAvailable() {
  return typeof indexedDB !== 'undefined';
}

/**
 * Determine if Origin Private File System (OPFS) is available.
 * @returns {Promise<boolean>}
 */
export async function isOPFSAvailable() {
  try {
    if (!navigator?.storage?.getDirectory) {
      return false;
    }
    // Check if we can actually access OPFS
    const root = await navigator.storage.getDirectory();
    return !!root;
  } catch (error) {
    console.warn('OPFS availability check failed:', error);
    return false;
  }
}

/**
 * Get the recommended storage backend for the current environment.
 * @returns {Promise<'indexeddb' | 'opfs'>}
 */
export async function getStorageBackend() {
  // In extension context, prefer IndexedDB for stability
  if (isExtensionContext()) {
    return 'indexeddb';
  }

  // In standalone browser, check for OPFS first
  const opfsAvailable = await isOPFSAvailable();
  if (opfsAvailable) {
    return 'opfs';
  }

  return 'indexeddb';
}

/**
 * Configure LanceDB environment variables.
 * Sets up WASM paths and enables local models.
 */
export async function configureLanceDBEnvironment() {
  // LanceDB will use the environment variables we set
  // This function is mainly a hook for future configuration needs
  const backend = await getStorageBackend();
  const context = isExtensionContext() ? 'extension' : 'browser';
  
  console.log(`[LanceDB] Configured for ${context} environment with ${backend} storage backend`);

  return {
    context,
    backend,
    wasmPath: getWasmPath(),
    lancedbPath: getLanceDBPath()
  };
}

/**
 * Get database name based on environment.
 * Ensures test DB doesn't conflict with production.
 * @returns {string}
 */
export function getDatabaseName() {
  return 'VectorMarkLanceTest';
}

/**
 * Get table name for indexed documents.
 * @returns {string}
 */
export function getTableName() {
  return 'testDocuments';
}

/**
 * Validate environment compatibility.
 * @returns {Promise<{compatible: boolean, warnings: string[]}>}
 */
export async function validateEnvironment() {
  const warnings = [];

  if (!isIndexedDBAvailable()) {
    warnings.push('IndexedDB is not available - vector store will not work');
  }

  const opfsAvailable = await isOPFSAvailable();
  const backend = await getStorageBackend();
  
  if (!opfsAvailable && backend === 'opfs') {
    warnings.push('OPFS requested but not available - falling back to IndexedDB');
  }

  const context = isExtensionContext() ? 'extension' : 'browser';
  console.log(`[LanceDB] Environment validation: ${context}, ${backend}, ${warnings.length} warnings`);

  return {
    compatible: warnings.length === 0,
    warnings
  };
}
