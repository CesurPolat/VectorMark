<img width="1536" height="1024" alt="ChatGPT Image 10 May 2026 23_55_51" src="https://github.com/user-attachments/assets/7ebd5456-8114-43a7-8648-1169302c111f" />

# 🚀 VectorMark

**VectorMark — Smart bookmark manager that automatically categorizes and organizes your saved websites using semantic search.**

A **local-first Chrome extension** that transforms your bookmarks into a searchable, intelligent knowledge base.

### ✨ Features

* 🧠 **Fast Semantic Search (HNSW)**
  Find bookmarks by meaning using efficient local vector search powered by VecLite.

* 🔒 **100% Local & Privacy-First**
  No cloud, no tracking — everything stays in your browser.

---

## 🔌 Roadmap

* [ ] Rich bookmark data support (metadata, content)
* [ ] Automatic categorization using vector similarity

---

## 🛠️ Tech Stack

* **Platform:** Chrome Extension
* **Vector DB:** VecLite (IndexedDB + HNSW)
* **Storage Layer:** IndexedDB (Dexie.js)
* **Embeddings:** Local model (all-MiniLM-L6-v2)

---

## 🚀 Getting Started

### Installation

```bash
git clone https://github.com/yourusername/vectormark.git
cd vectormark
npm install
```

### Build

```bash
npm run build
```

### Load Extension

1. Open Chrome
2. Go to `chrome://extensions/`
3. Enable **Developer Mode**
4. Click **Load unpacked**
5. Select the project' **dist** folder

---

## 🤝 Contributing & Support

Pull requests are welcome.  
For major changes, please open an issue first to discuss what you would like to change.

If you like this project, consider giving it a star ⭐

### 📄 License: MIT License
