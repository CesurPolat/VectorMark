import '../node_modules/dexie/dist/dexie.min.js';

const db = new Dexie('VectorMarkBrowserVectorDemo');

db.version(1).stores({
  testDocuments: '&id, createdAt, status, updatedAt'
});

function normalizeVector(vector) {
  return Array.isArray(vector) ? vector.map((value) => Number(value) || 0) : [];
}

function cosineSimilarity(left, right) {
  if (!left.length || left.length !== right.length) {
    return -1;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = Number(left[index]) || 0;
    const rightValue = Number(right[index]) || 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (!leftMagnitude || !rightMagnitude) {
    return -1;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

export async function countIndexedDocuments() {
  return await db.testDocuments.count();
}

export async function clearIndexedDocuments() {
  await db.testDocuments.clear();
}

export async function upsertIndexedDocuments(documents) {
  const now = Date.now();
  const rows = documents.map((documentItem) => ({
    id: String(documentItem.id),
    title: String(documentItem.title || ''),
    content: String(documentItem.content || ''),
    createdAt: String(documentItem.createdAt || ''),
    tags: Array.isArray(documentItem.tags) ? documentItem.tags.map((tag) => String(tag)) : [],
    status: String(documentItem.status || ''),
    documentText: String(documentItem.documentText || ''),
    embedding: normalizeVector(documentItem.embedding),
    updatedAt: now
  }));

  await db.testDocuments.bulkPut(rows);
  return rows.length;
}

export async function queryIndexedDocuments(queryEmbedding, limit = 5) {
  const normalizedQuery = normalizeVector(queryEmbedding);
  const records = await db.testDocuments.toArray();

  return records
    .map((record) => ({
      ...record,
      score: cosineSimilarity(normalizedQuery, normalizeVector(record.embedding))
    }))
    .filter((record) => Number.isFinite(record.score) && record.score >= 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, Number(limit) || 5));
}
