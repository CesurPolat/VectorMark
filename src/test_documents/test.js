import { VecLite, IndexedDBAdapter } from 'veclite';
import { pipeline, env } from '../../node_modules/@huggingface/transformers/dist/transformers.min.js';
import { monotonicFactory, decodeTime } from 'ulid';

const VECTOR_DIMENSIONS = 384;
const INDEX_DB_NAME = 'VectorMarkLanceTest';
const INDEX_STORE_NAME = 'notes';
const NOTES_STORAGE_KEY = 'vectormark-demo-notes';
const DEFAULT_TOP_K = 8;

const createUlid = monotonicFactory();

let extractorPromise = null;
let db = null;

const state = {
  notes: [],
  selectedNoteId: null,
  searchResults: [],
  modelReady: false,
  busy: false,
};

const elements = {
  status: document.getElementById('status-message'),
  error: document.getElementById('error-message'),
  modelBadge: document.getElementById('model-status'),
  dbSize: document.getElementById('db-size'),
  noteCount: document.getElementById('note-count'),
  searchCount: document.getElementById('search-count'),
  selectedLabel: document.getElementById('selected-note-label'),
  noteForm: document.getElementById('note-form'),
  noteId: document.getElementById('note-id'),
  noteTitle: document.getElementById('note-title'),
  noteContent: document.getElementById('note-content'),
  noteTags: document.getElementById('note-tags'),
  noteCategory: document.getElementById('note-category'),
  noteStatus: document.getElementById('note-status'),
  notePinned: document.getElementById('note-pinned'),
  saveNoteBtn: document.getElementById('save-note-btn'),
  resetFormBtn: document.getElementById('reset-form-btn'),
  seedBtn: document.getElementById('seed-demo-btn'),
  saveDbBtn: document.getElementById('save-db-btn'),
  loadDbBtn: document.getElementById('load-db-btn'),
  clearMemoryBtn: document.getElementById('clear-memory-btn'),
  resetAllBtn: document.getElementById('reset-all-btn'),
  runSearchBtn: document.getElementById('run-search-btn'),
  clearSearchBtn: document.getElementById('clear-search-btn'),
  searchQuery: document.getElementById('search-query'),
  filterCategory: document.getElementById('filter-category'),
  filterStatus: document.getElementById('filter-status'),
  filterPinned: document.getElementById('filter-pinned'),
  filterCreatedAfter: document.getElementById('filter-created-after'),
  filterTags: document.getElementById('filter-tags'),
  noteList: document.getElementById('note-list'),
  resultList: document.getElementById('search-results'),
};

main().catch((error) => {
  console.error(error);
  setError(error.message || 'Demo baslatilamadi.');
  setStatus('Demo baslatilamadi.');
});

async function main() {
  bindEvents();
  renderNotes();
  renderSearchResults();

  setStatus('VecLite ve model ortami hazirlaniyor...');
  await initializeDb();
  await initializeExtractor();
  await restorePersistedState();
  renderAll();
  setStatus('Demo hazir. Not ekleyebilir veya ornek veri yukleyebilirsin.');
}

function bindEvents() {
  elements.noteForm.addEventListener('submit', handleNoteSubmit);
  elements.resetFormBtn.addEventListener('click', resetForm);
  elements.seedBtn.addEventListener('click', handleSeedData);
  elements.saveDbBtn.addEventListener('click', handleSaveDb);
  elements.loadDbBtn.addEventListener('click', handleLoadDb);
  elements.clearMemoryBtn.addEventListener('click', handleClearMemory);
  elements.resetAllBtn.addEventListener('click', handleResetAll);
  elements.runSearchBtn.addEventListener('click', handleSearch);
  elements.clearSearchBtn.addEventListener('click', clearSearch);
  elements.searchQuery.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleSearch();
    }
  });

  elements.noteList.addEventListener('click', async (event) => {
    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) {
      return;
    }

    const { action, noteId } = actionButton.dataset;
    if (!noteId) {
      return;
    }

    if (action === 'edit') {
      populateForm(noteId);
      return;
    }

    if (action === 'copy-id') {
      await copyText(noteId);
      setStatus(`ULID kopyalandi: ${noteId}`);
      return;
    }

    if (action === 'delete') {
      await deleteNote(noteId);
    }
  });
}

async function initializeDb() {
  const wasmUrl = resolveAssetUrl('../node_modules/veclite/dist/veclite_bg.wasm');
  await VecLite.init(wasmUrl);
  db = new VecLite({
    dimensions: VECTOR_DIMENSIONS,
    storage: new IndexedDBAdapter(INDEX_DB_NAME, INDEX_STORE_NAME),
  });
}

async function initializeExtractor() {
  setStatus('Embedding modeli yukleniyor...');
  await getExtractor();
  state.modelReady = true;
  elements.modelBadge.textContent = 'Model ready';
}

function configureTransformerEnv() {
  const modelRootUrl = resolveAssetUrl('../models/');
  const modelUrl = resolveAssetUrl('../models/all-MiniLM-L6-v2/');
  const onnxWasmMjsUrl = resolveAssetUrl('../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs');
  const onnxWasmBinaryUrl = resolveAssetUrl('../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm');

  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = modelRootUrl;
  env.backends.onnx.wasm.wasmPaths = {
    mjs: onnxWasmMjsUrl,
    wasm: onnxWasmBinaryUrl,
  };
  env.backends.onnx.wasm.useWasmModule = false;
  env.backends.onnx.wasm.proxy = false;

  return modelUrl;
}

async function getExtractor() {
  if (!extractorPromise) {
    const modelUrl = configureTransformerEnv();
    extractorPromise = pipeline('feature-extraction', modelUrl);
  }

  return extractorPromise;
}

async function restorePersistedState() {
  try {
    const savedNotes = localStorage.getItem(NOTES_STORAGE_KEY);
    if (!savedNotes) {
      updateCounts();
      return;
    }

    state.notes = JSON.parse(savedNotes);
    db.clear();
    await db.load();
    if (db.size !== state.notes.length) {
      await syncIndexFromState();
      await db.save();
    }
    sortNotesInPlace();
    updateCounts();
    setStatus(`Kayitli ${state.notes.length} not geri yuklendi.`);
  } catch (error) {
    console.error('Failed to restore demo state:', error);
    state.notes = [];
    db.clear();
    updateCounts();
    setError('Kayitli notlar okunurken sorun olustu.');
  }
}

async function handleNoteSubmit(event) {
  event.preventDefault();
  clearError();

  const existingId = elements.noteId.value.trim();
  const nowIso = new Date().toISOString();
  const createdAt = existingId
    ? getNoteById(existingId)?.createdAt || nowIso
    : nowIso;
  const note = {
    id: existingId || createUlid(Date.now()),
    title: elements.noteTitle.value.trim(),
    content: elements.noteContent.value.trim(),
    tags: parseTags(elements.noteTags.value),
    category: elements.noteCategory.value,
    status: elements.noteStatus.value,
    pinned: elements.notePinned.value === 'true',
    createdAt,
    updatedAt: nowIso,
  };

  if (!note.title || !note.content) {
    setError('Baslik ve not icerigi zorunlu.');
    return;
  }

  await withBusy(existingId ? 'Not guncelleniyor...' : 'Not kaydediliyor...', async () => {
    const vector = await embedText(buildEmbeddingText(note));
    db.upsert([{ id: note.id, vector, metadata: serializeNoteToMetadata(note) }]);
    upsertNoteInState(note);
    persistNotesState();
    resetForm();
    renderAll();
    setStatus(existingId ? 'Not guncellendi.' : 'Yeni not eklendi.');
  });
}

async function handleSeedData() {
  clearError();
  const sampleNotes = [
    {
      title: 'Rust WASM benchmark notlari',
      content: 'VecLite tarafinda flat index ile browser icinde hizli arama denemeleri yaptim.',
      tags: ['rust', 'wasm', 'vector'],
      category: 'research',
      status: 'draft',
      pinned: true,
    },
    {
      title: 'Musteri toplantisi ozet',
      content: 'Arama sonuclarinda etiket ve kategori filtrelerinin gorunur olmasi istendi.',
      tags: ['meeting', 'product', 'notes'],
      category: 'work',
      status: 'active',
      pinned: false,
    },
    {
      title: 'Semantik arama fikirleri',
      content: 'Not metni, etiketler ve baslik birlestirilip embedding uretmek en sade akisti.',
      tags: ['semantic-search', 'embedding', 'demo'],
      category: 'ideas',
      status: 'active',
      pinned: true,
    },
    {
      title: 'Okuma listesi',
      content: 'ULID ile uretilen notlar zaman sirasina gore duzgun sekilde listelenebilir.',
      tags: ['reading', 'ulid'],
      category: 'personal',
      status: 'archived',
      pinned: false,
    },
    {
      title: 'Extension TODO',
      content: 'Settings ekranindaki LanceDB ifadesi VecLite olarak duzeltilmeli.',
      tags: ['todo', 'extension'],
      category: 'work',
      status: 'draft',
      pinned: false,
    },
  ];

  await withBusy('Ornek notlar hazirlaniyor...', async () => {
    const entries = [];

    for (const sample of sampleNotes) {
      const now = new Date().toISOString();
      const note = {
        id: createUlid(Date.now()),
        title: sample.title,
        content: sample.content,
        tags: sample.tags,
        category: sample.category,
        status: sample.status,
        pinned: sample.pinned,
        createdAt: now,
        updatedAt: now,
      };

      const vector = await embedText(buildEmbeddingText(note));
      entries.push({ id: note.id, vector, metadata: serializeNoteToMetadata(note) });
      upsertNoteInState(note);
    }

    db.upsert(entries);
    persistNotesState();
    renderAll();
    setStatus(`${sampleNotes.length} ornek not indexe eklendi.`);
  });
}

async function handleSaveDb() {
  clearError();
  await withBusy('Index ve notlar kalici depoya yaziliyor...', async () => {
    persistNotesState();
    await db.save();
    updateCounts();
    setStatus('VecLite indexi ve not listesi kaydedildi.');
  });
}

async function handleLoadDb() {
  clearError();
  await withBusy('Kayitli veri geri yukleniyor...', async () => {
    db.clear();
    await db.load();
    const savedNotes = localStorage.getItem(NOTES_STORAGE_KEY);
    state.notes = savedNotes ? JSON.parse(savedNotes) : [];
    if (db.size !== state.notes.length) {
      await syncIndexFromState();
      await db.save();
    }
    sortNotesInPlace();
    state.searchResults = [];
    renderAll();
    setStatus('Kalici veri geri yuklendi.');
  });
}

async function handleClearMemory() {
  clearError();
  await withBusy('Bellekteki vector index temizleniyor...', async () => {
    db.clear();
    state.searchResults = [];
    updateCounts();
    renderSearchResults();
    setStatus('Bellekteki VecLite index temizlendi. Kayitli veri halen duruyor.');
  });
}

async function handleResetAll() {
  clearError();
  await withBusy('Tum demo verisi sifirlaniyor...', async () => {
    state.notes = [];
    state.searchResults = [];
    state.selectedNoteId = null;
    db.clear();
    await db.save();
    localStorage.removeItem(NOTES_STORAGE_KEY);
    resetForm();
    renderAll();
    setStatus('Tum demo verisi sifirlandi.');
  });
}

async function handleSearch() {
  clearError();
  const query = elements.searchQuery.value.trim();
  const { filter, tagFilters } = buildSearchFilters();

  if (!query && !hasActiveFilters(tagFilters, filter)) {
    state.searchResults = [];
    renderSearchResults();
    setStatus('Arama yapmak icin sorgu veya filtre sec.');
    return;
  }

  await withBusy('Arama embeddingi hazirlaniyor...', async () => {
    let matches = [];

    if (query) {
      const vector = await embedText(buildEmbeddingText({ title: query, content: query, tags: tagFilters }));
      matches = db.search({
        vector,
        topK: Math.max(DEFAULT_TOP_K, db.size || DEFAULT_TOP_K),
        filter,
      });
    } else {
      matches = buildFilteredResultsFromState(filter);
    }

    if (tagFilters.length > 0) {
      matches = matches.filter((result) => {
        const note = getNoteById(result.id);
        if (!note) {
          return false;
        }

        const noteTags = note.tags.map((tag) => tag.toLowerCase());
        return tagFilters.every((tag) => noteTags.includes(tag));
      });
    }

    state.searchResults = matches.map((result) => ({
      ...result,
      note: getNoteById(result.id),
    }));
    renderSearchResults();
    setStatus(`${state.searchResults.length} sonuc bulundu.`);
  });
}

function clearSearch() {
  clearError();
  elements.searchQuery.value = '';
  elements.filterCategory.value = '';
  elements.filterStatus.value = '';
  elements.filterPinned.value = '';
  elements.filterCreatedAfter.value = '';
  elements.filterTags.value = '';
  state.searchResults = [];
  renderSearchResults();
  setStatus('Arama alani temizlendi.');
}

async function deleteNote(noteId) {
  clearError();
  await withBusy('Not siliniyor...', async () => {
    db.delete([noteId]);
    state.notes = state.notes.filter((note) => note.id !== noteId);
    state.searchResults = state.searchResults.filter((result) => result.id !== noteId);
    if (state.selectedNoteId === noteId) {
      resetForm();
    }
    persistNotesState();
    renderAll();
    setStatus('Not silindi.');
  });
}

function buildSearchFilters() {
  const filter = {};
  const category = elements.filterCategory.value;
  const status = elements.filterStatus.value;
  const pinned = elements.filterPinned.value;
  const createdAfter = elements.filterCreatedAfter.value;
  const tagFilters = parseTags(elements.filterTags.value).map((tag) => tag.toLowerCase());

  if (category) {
    filter.category = category;
  }
  if (status) {
    filter.status = status;
  }
  if (pinned) {
    filter.pinned = pinned === 'true';
  }
  if (createdAfter) {
    const createdAtMs = new Date(`${createdAfter}T00:00:00`).getTime();
    if (!Number.isNaN(createdAtMs)) {
      filter.createdAtMs = { $gte: createdAtMs };
    }
  }

  return { filter, tagFilters };
}

function buildFilteredResultsFromState(filter) {
  return sortNotesCopy(state.notes)
    .filter((note) => matchesFilter(note, filter))
    .map((note) => ({
      id: note.id,
      score: 1,
      metadata: serializeNoteToMetadata(note),
    }));
}

function matchesFilter(note, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === 'object' && '$gte' in value) {
      return Number(note.createdAt ? new Date(note.createdAt).getTime() : 0) >= value.$gte;
    }
    return serializeNoteToMetadata(note)[key] === value;
  });
}

async function embedText(text) {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

function buildEmbeddingText(noteOrQuery) {
  const parts = [
    noteOrQuery.title || '',
    noteOrQuery.content || '',
    Array.isArray(noteOrQuery.tags) ? noteOrQuery.tags.join(' ') : '',
  ];

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function serializeNoteToMetadata(note) {
  return {
    title: note.title,
    preview: truncate(note.content, 140),
    category: note.category,
    status: note.status,
    pinned: Boolean(note.pinned),
    createdAtMs: new Date(note.createdAt).getTime(),
    updatedAtMs: new Date(note.updatedAt).getTime(),
    tagsText: note.tags.join(' | '),
  };
}

function renderAll() {
  renderNotes();
  renderSearchResults();
  updateCounts();
}

function renderNotes() {
  const notes = sortNotesCopy(state.notes);
  elements.noteList.innerHTML = '';

  if (notes.length === 0) {
    elements.noteList.innerHTML = '<div class="empty-state">Henuz not yok. Soldan bir not olustur veya ornek veri yukle.</div>';
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const note of notes) {
    const article = document.createElement('article');
    article.className = `note-card${state.selectedNoteId === note.id ? ' is-selected' : ''}`;
    article.innerHTML = `
      <div class="note-card__top">
        <div>
          <h3>${escapeHtml(note.title)}</h3>
          <p class="note-meta">${escapeHtml(note.category)} • ${escapeHtml(note.status)}${note.pinned ? ' • pinned' : ''}</p>
        </div>
        <div class="note-actions">
          <button class="button is-small is-light" type="button" data-action="copy-id" data-note-id="${note.id}">Copy ULID</button>
          <button class="button is-small is-info is-light" type="button" data-action="edit" data-note-id="${note.id}">Edit</button>
          <button class="button is-small is-danger is-light" type="button" data-action="delete" data-note-id="${note.id}">Delete</button>
        </div>
      </div>
      <p class="note-body">${escapeHtml(truncate(note.content, 180))}</p>
      <p class="note-tags">${note.tags.length ? note.tags.map((tag) => `#${escapeHtml(tag)}`).join(' ') : 'No tags'}</p>
      <div class="note-footer">
        <code>${note.id}</code>
        <span>${formatDate(note.createdAt)}</span>
      </div>
      <p class="ulid-note">ULID time: ${formatDate(decodeTime(note.id))} • createdAt ile uyumlu</p>
    `;
    fragment.append(article);
  }

  elements.noteList.append(fragment);
}

function renderSearchResults() {
  elements.resultList.innerHTML = '';

  if (state.searchResults.length === 0) {
    elements.resultList.innerHTML = '<div class="empty-state">Semantic arama sonuclari burada gorunecek.</div>';
    updateCounts();
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const result of state.searchResults) {
    const note = result.note || getNoteById(result.id);
    if (!note) {
      continue;
    }

    const item = document.createElement('article');
    item.className = 'result-card';
    item.innerHTML = `
      <div class="result-card__top">
        <h3>${escapeHtml(note.title)}</h3>
        <span class="score-pill">score ${result.score.toFixed(3)}</span>
      </div>
      <p class="note-meta">${escapeHtml(note.category)} • ${escapeHtml(note.status)}${note.pinned ? ' • pinned' : ''}</p>
      <p class="note-body">${escapeHtml(result.metadata?.preview || truncate(note.content, 140))}</p>
      <div class="note-footer">
        <code>${result.id}</code>
        <span>${formatDate(note.createdAt)}</span>
      </div>
    `;
    fragment.append(item);
  }

  elements.resultList.append(fragment);
  updateCounts();
}

function updateCounts() {
  elements.dbSize.textContent = String(db?.size || 0);
  elements.noteCount.textContent = String(state.notes.length);
  elements.searchCount.textContent = String(state.searchResults.length);
  elements.selectedLabel.textContent = state.selectedNoteId
    ? `Editing ${state.selectedNoteId}`
    : 'New note';
}

function populateForm(noteId) {
  const note = getNoteById(noteId);
  if (!note) {
    return;
  }

  state.selectedNoteId = noteId;
  elements.noteId.value = note.id;
  elements.noteTitle.value = note.title;
  elements.noteContent.value = note.content;
  elements.noteTags.value = note.tags.join(', ');
  elements.noteCategory.value = note.category;
  elements.noteStatus.value = note.status;
  elements.notePinned.value = String(note.pinned);
  updateCounts();
  setStatus(`Not duzenleme modunda: ${note.title}`);
}

function resetForm() {
  state.selectedNoteId = null;
  elements.noteForm.reset();
  elements.noteId.value = '';
  elements.noteCategory.value = 'work';
  elements.noteStatus.value = 'draft';
  elements.notePinned.value = 'false';
  updateCounts();
}

function upsertNoteInState(note) {
  const existingIndex = state.notes.findIndex((item) => item.id === note.id);
  if (existingIndex >= 0) {
    state.notes.splice(existingIndex, 1, note);
  } else {
    state.notes.push(note);
  }
  sortNotesInPlace();
}

function persistNotesState() {
  localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(state.notes));
}

async function syncIndexFromState() {
  db.clear();

  if (state.notes.length === 0) {
    return;
  }

  const entries = [];
  for (const note of state.notes) {
    const vector = await embedText(buildEmbeddingText(note));
    entries.push({ id: note.id, vector, metadata: serializeNoteToMetadata(note) });
  }

  db.upsert(entries);
}

function parseTags(rawValue) {
  return rawValue
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function getNoteById(noteId) {
  return state.notes.find((note) => note.id === noteId) || null;
}

function sortNotesInPlace() {
  state.notes.sort((left, right) => right.id.localeCompare(left.id));
}

function sortNotesCopy(notes) {
  return [...notes].sort((left, right) => right.id.localeCompare(left.id));
}

function hasActiveFilters(tagFilters, filter) {
  return tagFilters.length > 0 || Object.keys(filter).length > 0;
}

function formatDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function truncate(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}…`;
}

function resolveAssetUrl(relativePath) {
  if (typeof chrome !== 'undefined' && chrome?.runtime?.getURL) {
    return chrome.runtime.getURL(relativePath.replace(/^\.\.\//, ''));
  }

  return new URL(relativePath, import.meta.url).href;
}

function setStatus(message) {
  elements.status.textContent = message;
}

function setError(message) {
  elements.error.textContent = message;
}

function clearError() {
  elements.error.textContent = '';
}

async function withBusy(message, task) {
  if (state.busy) {
    return;
  }

  state.busy = true;
  toggleBusy(true);
  setStatus(message);

  try {
    await task();
  } catch (error) {
    console.error(error);
    setError(error.message || 'Beklenmeyen bir hata olustu.');
    setStatus('Islem tamamlanamadi.');
  } finally {
    state.busy = false;
    toggleBusy(false);
    updateCounts();
  }
}

function toggleBusy(isBusy) {
  [
    elements.saveNoteBtn,
    elements.resetFormBtn,
    elements.seedBtn,
    elements.saveDbBtn,
    elements.loadDbBtn,
    elements.clearMemoryBtn,
    elements.resetAllBtn,
    elements.runSearchBtn,
    elements.clearSearchBtn,
  ].forEach((button) => {
    button.disabled = isBusy;
    button.classList.toggle('is-loading', isBusy && button === elements.runSearchBtn);
  });
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const input = document.createElement('textarea');
  input.value = value;
  document.body.append(input);
  input.select();
  document.execCommand('copy');
  input.remove();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
