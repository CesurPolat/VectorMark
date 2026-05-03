/**
 * LanceDB-based vector store for test documents.
 * Replaces Dexie with LanceDB for advanced vector search, SQL filtering, and metadata indexing.
 * API mirrors browserVectorStore.js for drop-in compatibility.
 */

import {
  isExtensionContext,
  getDatabaseName,
  getTableName,
  getStorageBackend,
  configureLanceDBEnvironment
} from './lancedbConfig.js';

// LanceDB connection (singleton pattern)
let dbConnection = null;
let tableReference = null;
let isInitialized = false;
let useFallback = false;
let fallbackStore = null;
let storeMode = 'lancedb';

function isCjsExportError(error) {
  return /exports is not defined/i.test(error?.message || '');
}

async function getFallbackStore() {
  if (!fallbackStore) {
    fallbackStore = await import('./browserVectorStore.js');
  }
  return fallbackStore;
}

/**
 * Initialize LanceDB connection and create/validate table schema.
 * @returns {Promise<Object>} Connection object
 */
export async function initLanceDB() {
  if (isInitialized && dbConnection && tableReference) {
    return { connection: dbConnection, table: tableReference, status: 'already_initialized' };
  }

  if (useFallback) {
    return { connection: null, table: null, status: 'fallback' };
  }

  try {
    // Configure environment
    await configureLanceDBEnvironment();

    // Import LanceDB main module
    let lancedb;
    if (isExtensionContext()) {
      // In extension context, try to use global if available, otherwise import
      if (globalThis.lancedb) {
        lancedb = globalThis.lancedb;
      } else {
        try {
          const module = await import('../node_modules/@lancedb/lancedb/dist/index.js');
          lancedb = module.default || module;
        } catch (error) {
          if (isCjsExportError(error)) {
            console.warn('[LanceDB] Browser environment does not support the Node-only package. Falling back to Dexie store.');
            useFallback = true;
            storeMode = 'fallback';
            return { connection: null, table: null, status: 'fallback' };
          }
          console.warn('[LanceDB] ESM import failed in extension context:', error);
          throw error;
        }
      }
    } else {
      const module = await import('../node_modules/@lancedb/lancedb/dist/index.js');
      lancedb = module.default || module;
    }

    const backend = await getStorageBackend();
    const dbName = getDatabaseName();
    const tableName = getTableName();

    // Connect to database
    let connection;
    if (backend === 'opfs') {
      // Use Origin Private File System for larger storage
      try {
        const dir = await navigator.storage.getDirectory();
        connection = await lancedb.connect(dir);
        console.log('[LanceDB] Connected with OPFS backend');
      } catch (error) {
        console.warn('[LanceDB] OPFS connection failed, falling back to IndexedDB:', error);
        connection = await lancedb.connect(dbName);
      }
    } else {
      // Use IndexedDB (default)
      connection = await lancedb.connect(dbName);
      console.log('[LanceDB] Connected with IndexedDB backend');
    }

    // Try to create or open table
    // First, attempt to open existing table
    try {
      tableReference = await connection.openTable(tableName);
      console.log(`[LanceDB] Opened existing table: ${tableName}`);
    } catch (error) {
      // Table doesn't exist yet - will be created on first insert
      console.log(`[LanceDB] Table will be created on first insert: ${tableName}`);
      tableReference = null; // Will be created dynamically
    }

    dbConnection = connection;
    isInitialized = true;

    console.log('[LanceDB] Initialization complete');
    return { connection: dbConnection, table: tableReference, status: 'initialized' };
  } catch (error) {
    console.error('[LanceDB] Initialization failed:', error);
    isInitialized = false;
    throw error;
  }
}

/**
 * Ensure LanceDB is initialized before operations.
 * @returns {Promise<Object>}
 */
async function ensureInitialized() {
  if (useFallback) {
    return { connection: null, table: null, status: 'fallback' };
  }
  if (!isInitialized || !dbConnection || !tableReference) {
    return await initLanceDB();
  }
  return { connection: dbConnection, table: tableReference };
}

/**
 * Normalize vector to array of numbers.
 * @param {Array|Float32Array} vector
 * @returns {number[]}
 */
function normalizeVector(vector) {
  if (!vector) return [];
  if (Array.isArray(vector)) return vector.map(v => Number(v) || 0);
  if (vector instanceof Float32Array) return Array.from(vector);
  return [];
}

/**
 * Calculate cosine similarity between two vectors.
 * @param {number[]} left
 * @param {number[]} right
 * @returns {number} Similarity score in range [0, 1]
 */
function cosineSimilarity(left, right) {
  const a = normalizeVector(left);
  const b = normalizeVector(right);

  if (!a.length || a.length !== b.length) {
    return -1;
  }

  let dot = 0;
  let aMagnitude = 0;
  let bMagnitude = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aMagnitude += a[i] * a[i];
    bMagnitude += b[i] * b[i];
  }

  if (!aMagnitude || !bMagnitude) {
    return -1;
  }

  return dot / (Math.sqrt(aMagnitude) * Math.sqrt(bMagnitude));
}

/**
 * Count total indexed documents.
 * @returns {Promise<number>}
 */
export async function countIndexedDocuments() {
  if (useFallback) {
    const store = await getFallbackStore();
    return await store.countIndexedDocuments();
  }
  try {
    const { connection } = await ensureInitialized();
    const tableName = getTableName();
    
    // Try to get the table
    try {
      if (!tableReference) {
        tableReference = await connection.openTable(tableName);
      }
      
      // Fetch all records to count (LanceDB doesn't have a direct count method)
      const allRecords = await tableReference.search().toList();
      return allRecords.length;
    } catch (error) {
      // Table doesn't exist yet
      console.log('[LanceDB] Table does not exist yet');
      return 0;
    }
  } catch (error) {
    console.warn('[LanceDB] Count failed:', error);
    return 0;
  }
}

/**
 * Clear all indexed documents and recreate table.
 * @returns {Promise<void>}
 */
export async function clearIndexedDocuments() {
  if (useFallback) {
    const store = await getFallbackStore();
    await store.clearIndexedDocuments();
    return;
  }
  try {
    const { connection } = await ensureInitialized();
    const tableName = getTableName();

    // Delete existing table
    try {
      await connection.dropTable(tableName);
    } catch (error) {
      console.log('[LanceDB] Table drop failed (may not exist):', error.message);
    }

    // Reset references
    tableReference = null;

    // Reinitialize
    await initLanceDB();
    console.log('[LanceDB] Cleared all documents');
  } catch (error) {
    console.error('[LanceDB] Clear failed:', error);
    throw error;
  }
}

/**
 * Upsert documents with embeddings into LanceDB.
 * @param {Array<{id, title, content, documentText, embedding, tags, status, createdAt}>} documents
 * @returns {Promise<number>} Number of documents inserted/updated
 */
export async function upsertIndexedDocuments(documents) {
  if (useFallback) {
    const store = await getFallbackStore();
    return await store.upsertIndexedDocuments(documents);
  }
  try {
    const { connection } = await ensureInitialized();

    if (!Array.isArray(documents) || documents.length === 0) {
      return 0;
    }

    const now = Date.now();
    const tableName = getTableName();
    
    const rows = documents.map(doc => ({
      id: String(doc.id || ''),
      title: String(doc.title || ''),
      content: String(doc.content || ''),
      documentText: String(doc.documentText || ''),
      embedding: normalizeVector(doc.embedding),
      tags: Array.isArray(doc.tags) ? doc.tags.map(t => String(t)) : [],
      status: String(doc.status || ''),
      createdAt: String(doc.createdAt || ''),
      updatedAt: now
    }));

    // Create or get table
    try {
      if (!tableReference) {
        // Try to open existing table
        tableReference = await connection.openTable(tableName);
      }
      // Add data to existing table
      await tableReference.add(rows);
    } catch (error) {
      // Table doesn't exist, create it
      console.log('[LanceDB] Creating table on first insert');
      tableReference = await connection.createTable(tableName, rows, { mode: 'overwrite' });
    }

    console.log(`[LanceDB] Upserted ${rows.length} document(s)`);
    return rows.length;
  } catch (error) {
    console.error('[LanceDB] Upsert failed:', error);
    throw error;
  }
}

/**
 * Query documents by vector similarity with optional metadata filtering.
 * @param {number[]} queryEmbedding - Query vector
 * @param {number} limit - Max results to return
 * @param {Object} filter - Optional metadata filters {status?, createdAtMin?, createdAtMax?, tags?}
 * @returns {Promise<Array>} Ranked results with scores
 */
export async function queryIndexedDocuments(queryEmbedding, limit = 5, filter = null) {
  if (useFallback) {
    const store = await getFallbackStore();
    return await store.queryIndexedDocuments(queryEmbedding, limit);
  }
  try {
    const { table } = await ensureInitialized();

    if (!table) {
      return [];
    }

    const normalizedQuery = normalizeVector(queryEmbedding);
    if (normalizedQuery.length === 0) {
      return [];
    }

    const safeLimit = Math.max(1, Number(limit) || 5);

    try {
      // Try vector search with LanceDB native method
      let query = table.search(normalizedQuery);

      // Apply metadata filters if provided
      if (filter) {
        const whereConditions = [];

        if (filter.status) {
          whereConditions.push(`status = '${escapeSQL(filter.status)}'`);
        }

        if (filter.createdAtMin) {
          whereConditions.push(`createdAt >= '${escapeSQL(filter.createdAtMin)}'`);
        }

        if (filter.createdAtMax) {
          whereConditions.push(`createdAt <= '${escapeSQL(filter.createdAtMax)}'`);
        }

        if (filter.tags && Array.isArray(filter.tags) && filter.tags.length > 0) {
          const tagConditions = filter.tags.map(tag => `tags LIKE '%${escapeSQL(tag)}%'`).join(' OR ');
          whereConditions.push(`(${tagConditions})`);
        }

        if (whereConditions.length > 0) {
          const whereClause = whereConditions.join(' AND ');
          query = query.where(whereClause);
        }
      }

      // Set limit and execute search
      const results = await query.limit(safeLimit * 2).toList(); // Fetch more for post-filtering

      // Calculate similarity scores for results
      const scored = results.map(record => ({
        ...record,
        score: cosineSimilarity(normalizedQuery, normalizeVector(record.embedding))
      }))
        .filter(record => Number.isFinite(record.score) && record.score >= 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, safeLimit);

      return scored;
    } catch (error) {
      // Fallback: retrieve all documents and filter in memory
      console.warn('[LanceDB] Native vector search failed, using fallback:', error.message);
      return await queryIndexedDocumentsFallback(normalizedQuery, safeLimit, filter);
    }
  } catch (error) {
    console.error('[LanceDB] Query failed:', error);
    return [];
  }
}

/**
 * Fallback vector query using in-memory filtering.
 * Used if LanceDB native vector search is unavailable.
 * @private
 */
async function queryIndexedDocumentsFallback(queryEmbedding, limit, filter) {
  try {
    const { table } = await ensureInitialized();
    
    // Fetch all records
    let allRecords = [];
    try {
      allRecords = await table.search().toList();
    } catch (error) {
      console.warn('[LanceDB] Fallback retrieval failed:', error);
      return [];
    }

    // Apply filters
    let filtered = allRecords;

    if (filter?.status) {
      filtered = filtered.filter(r => r.status === filter.status);
    }

    if (filter?.createdAtMin) {
      filtered = filtered.filter(r => r.createdAt >= filter.createdAtMin);
    }

    if (filter?.createdAtMax) {
      filtered = filtered.filter(r => r.createdAt <= filter.createdAtMax);
    }

    if (filter?.tags && Array.isArray(filter.tags) && filter.tags.length > 0) {
      filtered = filtered.filter(r => {
        const docTags = Array.isArray(r.tags) ? r.tags : [];
        return filter.tags.some(tag => docTags.includes(tag));
      });
    }

    // Score and rank
    const scored = filtered
      .map(record => ({
        ...record,
        score: cosineSimilarity(queryEmbedding, normalizeVector(record.embedding))
      }))
      .filter(record => Number.isFinite(record.score) && record.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored;
  } catch (error) {
    console.error('[LanceDB] Fallback query failed:', error);
    return [];
  }
}

/**
 * Escape SQL string literals to prevent injection.
 * @private
 */
function escapeSQL(str) {
  return String(str || '').replace(/'/g, "''");
}

/**
 * Get document count by status.
 * @param {string} status
 * @returns {Promise<number>}
 */
export async function countByStatus(status) {
  if (useFallback) {
    console.warn('[LanceDB] countByStatus is not available in fallback mode.');
    return 0;
  }
  try {
    const { table } = await ensureInitialized();
    const results = await table.search().where(`status = '${escapeSQL(status)}'`).toList();
    return results.length;
  } catch (error) {
    console.warn('[LanceDB] Count by status failed:', error);
    return 0;
  }
}

/**
 * Get all unique statuses in the store.
 * @returns {Promise<string[]>}
 */
export async function getUniqueStatuses() {
  if (useFallback) {
    console.warn('[LanceDB] getUniqueStatuses is not available in fallback mode.');
    return [];
  }
  try {
    const { table } = await ensureInitialized();
    const allRecords = await table.search().toList();
    const statuses = [...new Set(allRecords.map(r => r.status).filter(Boolean))];
    return statuses;
  } catch (error) {
    console.warn('[LanceDB] Get unique statuses failed:', error);
    return [];
  }
}

/**
 * Get database and table names for debugging.
 * @returns {Object}
 */
export function getStoreInfo() {
  return {
    storeMode,
    isInitialized,
    database: getDatabaseName(),
    table: getTableName(),
    hasConnection: !!dbConnection,
    hasTable: !!tableReference
  };
}
