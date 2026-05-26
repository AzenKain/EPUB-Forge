# AI & Human Developer Coding Guidelines

This guide details strict development standards, architectural rules, coding patterns, compilation methods, and testing workflows required when working on **EPUBForge**.

---

## 🤖 Prompt for Future AI Agents (Onboarding Instructions)

> [!IMPORTANT]
> When modifying this codebase:
> 1. **Prioritize Performance**: Never write code that performs synchronous heavy disk writes (like rebuilding a ZIP file) inside an HTTP request lifecycle. Always use or update the Overlay Filesystem Cache and background writer.
> 2. **Check the Docs First**: Read [docs/architecture.md](file:///e:/epub_forge/docs/architecture.md) and [docs/optimizations.md](file:///e:/epub_forge/docs/optimizations.md) before designing changes.
> 3. **Verify Performance**: Run the benchmark script `go run scratch/benchmark_save.go` after making changes to save handlers to verify average save times remain < 20ms and that verification succeeds.
> 4. **Check for Windows Compatibility**: Ensure file operations do not lock files, and handle Windows sharing violations by closing readers before file replacements.
> 5. **Preserve Caching Systems**: When editing loading logic, do not bypass `bookCache`, `titleCache`, or `zipReaderCache` maps. Keep them thread-safe under their respective mutexes.

---

## 🚫 Crucial Code Constraints & Antipatterns

### 1. Never Write Directory Entries to ZIP Writers
- **Issue**: Writing directories (e.g. folders like `OEBPS/Text/`) into a ZIP writer raises `zip: write to directory` in Go when updating the EPUB files.
- **Rule**: Always skip directory file headers in ZIP writer copy or creation loops:
  ```go
  for _, f := range reader.File {
      if f.FileInfo().IsDir() {
          continue // MUST skip directory entries
      }
      ...
  }
  ```

### 2. POSIX Path Separators inside ZIP entries
- **Issue**: ZIP archives require forward slashes (`/`) as path separators, even on Windows. Using backslashes (`\`) corrupts file paths.
- **Rule**: Always run path variables through `normalizeZipPath` or use POSIX path conventions (`path.Join`) rather than OS-specific filepath operations (`filepath.Join`) when targeting ZIP files.

### 3. Open File Handle Locks
- **Issue**: Windows enforces strict file locks. Renaming or deleting an open file raises `Access is denied` or `The process cannot access the file because it is being used by another process`.
- **Rule**: Before replacing/renaming/deleting an EPUB file:
  1. **Serialize ZIP writers first**: Direct ZIP rebuilders (`Repair`, `Optimize`, metadata save, and background consolidation) must use `getZipWriteLock(id)` so two writers cannot build/swap the same book concurrently. Acquire this lock before `getBookLock(id)` to match the background writer lock order.
  2. **Acquire book-level lock**: Use `getBookLock(id)` to prevent concurrent reads or writes.
  3. **Manage background writes**: For renaming, flush pending writes using `consolidateZIP` first so user changes aren't lost. For deleting, discard pending background writes in `pendingJobs`.
  4. **Clear caches**: Do not rely on `ctx.Close()` for cached readers. Use `closeZipReaderForBook` / `replaceBookFileWithTemp` before swapping files so the cached `*zip.ReadCloser` is closed and removed from `zipReaderCache`; also clear `bookCache` entries for the replaced path.
  5. **Manage overlay**: Move the overlay directory on renaming, or remove it entirely on deletion.
  6. **Use retry logic**: Use `removeFileWithRetry` and `renameFileWithRetry` instead of direct `os.Remove` / `os.Rename` during EPUB swaps to handle OS file handle release latency.


### 4. Thread-Safe Book Mutexes
- **Issue**: Multiple requests targeting the same book concurrently can corrupt files or cause race conditions.
- **Rule**: Always wrap request logic with the book-specific mutex:
  ```go
  lock := s.getBookLock(id)
  lock.Lock()
  defer lock.Unlock()
  ```

### 5. Undo Snapshot System
- **Issue**: Creating undo snapshots copies the entire EPUB file, which is too slow for large books.
- **Rule**: Keep the early return (`return nil`) pattern inside `pushUndoSnapshot` active. Do not delete the undo logic, as it may be toggled or re-enabled later.

---

## 🔌 JS Scraper Extensions Guidelines

- **Storage**: All custom crawler extensions must be uploaded/placed inside the `extensions/` directory as `.js` files.
- **Stealth / Cloudflare Bypass**: The headless browser runs under stealth mode. If a scraper extension triggers a captcha, the SSE (Server-Sent Events) pipeline automatically streams screenshots back to the UI.
- **Interactive Solvers**: Use standard events in the React client to simulate pointer clicks and keystroke inputs inside the active crawler session.
- **Interactive Choices**: Use `utils.choose(prompt, options, multiple)` when the extension must inspect a page before it can present choices, such as selecting volumes after scanning a series page. Keep the corresponding text input optional as a fast path for scripted runs.
- **Multi-volume Return Shape**: When one source URL contains multiple volumes, do not flatten every chapter into one ebook. Return one ebook per selected volume using Format B (`[...]`) or Format C (`{ ebooks: [...] }`) from `EXTENSION_GUIDE.md`.
- **Volume Metadata**: For each volume ebook, use the source volume heading as `title` and `metadata.title`. Put the parent novel/series title in `metadata.series`, and put the volume order in `metadata.seriesIndex`.
- **Image-only Chapters**: Illustration/gallery pages with `<img>` but little or no text are valid chapters. Preserve the HTML, download images into the ebook `images` map, and do not reject the page solely because `htmlToText(content)` is short.
- For full schema definitions of the extension format, browser helper APIs, and parameter configurations, refer to the root [EXTENSION_GUIDE.md](file:///e:/epub_forge/EXTENSION_GUIDE.md).

---

## 🔨 Build & Local Running Commands

### 1. Compile Standalone Binaries (Native builds)
To package the built frontend files directly inside the executable:
```bash
# Build for host platform (e.g. Windows)
npm run native:build

# Build for all platform architectures
npm run native:build:all
```

### 2. Run Local Development Servers
To run with hot reloading active:
```bash
# Run React frontend development server (Vite)
npm run dev

# Run Go backend directly (reads built frontend from cmd/epubforge/dist)
npm run native
```

### 3. Execute Save Benchmarks
To run the automated save and validation benchmark on `liar_liar.epub`:
```bash
go run scratch/benchmark_save.go
```
Ensure that the console logs:
`Verification SUCCESSFUL! Saved content was correctly retrieved.`
and average save time remains **under 20 milliseconds**.
