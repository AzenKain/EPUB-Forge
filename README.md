# EPUBForge ⚒️

A cross-platform, all-in-one EPUB toolkit and workspace. Re-engineered from a simple volume splitter into a powerful suite for merging, splitting, metadata tuning, and rich-text/HTML chapter editing.

Built with a high-performance **Go backend** and a modern, high-fidelity **React frontend** embedded directly into a self-contained executable.

---

## 🌟 Key Features

- **📁 Workspace Management**: Scans and manages EPUB books from the dedicated `edit/` folder. Open/add books from your system and delete them directly from the UI. No longer pollutes your root directory.
- **⚒️ Advanced Volume Splitter**: Split massive EPUB books into custom volumes. Automatically detects volume boundaries, lets you assign individual covers (uploaded, web URLs, or internal assets), and cleans up unused dependencies so output volumes stay compact.
- **🏷️ Metadata Controller**: Read and write metadata (Title, Author, Publisher, Language, Description, Subjects/Tags) directly to files in the workspace.
- **🔗 Smart EPUB Merger**: Merge multiple EPUB files sequentially into a single file with unified metadata and combined Table of Contents (TOC).
- **✍️ Dual-Engine Chapter Editor**:
  - **Visual WYSIWYG Editor**: Write, edit, and style chapters directly with clean typography and layout preservation.
  - **Syntax-Highlighted HTML Code Editor**: Write precise HTML with raw, real-time XML/HTML syntax highlighting, custom indent options, and scroll syncing.
  - **🇻🇳 Vietnamese Typography Normalizer**: Auto-correct spacing, smart curly quotes (“...”), and modern tone mark placements (e.g., `hoà` -> `hòa`) in both visual/code editors and bulk book optimizations.
- **🖼️ Image Cover Studio**: Configure covers per-volume. Choose between local file upload, pasting direct web URLs, or selecting high-resolution illustration assets straight from inside the book.
- **🎨 Custom Illustration Gallery**: Select specific images inside the book, drag-and-drop to reorder them, write custom captions, and compile them into a beautifully structured, compliant `gallery.xhtml` page with automated manifest & TOC registration.
- **📖 Pre-paginated Manga EPUB Builder**: A dedicated dashboard to upload manga or comic images, arrange their order, select reading direction (RTL/LTR), and export them as professional, pre-paginated fixed-layout Manga EPUBs.
- **🔌 Extensible Script Runner (Extension Center)**: Run custom Javascript scraper extensions (`.js` files inside the `extensions/` directory) to crawl web novels and compile them into EPUBs directly.
  - **Headless Browser Control**: Runs on a stealth headless browser powered by Go-Rod.
  - **Cloudflare Bypass & Captcha Solver**: Stream screenshots of Cloudflare turnstile and captchas into the React modal. Solves interactive triggers by clicking or typing text inputs directly inside the UI.
  - **Multi-Volume Support**: Generates multiple EPUB volumes at once (e.g. for series divided into multiple volumes/vols) depending on the extension return values.
- **⚡ Native Performance**: Built on Go's lightning-fast ZIP streaming and DOM parsing engine. Works offline, completely self-contained.

---

## 🚀 Running the Native Application

### 1. Build for Your Target Platform(s)
To compile the React web UI and bundle it directly into a single self-contained native executable, use the corresponding command:

* **Windows (AMD64 & ARM64):**
    ```bash
    npm run native:build
    ```
* **macOS (Intel & Apple Silicon):**
    ```bash
    npm run native:build:mac
    ```
* **Linux (AMD64 & ARM64):**
    ```bash
    npm run native:build:linux
    ```
* **All Platforms:**
    ```bash
    npm run native:build:all
    ```

The output binaries will be placed in the `dist-native/` directory.

### 2. Launch the Application
Run the generated executable for your platform:

* **Windows (Intel/AMD x64):**
    ```powershell
    .\dist-native\epubforge-windows-amd64.exe
    ```
* **Windows (ARM64):**
    ```powershell
    .\dist-native\epubforge-windows-arm64.exe
    ```
* **macOS (Intel):**
    ```bash
    chmod +x ./dist-native/epubforge-darwin-amd64
    ./dist-native/epubforge-darwin-amd64
    ```
* **macOS (Apple Silicon / M-Series):**
    ```bash
    chmod +x ./dist-native/epubforge-darwin-arm64
    ./dist-native/epubforge-darwin-arm64
    ```
* **Linux (AMD64):**
    ```bash
    chmod +x ./dist-native/epubforge-linux-amd64
    ./dist-native/epubforge-linux-amd64
    ```
* **Linux (ARM64):**
    ```bash
    chmod +x ./dist-native/epubforge-linux-arm64
    ./dist-native/epubforge-linux-arm64
    ```

*Note: The app automatically starts the native web server, launches your default web browser, and loads the workspace interface at `http://127.0.0.1:5180`.*

---

## 🛠️ Local Development

### React Web UI Development (HMR Enabled)
To run the high-fidelity UI server with Hot Module Replacement (HMR) for frontend-only iteration:
```bash
npm run dev
```

### Native Go Server with React Production Build
To test the full Go-embedded React production pipeline locally:
```bash
# 1. Compile frontend assets to cmd/epubforge/dist
npm run build

# 2. Run the Go server directly using local files
npm run native
```

---

## 🔌 Custom Extensions

You can write custom Javascript crawler extensions to scrape external sites and automatically generate EPUB books.

For full developer instructions on extension structure, inputs schema, browser control APIs, and return format, see the [Extension Developer Guide](file:///e:/epub_forge/EXTENSION_GUIDE.md).

---

## 📖 Developer & AI Agent Documentation

To assist future AI agents (GPT, Claude, Gemini) and developers in maintaining this repository, we have established a dedicated docs folder with the following reference materials:

- **[Project Architecture Guide](file:///e:/epub_forge/docs/architecture.md)**: Cấu trúc thư mục, thiết kế module Backend Go & Frontend React, và sơ đồ giao tiếp dữ liệu.
- **[Performance Optimizations](file:///e:/epub_forge/docs/optimizations.md)**: Chi tiết cơ chế Overlay Cache, Background Threading, Reader caching, và các giải pháp chống nghẽn I/O.
- **[Coding & AI Guidelines](file:///e:/epub_forge/docs/guidelines.md)**: Quy chuẩn viết code, phòng tránh lỗi ZIP Lock/Directory và hướng dẫn chạy benchmark kiểm thử.

---

## 📁 Project Architecture

```
epubforge/
├── cmd/epubforge/          # Main application entry point; embeds production UI files
├── dist-native/            # Compiled standalone executables for all platforms
├── docs/                   # Developer documentation & AI agent context
├── internal/
│   ├── controller/         # Fiber-like request parsing and HTTP responders
│   ├── models/             # Shared request, response, and domain models
│   ├── router/             # HTTP route and static asset handling
│   ├── service/            # Core EPUB engine (parsing, merging, splitting, cover generation)
│   └── utils/              # Base OS, filesystem, and networking helpers
├── scripts/
│   └── build.js            # Cross-platform Node.js build system script
├── src/
│   ├── components/         # Modular React UI workspace panels and modals
│   ├── lib/                # API client adapters and helper utilities
│   ├── main.tsx            # Main React SPA bootstrap file
│   └── styles.css          # Design system tokens and interface styling
```
