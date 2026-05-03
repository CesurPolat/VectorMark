import {
  clearIndexedDocuments,
  countIndexedDocuments,
  queryIndexedDocuments,
  upsertIndexedDocuments,
  initLanceDB
} from './lancedbVectorStore.js';

// Dynamic module loading for extension compatibility
let transformersModule;
let ulidModule;
let importPromise = null;

const getModules = async () => {
  if (importPromise) return importPromise;

  importPromise = (async () => {
    if (!transformersModule || !ulidModule) {
      try {
        transformersModule = await import('../node_modules/@huggingface/transformers/dist/transformers.min.js');
        ulidModule = await import('../node_modules/ulid/dist/browser/index.js');
      } catch (error) {
        console.error('Failed to import modules:', error);
        throw error;
      }
    }
    return { transformersModule, ulidModule };
  })();

  return importPromise;
};

// Lazy getters for modules
let env, pipeline, isValid, ulid;

const initModules = async () => {
  const { transformersModule: tm, ulidModule: um } = await getModules();
  env = tm.env;
  pipeline = tm.pipeline;
  isValid = um.isValid;
  ulid = um.ulid;
};

const DEFAULT_DOCUMENT_COUNT = 5;
const TITLE_VARIANTS = [
  'Vector search index notes',
  'Customer interview summary',
  'Bookmark organization draft',
  'Extension QA checklist',
  'Semantic tagging experiment',
  'Search ranking observations',
  'Import pipeline test sample'
];
const CONTENT_VARIANTS = [
  'Short synthetic payload for validating ULID-driven document creation in a standalone test area.',
  'Used to inspect document IDs, timestamps, tag arrays, and render consistency across repeated generations.',
  'Represents mock content only and does not write anything into the production bookmark database.',
  'Helpful for manual browser checks where we want deterministic structure with fresh unique identifiers.'
];
const TAG_VARIANTS = [
  ['ulid', 'test', 'demo'],
  ['vector', 'search', 'sample'],
  ['bookmark', 'qa', 'fixture'],
  ['manual', 'browser', 'preview'],
  ['docs', 'seed', 'sandbox']
];
const STATUS_VARIANTS = ['draft', 'ready', 'archived', 'review'];

const generateButton = document.getElementById('generate-documents-btn');
const documentList = document.getElementById('document-list');
const jsonPreview = document.getElementById('json-preview');
const documentCount = document.getElementById('document-count');
const ulidValidity = document.getElementById('ulid-validity');
const ulidUniqueness = document.getElementById('ulid-uniqueness');
const customTitleInput = document.getElementById('custom-title');
const customStatusInput = document.getElementById('custom-status');
const customContentInput = document.getElementById('custom-content');
const customTagsInput = document.getElementById('custom-tags');
const addDocumentButton = document.getElementById('add-document-btn');
const vectorQueryInput = document.getElementById('vector-query');
const storeInitButton = document.getElementById('store-init-btn');
const storeIndexButton = document.getElementById('store-index-btn');
const storeQueryButton = document.getElementById('store-query-btn');
const storeClearButton = document.getElementById('store-clear-btn');
const storeStatus = document.getElementById('store-status');
const storeResults = document.getElementById('store-results');

const state = {
  documents: [],
  extractor: null
};

// Initialize environment after modules are loaded
const initEnvironment = () => initModules().then(() => {
  if (env) {
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    /* env.localModelPath = typeof chrome !== 'undefined' && chrome?.runtime?.getURL
      ? chrome.runtime.getURL('models/')
      : new URL('../models/', import.meta.url).href; */
    const wasmBase = typeof chrome !== 'undefined' && chrome?.runtime?.getURL
      ? chrome.runtime.getURL('models/all-MiniLM-L6-v2/wasm/')
      : new URL('../models/all-MiniLM-L6-v2/wasm/', import.meta.url).href;
    env.backends.onnx.wasm.wasmPaths = {
      mjs: `${wasmBase}ort-wasm-simd-threaded.jsep.mjs`,
      wasm: `${wasmBase}ort-wasm-simd-threaded.jsep.wasm`
    };

    env.backends.onnx.wasm.useWasmModule = false;
    env.backends.onnx.wasm.allowLocalModels = true;
    env.backends.onnx.wasm.proxy = false;
  }
});

/**
 * @typedef {Object} TestDocument
 * @property {string} id
 * @property {string} title
 * @property {string} content
 * @property {string} createdAt
 * @property {string[]} tags
 * @property {string} status
 */

/**
 * Generate a readable array of test documents with ULID identifiers.
 * @param {number} [count=5]
 * @returns {Promise<TestDocument[]>}
 */
export async function createTestDocuments(count = DEFAULT_DOCUMENT_COUNT) {
  await initModules();

  const safeCount = Number.isInteger(count) && count > 0 ? count : DEFAULT_DOCUMENT_COUNT;
  const createdAtBase = Date.now();

  return Array.from({ length: safeCount }, (_, index) => {
    const title = TITLE_VARIANTS[index % TITLE_VARIANTS.length];
    const content = CONTENT_VARIANTS[index % CONTENT_VARIANTS.length];
    const tags = TAG_VARIANTS[index % TAG_VARIANTS.length];
    const status = STATUS_VARIANTS[index % STATUS_VARIANTS.length];
    const createdAt = new Date(createdAtBase + index * 1000).toISOString();

    return {
      id: ulid(),
      title: `${title} #${index + 1}`,
      content,
      createdAt,
      tags,
      status
    };
  });
}

function createTagMarkup(tags) {
  return tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function validateDocumentSet(documents) {
  await initModules();

  const validUlids = documents.every((documentItem) => isValid(documentItem.id) && documentItem.id.length === 26);
  const uniqueIds = new Set(documents.map((documentItem) => documentItem.id)).size === documents.length;

  return { validUlids, uniqueIds };
}

async function renderDocuments(documents) {
  state.documents = documents;
  const { validUlids, uniqueIds } = await validateDocumentSet(documents);

  documentCount.textContent = String(documents.length);
  ulidValidity.textContent = validUlids ? 'Yes' : 'No';
  ulidUniqueness.textContent = uniqueIds ? 'Yes' : 'No';

  documentList.innerHTML = documents.map((documentItem) => {
    return `
      <article class="document-card">
        <div class="document-head">
          <div>
            <h3 class="title is-6 mb-2">${escapeHtml(documentItem.title)}</h3>
            <div class="document-id">${escapeHtml(documentItem.id)}</div>
          </div>
          <span class="tag">${escapeHtml(documentItem.status)}</span>
        </div>
        <p class="mb-3">${escapeHtml(documentItem.content)}</p>
        <p class="is-size-7 has-text-grey mb-0">Created At: ${escapeHtml(documentItem.createdAt)}</p>
        <div class="tag-row">${createTagMarkup(documentItem.tags)}</div>
      </article>
    `;
  }).join('');

  jsonPreview.textContent = JSON.stringify(documents, null, 2);
  console.log('Generated ULID test documents:', documents);
}

function parseTags(rawTags) {
  return String(rawTags || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function clearComposer() {
  customTitleInput.value = '';
  customContentInput.value = '';
  customTagsInput.value = '';
  customStatusInput.value = 'draft';
}

async function addCustomDocument() {
  await initModules();

  const title = String(customTitleInput.value || '').trim();
  const content = String(customContentInput.value || '').trim();
  const status = String(customStatusInput.value || 'draft').trim() || 'draft';
  const tags = parseTags(customTagsInput.value);

  if (!title || !content) {
    setStoreStatus('Add a title and content before creating a custom document.', true);
    return;
  }

  const nextDocument = {
    id: ulid(),
    title,
    content,
    createdAt: new Date().toISOString(),
    tags,
    status
  };

  await renderDocuments([nextDocument, ...state.documents]);
  clearComposer();
  renderChromaResults([]);
  setStoreStatus('Custom document added to the current list. Re-index to include it in search.', false);
}

function setStoreStatus(message, isError = false) {
  storeStatus.textContent = message;
  storeStatus.style.background = isError ? '#fff1f0' : '#f4f7fd';
  storeStatus.style.color = isError ? '#a3362b' : '#21314f';
}

async function getEmbedder() {
  await initModules();

  if (!state.extractor) {
    setStoreStatus('Loading local embedding model...');
    state.extractor = await pipeline('feature-extraction', 'all-MiniLM-L6-v2', {
      quantized: true
    });
  }

  return state.extractor;
}

async function embedTexts(texts) {
  const embedder = await getEmbedder();
  const output = await embedder(texts, { pooling: 'mean', normalize: true });
  return output.tolist();
}

function toChromaPayload(documents) {
  return {
    ids: documents.map((documentItem) => documentItem.id),
    documents: documents.map((documentItem) => `${documentItem.title}\n${documentItem.content}`),
    metadatas: documents.map((documentItem) => ({
      title: documentItem.title,
      createdAt: documentItem.createdAt,
      status: documentItem.status,
      tags: documentItem.tags.join(','),
      source: 'test_documents'
    }))
  };
}

function renderChromaResults(rows) {
  if (!rows.length) {
    storeResults.innerHTML = '<div class="result-card">No matches returned.</div>';
    return;
  }

  storeResults.innerHTML = rows.map((row) => {
    const score = typeof row.score === 'number' ? row.score.toFixed(6) : 'n/a';
    const title = row.title || row.id;
    const status = row.status || 'unknown';
    const createdAt = row.createdAt || 'n/a';

    return `
      <article class="result-card">
        <h3 class="title is-6 mb-2">${escapeHtml(title)}</h3>
        <div class="document-id mb-2">${escapeHtml(row.id)}</div>
        <p class="mb-2">${escapeHtml(row.documentText || row.content || '')}</p>
        <p class="is-size-7 has-text-grey mb-0">Score: ${escapeHtml(score)} | Status: ${escapeHtml(status)} | Created At: ${escapeHtml(createdAt)}</p>
      </article>
    `;
  }).join('');
}

function toIndexedPayload(documents, embeddings) {
  return documents.map((documentItem, index) => ({
    ...documentItem,
    documentText: `${documentItem.title}\n${documentItem.content}`,
    embedding: embeddings[index] || []
  }));
}

async function initializeStore() {
  try {
    setStoreStatus('Initializing LanceDB...');
    const initResult = await initLanceDB();
    const count = await countIndexedDocuments();
    if (initResult?.status === 'fallback') {
      setStoreStatus(`LanceDB is not supported in this extension context. Using browser store instead. Indexed documents currently stored: ${count}.`);
      return;
    }
    setStoreStatus(`LanceDB ready. Indexed documents currently stored: ${count}.`);
  } catch (error) {
    console.error('LanceDB initialization error:', error);
    setStoreStatus(`LanceDB initialization failed: ${error.message}`, true);
  }
}

async function indexDocumentsToStore() {
  if (!state.documents.length) {
    setStoreStatus('Generate documents before indexing.', true);
    return;
  }

  setStoreStatus('Generating local embeddings and indexing documents in LanceDB...');

  try {
    await initLanceDB();
    const payload = toChromaPayload(state.documents);
    const embeddings = await embedTexts(payload.documents);
    const indexedRows = toIndexedPayload(state.documents, embeddings);
    const indexedCount = await upsertIndexedDocuments(indexedRows);
    const totalCount = await countIndexedDocuments();
    setStoreStatus(`Indexed ${indexedCount} document(s). LanceDB now contains ${totalCount} total record(s).`);
  } catch (error) {
    console.error('LanceDB indexing error:', error);
    setStoreStatus(`Indexing failed: ${error.message}`, true);
  }
}

async function queryLocalStore() {
  const queryText = String(vectorQueryInput.value || '').trim();

  if (!queryText) {
    setStoreStatus('Enter a query before running search.', true);
    return;
  }

  setStoreStatus('Running LanceDB vector similarity search...');

  try {
    const [queryEmbedding] = await embedTexts([queryText]);
    const rows = await queryIndexedDocuments(queryEmbedding, 5);

    renderChromaResults(rows);
    setStoreStatus(`Search completed. Returned ${rows.length} result(s) from LanceDB.`);
  } catch (error) {
    console.error('LanceDB query error:', error);
    renderChromaResults([]);
    setStoreStatus(`Search failed: ${error.message}`, true);
  }
}

async function clearLocalStore() {
  try {
    await clearIndexedDocuments();
    renderChromaResults([]);
    setStoreStatus('LanceDB vector store cleared.');
  } catch (error) {
    console.error('LanceDB clear error:', error);
    setStoreStatus(`Clear failed: ${error.message}`, true);
  }
}

async function regenerateDocuments() {
  const documents = await createTestDocuments();
  await renderDocuments(documents);
  renderChromaResults([]);
}

generateButton.addEventListener('click', () => regenerateDocuments().catch(err => console.error('Generate error:', err)));
addDocumentButton.addEventListener('click', () => addCustomDocument().catch(err => console.error('Add document error:', err)));
storeInitButton.addEventListener('click', initializeStore);
storeIndexButton.addEventListener('click', indexDocumentsToStore);
storeQueryButton.addEventListener('click', queryLocalStore);
storeClearButton.addEventListener('click', () => clearLocalStore().catch(err => console.error('Clear error:', err)));

// Initialize on page load
(async () => {
  try {
    await initEnvironment();
    await regenerateDocuments();
    renderChromaResults([]);
    await initializeStore();
  } catch (error) {
    console.error('Page initialization error:', error);
    setStoreStatus(`Initialization failed: ${error.message}`, true);
  }
})();
