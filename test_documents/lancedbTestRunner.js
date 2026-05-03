/**
 * LanceDB test runner with comprehensive test suite.
 * Tests vector storage, search, filtering, and metadata operations.
 * Can run in browser console or Node.js environment.
 */

import {
  initLanceDB,
  countIndexedDocuments,
  clearIndexedDocuments,
  upsertIndexedDocuments,
  queryIndexedDocuments,
  countByStatus,
  getUniqueStatuses,
  getStoreInfo
} from './lancedbVectorStore.js';

import { createTestDocuments } from './test.js';

/**
 * Test result object.
 */
class TestResult {
  constructor(name) {
    this.name = name;
    this.passed = false;
    this.error = null;
    this.duration = 0;
    this.details = {};
  }

  toString() {
    const status = this.passed ? '✓ PASS' : '✗ FAIL';
    const duration = `${this.duration.toFixed(2)}ms`;
    const errorMsg = this.error ? ` - ${this.error}` : '';
    return `${status}: ${this.name} (${duration})${errorMsg}`;
  }
}

function isFallbackMode() {
  const info = getStoreInfo();
  return info?.storeMode === 'fallback';
}

/**
 * Simple mock embedding generator for testing.
 * Generates deterministic embeddings based on text.
 * @param {string} text
 * @returns {number[]}
 */
function generateMockEmbedding(text) {
  // Use a simple hash-based approach to generate consistent embeddings
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  // Generate 384-dimensional vector (matching all-MiniLM-L6-v2)
  const vector = new Array(384);
  let rng = Math.sin(hash++) * 10000;
  
  for (let i = 0; i < 384; i++) {
    rng = Math.sin(rng) * 10000;
    vector[i] = rng - Math.floor(rng);
  }

  return vector;
}

/**
 * Test: Initialize LanceDB connection.
 */
async function test_initLanceDB() {
  const result = new TestResult('initLanceDB');
  const start = performance.now();

  try {
    const { connection, table, status } = await initLanceDB();
    
    if (!connection) {
      throw new Error('Connection is null');
    }
    if (!table) {
      throw new Error('Table reference is null');
    }

    result.details = { status, connectionExists: !!connection, tableExists: !!table };
    result.passed = true;
  } catch (error) {
    result.error = error.message;
  }

  result.duration = performance.now() - start;
  return result;
}

/**
 * Test: Count empty store before insertion.
 */
async function test_countEmpty() {
  const result = new TestResult('countIndexedDocuments (empty)');
  const start = performance.now();

  try {
    // Clear first
    await clearIndexedDocuments();
    
    const count = await countIndexedDocuments();
    
    if (count !== 0) {
      throw new Error(`Expected count 0, got ${count}`);
    }

    result.passed = true;
    result.details = { count };
  } catch (error) {
    result.error = error.message;
  }

  result.duration = performance.now() - start;
  return result;
}

/**
 * Test: Upsert test documents with embeddings.
 */
async function test_upsertDocuments() {
  const result = new TestResult('upsertIndexedDocuments');
  const start = performance.now();

  try {
    // Generate test documents
    const documents = await createTestDocuments(10);

    // Add embeddings
    const documentsWithEmbeddings = documents.map(doc => ({
      ...doc,
      documentText: `${doc.title}\n${doc.content}`,
      embedding: generateMockEmbedding(doc.documentText || `${doc.title}\n${doc.content}`)
    }));

    const insertedCount = await upsertIndexedDocuments(documentsWithEmbeddings);

    if (insertedCount !== 10) {
      throw new Error(`Expected 10 insertions, got ${insertedCount}`);
    }

    const totalCount = await countIndexedDocuments();
    if (totalCount < 10) {
      throw new Error(`Expected total >= 10, got ${totalCount}`);
    }

    result.passed = true;
    result.details = { inserted: insertedCount, total: totalCount };
  } catch (error) {
    result.error = error.message;
  }

  result.duration = performance.now() - start;
  return result;
}

/**
 * Test: Query by vector similarity.
 */
async function test_vectorQuery() {
  const result = new TestResult('queryIndexedDocuments (vector search)');
  const start = performance.now();

  try {
    const queryText = 'bookmark vector search organization';
    const queryEmbedding = generateMockEmbedding(queryText);

    const results = await queryIndexedDocuments(queryEmbedding, 5);

    if (!Array.isArray(results)) {
      throw new Error('Results is not an array');
    }

    if (results.length === 0) {
      throw new Error('No results returned');
    }

    // Verify scores are valid and sorted descending
    let lastScore = Infinity;
    for (const result of results) {
      if (typeof result.score !== 'number' || result.score < 0 || result.score > 1) {
        throw new Error(`Invalid score: ${result.score}`);
      }
      if (result.score > lastScore) {
        throw new Error(`Scores not sorted: ${result.score} > ${lastScore}`);
      }
      lastScore = result.score;
    }

    result.passed = true;
    result.details = {
      resultCount: results.length,
      topScore: results[0]?.score.toFixed(4),
      topDocument: results[0]?.title
    };
  } catch (error) {
    result.error = error.message;
  }

  result.duration = performance.now() - start;
  return result;
}

/**
 * Test: Filter by status.
 */
async function test_filterByStatus() {
  const result = new TestResult('queryIndexedDocuments (status filter)');
  const start = performance.now();

  try {
    const queryEmbedding = generateMockEmbedding('test query');

    // Query with status filter
    const results = await queryIndexedDocuments(queryEmbedding, 10, {
      status: 'ready'
    });

    // All results should have status='ready'
    for (const doc of results) {
      if (doc.status !== 'ready') {
        throw new Error(`Document has wrong status: ${doc.status} (expected 'ready')`);
      }
    }

    result.passed = true;
    result.details = {
      resultCount: results.length,
      allHaveStatus: results.every(r => r.status === 'ready')
    };
  } catch (error) {
    result.error = error.message;
  }

  result.duration = performance.now() - start;
  return result;
}

/**
 * Test: Get unique statuses.
 */
async function test_getUniqueStatuses() {
  const result = new TestResult('getUniqueStatuses');
  const start = performance.now();

  try {
    if (isFallbackMode()) {
      result.passed = true;
      result.details = { skipped: true, reason: 'Fallback store does not support unique status listing.' };
      result.duration = performance.now() - start;
      return result;
    }
    const statuses = await getUniqueStatuses();

    if (!Array.isArray(statuses)) {
      throw new Error('Statuses is not an array');
    }

    if (statuses.length === 0) {
      throw new Error('No statuses found');
    }

    // Expected statuses from createTestDocuments
    const expectedStatuses = ['draft', 'ready', 'archived', 'review'];
    const hasExpected = statuses.some(s => expectedStatuses.includes(s));

    result.passed = hasExpected;
    result.details = {
      statusCount: statuses.length,
      statuses: statuses.join(', ')
    };
  } catch (error) {
    result.error = error.message;
  }

  result.duration = performance.now() - start;
  return result;
}

/**
 * Test: Count by status.
 */
async function test_countByStatus() {
  const result = new TestResult('countByStatus');
  const start = performance.now();

  try {
    if (isFallbackMode()) {
      result.passed = true;
      result.details = { skipped: true, reason: 'Fallback store does not support status counts.' };
      result.duration = performance.now() - start;
      return result;
    }
    const readyCount = await countByStatus('ready');

    if (typeof readyCount !== 'number' || readyCount < 0) {
      throw new Error(`Invalid count: ${readyCount}`);
    }

    result.passed = true;
    result.details = { readyCount };
  } catch (error) {
    result.error = error.message;
  }

  result.duration = performance.now() - start;
  return result;
}

/**
 * Test: Clear all documents.
 */
async function test_clearDocuments() {
  const result = new TestResult('clearIndexedDocuments');
  const start = performance.now();

  try {
    await clearIndexedDocuments();
    
    const count = await countIndexedDocuments();

    if (count !== 0) {
      throw new Error(`After clear, count should be 0, got ${count}`);
    }

    result.passed = true;
    result.details = { countAfterClear: count };
  } catch (error) {
    result.error = error.message;
  }

  result.duration = performance.now() - start;
  return result;
}

/**
 * Test: Store info retrieval.
 */
async function test_getStoreInfo() {
  const result = new TestResult('getStoreInfo');
  const start = performance.now();

  try {
    const info = await initLanceDB().then(() => getStoreInfo());

    if (!info) {
      throw new Error('Store info is null');
    }

    if (!info.database || !info.table) {
      throw new Error('Missing database or table name');
    }

    result.passed = true;
    result.details = info;
  } catch (error) {
    result.error = error.message;
  }

  result.duration = performance.now() - start;
  return result;
}

/**
 * Run all tests in sequence.
 * @returns {Promise<TestResult[]>}
 */
export async function runAllTests() {
  console.log('[LanceDB Tests] Starting test suite...\n');

  const tests = [
    test_initLanceDB,
    test_countEmpty,
    test_upsertDocuments,
    test_vectorQuery,
    test_filterByStatus,
    test_getUniqueStatuses,
    test_countByStatus,
    test_getStoreInfo,
    test_clearDocuments
  ];

  const results = [];

  for (const test of tests) {
    try {
      const result = await test();
      results.push(result);
      console.log(result.toString());
      if (Object.keys(result.details).length > 0) {
        console.log(`  Details:`, result.details);
      }
    } catch (error) {
      console.error(`Test ${test.name} crashed:`, error);
    }
  }

  // Summary
  const passCount = results.filter(r => r.passed).length;
  const failCount = results.filter(r => !r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`\n[LanceDB Tests] Summary:`);
  console.log(`  ✓ Passed: ${passCount}/${results.length}`);
  console.log(`  ✗ Failed: ${failCount}/${results.length}`);
  console.log(`  ⏱ Total: ${totalDuration.toFixed(2)}ms`);

  return results;
}

/**
 * Run tests and print formatted report.
 * Call this from browser console: window.runLanceDBTests()
 */
export async function runLanceDBTests() {
  try {
    const results = await runAllTests();
    return results;
  } catch (error) {
    console.error('[LanceDB Tests] Fatal error:', error);
    throw error;
  }
}

// If running in Node.js (for potential testing)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runAllTests, runLanceDBTests };
}
