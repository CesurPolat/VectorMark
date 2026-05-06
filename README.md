# 🚀 VectorMark

**VectorMark — Smart bookmark manager that automatically categorizes and organizes your saved websites using semantic search.**

A **local-first Chrome extension** that transforms your bookmarks into a searchable, intelligent knowledge base.

---

## ✨ Features

* 🧠 **Semantic Search**
  Find bookmarks by meaning, not just keywords.

* 🤖 **Automatic Categorization**
  Links are grouped automatically using vector similarity.

* ⚡ **Fast Local Vector Search (HNSW)**
  Powered by VecLite for efficient ANN search.

* 🔒 **100% Local & Privacy-First**
  No cloud, no tracking — everything stays in your browser.

* 🧩 **Rich Bookmark Data**
  Store more than just URLs (metadata, content, embeddings).

---

## 🧠 How It Works

VectorMark turns your bookmarks into vectors and enables semantic search:

1. Extract page content / metadata
2. Generate embeddings using a local model
3. Store vectors in IndexedDB via VecLite
4. Perform fast similarity search using HNSW

---

## 🛠️ Tech Stack

* **Platform:** Chrome Extension
* **Vector DB:** VecLite (IndexedDB + HNSW)
* **Storage Layer:** IndexedDB (Dexie.js)
* **Embeddings:** Local model
* **Search:** Approximate Nearest Neighbor (ANN)

---

## 🚀 Getting Started

### Installation

```bash
git clone https://github.com/yourusername/vectormark.git
cd vectormark
npm install
```

### Run (Development)

```bash
npm run dev
```

### Load Extension

1. Open Chrome
2. Go to `chrome://extensions/`
3. Enable **Developer Mode**
4. Click **Load unpacked**
5. Select the project folder

---

## 📦 Project Structure

```
/src        → extension source code
/db         → vector + IndexedDB logic
/lib        → utilities / embedding logic
/components → UI components
```

---

## 🔍 Why VectorMark?

Traditional bookmark managers rely on folders and keywords.

VectorMark uses **semantic understanding**:

* Search *“machine learning tutorials”* → finds relevant pages even if exact words don't match
* Automatically clusters similar content
* No manual tagging required

---

## 🧩 Use Cases

* 📚 Researchers managing hundreds of sources
* 🧑‍💻 Developers saving technical resources
* 🧠 Personal knowledge management

---

## 🔌 Roadmap

* [ ] Smart tagging suggestions
* [ ] Duplicate detection
* [ ] Import from Chrome bookmarks
* [ ] Improved local embedding models
* [ ] UI/UX improvements

---

## 🤝 Contributing

Pull requests are welcome.
For major changes, open an issue first.

---

## 📄 License

<!-- Add your license (MIT recommended) -->

---

## ⭐ Support

If you like this project, give it a star ⭐
