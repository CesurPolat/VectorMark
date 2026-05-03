/**
 * Test initialization script for VectorMark test documents.
 * Handles module imports and makes test utilities globally accessible.
 */

import { runLanceDBTests } from './lancedbTestRunner.js';
import('./test.js');

// Make test runner available globally for browser console
window.runLanceDBTests = runLanceDBTests;

console.log('[VectorMark Tests] Initialized. Run window.runLanceDBTests() to execute test suite.');
