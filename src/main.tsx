import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Settings, Type, Sparkles, Search, Wrench, Image as ImageIcon } from "lucide-react";
import { BookSidebar } from "./components/BookSidebar";
import { ChaptersPanel } from "./components/ChaptersPanel";
import { MetadataModal } from "./components/MetadataModal";
import { PreviewPanel } from "./components/PreviewPanel";
import { VolumesPanel } from "./components/VolumesPanel";
import { MergeModal } from "./components/MergeModal";
import { CreateEpubModal } from "./components/CreateEpubModal";
import { EmbedFontModal } from "./components/EmbedFontModal";
import { OptimizeModal } from "./components/OptimizeModal";
import { FindReplaceModal } from "./components/FindReplaceModal";
import { RepairModal } from "./components/RepairModal";
import { GalleryModal } from "./components/GalleryModal";
import { api, normalizeAnalysis, readError } from "./lib/api";
import { useAppStore } from "./lib/appStore";
import { formatBytes } from "./lib/format";
import {
  emptyMetadata,
  type BookAnalysis,
  type BookMetadata,
  type EpubFile,
  type ExportRange
} from "./lib/types";
import "./styles.css";

function App() {
  const {
    books,
    selectedId,
    analysis,
    mergeOpen,
    importOpen,
    metadata,
    metadataDirty,
    ranges,
    previewIndex,
    includeFrontmatter,
    exports,
    busy,
    error,
    notice,
    sidebarCollapsed,
    metadataOpen,
    fontOpen,
    exportProgress,
    previewRevision,
    setBooks,
    setSelectedId,
    setAnalysis,
    setMergeOpen,
    setImportOpen,
    setMetadata,
    updateMetadata,
    setMetadataDirty,
    setRanges,
    setPreviewIndex,
    setIncludeFrontmatter,
    setExports,
    setBusy,
    setError,
    setNotice,
    setSidebarCollapsed,
    setMetadataOpen,
    setFontOpen,
    setExportProgress,
    setPreviewRevision
  } = useAppStore();

  const [optimizeOpen, setOptimizeOpen] = useState(false);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [repairOpen, setRepairOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);

  useEffect(() => {
    refreshBooks();
  }, []);

  useEffect(() => {
    if (selectedId) {
      loadAnalysis(selectedId);
    }
  }, [selectedId]);

  const previewUrl = useMemo(() => {
    if (!analysis) {
      return "";
    }
    return `/api/epubs/${encodeURIComponent(analysis.id)}/chapters/${previewIndex}/html?rev=${previewRevision}`;
  }, [analysis, previewIndex, previewRevision]);

  async function refreshBooks() {
    setBusy("Đang quét EPUB");
    setError("");
    setNotice("");
    try {
      const data = await api<EpubFile[]>("/api/epubs");
      const nextBooks = Array.isArray(data) ? data : [];
      setBooks(nextBooks);
      setSelectedId((current) => current || nextBooks[0]?.id || "");
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy("");
    }
  }

  async function loadAnalysis(id: string) {
    setBusy("Đang phân tích spine/toc");
    setError("");
    setNotice("");
    setExports([]);
    setExportProgress(null);
    try {
      const data = normalizeAnalysis(await api<BookAnalysis>(`/api/epubs/${encodeURIComponent(id)}/analyze`));
      setAnalysis(data);
      setMetadata(data.metadata);
      setMetadataDirty(false);
      setPreviewIndex(data.spine[0]?.index ?? 0);
      const detected = data.detectedVolumes.map(({ label, startIndex, endIndex }) => ({ label, startIndex, endIndex }));
      const firstIndex = data.spine[0]?.index ?? 0;
      const lastIndex = data.spine.at(-1)?.index ?? firstIndex;
      setRanges(detected.length ? detected : [{ label: "Vol 1", startIndex: firstIndex, endIndex: lastIndex }]);
    } catch (err) {
      setError(readError(err));
      setAnalysis(null);
      setMetadata(emptyMetadata);
      setRanges([]);
    } finally {
      setBusy("");
    }
  }

  async function saveOriginalMetadata() {
    if (!analysis) {
      return;
    }
    setBusy("Đang lưu metadata");
    setError("");
    setNotice("");
    try {
      await api<{ metadata: BookMetadata }>(`/api/epubs/${encodeURIComponent(analysis.id)}/metadata`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metadata)
      });
      setMetadataDirty(false);
      setNotice("Đã lưu metadata vào EPUB thành công.");
      await loadAnalysis(analysis.id);
      setPreviewRevision((prev) => prev + 1);
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy("");
    }
  }

  function resetMetadata() {
    if (!analysis) {
      return;
    }
    setMetadata(analysis.metadata);
    setMetadataDirty(false);
  }

  function applyDetected() {
    if (!analysis) {
      return;
    }
    setRanges(analysis.detectedVolumes.map(({ label, startIndex, endIndex }) => ({ label, startIndex, endIndex })));
  }

  function addRange() {
    if (!analysis) {
      return;
    }
    const lastEnd = ranges.at(-1)?.endIndex ?? -1;
    const startIndex = Math.min(lastEnd + 1, analysis.spine.at(-1)?.index ?? 0);
    setRanges([...ranges, { label: `Vol ${ranges.length + 1}`, startIndex, endIndex: startIndex }]);
  }

  function updateRange(index: number, patch: Partial<ExportRange>) {
    setRanges(ranges.map((range, idx) => (idx === index ? { ...range, ...patch } : range)));
  }

  function removeRange(index: number) {
    setRanges(ranges.filter((_range, idx) => idx !== index));
  }

  async function exportSelected() {
    if (!analysis || ranges.length === 0) {
      return;
    }
    setBusy("Đang tách EPUB...");
    setError("");
    setNotice("");
    setExports([]);
    setExportProgress(null);
    try {
      const response = await fetch(`/api/epubs/${encodeURIComponent(analysis.id)}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ranges, includeFrontmatter, metadata })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      if (!response.body) {
        throw new Error("Không thể khởi tạo luồng dữ liệu tiến trình.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          let data;
          try {
            data = JSON.parse(line);
          } catch (e) {
            console.error("Lỗi parse NDJSON line:", line, e);
            continue;
          }

          if (data.type === "progress") {
            setExportProgress({
              index: data.index,
              total: data.total,
              label: data.label
            });
            setBusy(`Đang tách... ${data.index + 1}/${data.total}`);
          } else if (data.type === "error") {
            throw new Error(data.error || "Lỗi khi xuất EPUB");
          } else if (data.type === "done") {
            setExports(Array.isArray(data.files) ? data.files : []);
            setNotice(`Đã xuất ${data.files?.length || 0} EPUB vào thư mục output.`);
          }
        }
      }
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy("");
      setExportProgress(null);
    }
  }

  async function handleMergeSuccess(newFileName: string) {
    setNotice(`Đã gộp thành công các tệp EPUB thành "${newFileName}".`);
    await refreshBooks();
    
    const toID = (name: string) => {
      const utf8Bytes = new TextEncoder().encode(name);
      let binary = "";
      for (let i = 0; i < utf8Bytes.length; i++) {
        binary += String.fromCharCode(utf8Bytes[i]);
      }
      return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    };
    setSelectedId(toID(newFileName));
  }

  async function handleImportSuccess(newFileName: string) {
    setNotice(`Đã tạo và nhập thành công truyện thành tệp EPUB "${newFileName}".`);
    await refreshBooks();
    
    const toID = (name: string) => {
      const utf8Bytes = new TextEncoder().encode(name);
      let binary = "";
      for (let i = 0; i < utf8Bytes.length; i++) {
        binary += String.fromCharCode(utf8Bytes[i]);
      }
      return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    };
    setSelectedId(toID(newFileName));
  }

  async function handleUploadBooks(files: File[]) {
    setBusy(`Đang tải lên ${files.length} sách...`);
    setError("");
    setNotice("");
    try {
      const results = await Promise.all(
        files.map(async (file) => {
          const formData = new FormData();
          formData.append("file", file);

          const response = await fetch("/api/epubs/upload", {
            method: "POST",
            body: formData
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || response.statusText);
          }

          const res = await response.json();
          return res.fileName as string;
        })
      );

      setNotice(`Đã thêm thành công ${files.length} sách.`);
      await refreshBooks();

      const lastUploadedName = results[results.length - 1];
      if (lastUploadedName) {
        const toID = (name: string) => {
          const utf8Bytes = new TextEncoder().encode(name);
          let binary = "";
          for (let i = 0; i < utf8Bytes.length; i++) {
            binary += String.fromCharCode(utf8Bytes[i]);
          }
          return btoa(binary)
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");
        };
        setSelectedId(toID(lastUploadedName));
      }
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy("");
    }
  }

  async function handleDeleteBook(id: string, name: string) {
    if (!window.confirm(`Bạn có chắc chắn muốn xoá sách "${name}" không?`)) {
      return;
    }
    setBusy("Đang xoá sách...");
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/epubs/${encodeURIComponent(id)}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || response.statusText);
      }

      setNotice(`Đã xoá sách "${name}" thành công.`);
      
      const remainingBooks = books.filter(b => b.id !== id);
      if (selectedId === id) {
        setSelectedId(remainingBooks[0]?.id || "");
        if (remainingBooks.length === 0) {
          setAnalysis(null);
        }
      }
      await refreshBooks();
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy("");
    }
  }

  async function handleDeleteBooks(ids: string[]) {
    if (!window.confirm(`Bạn có chắc chắn muốn xoá ${ids.length} sách không?`)) {
      return;
    }
    setBusy(`Đang xoá ${ids.length} sách...`);
    setError("");
    setNotice("");
    try {
      await Promise.all(
        ids.map(async (id) => {
          const response = await fetch(`/api/epubs/${encodeURIComponent(id)}`, {
            method: "DELETE"
          });
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || response.statusText);
          }
        })
      );
      setNotice(`Đã xoá ${ids.length} sách thành công.`);
      
      const remainingBooks = books.filter(b => !ids.includes(b.id));
      if (ids.includes(selectedId)) {
        setSelectedId(remainingBooks[0]?.id || "");
        if (remainingBooks.length === 0) {
          setAnalysis(null);
        }
      }
      
      await refreshBooks();
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy("");
    }
  }

  return (
    <main className={sidebarCollapsed ? "shell sidebarCollapsed" : "shell"}>
      <BookSidebar
        books={books}
        selectedId={selectedId}
        busy={Boolean(busy)}
        collapsed={sidebarCollapsed}
        onRefresh={refreshBooks}
        onSelect={setSelectedId}
        onToggle={() => setSidebarCollapsed((current) => !current)}
        onMergeClick={() => setMergeOpen(true)}
        onImportTxtClick={() => setImportOpen(true)}
        onUploadBooks={handleUploadBooks}
        onDeleteBook={handleDeleteBook}
        onDeleteBooks={handleDeleteBooks}
      />

      <section className="workspace">
        {analysis ? (
          <>
            <header className="topbar">
              <div className="topbarInfo">
                <h2>{metadata.title || analysis.title}</h2>
                <p>
                  {metadata.creator || "Unknown"} · {analysis.spine.length} spine items · {formatBytes(analysis.size)}
                </p>
              </div>
              <div className="topbarActions">
                <button className={metadataDirty ? "smallButton metadataButton dirty" : "smallButton metadataButton"} onClick={() => setMetadataOpen(true)}>
                  <Settings size={16} />
                  <span>Metadata</span>
                </button>
                <button className="smallButton metadataButton" onClick={() => setFontOpen(true)}>
                  <Type size={16} />
                  <span>Phông chữ</span>
                </button>
                <button className="smallButton metadataButton" onClick={() => setGalleryOpen(true)}>
                  <ImageIcon size={16} />
                  <span>Gallery</span>
                </button>
                <button className="smallButton metadataButton" onClick={() => setOptimizeOpen(true)}>
                  <Sparkles size={16} />
                  <span>Tối ưu</span>
                </button>
                <button className="smallButton metadataButton" onClick={() => setRepairOpen(true)}>
                  <Wrench size={16} />
                  <span>Sửa lỗi</span>
                </button>
                <button className="smallButton metadataButton" onClick={() => setFindReplaceOpen(true)}>
                  <Search size={16} />
                  <span>Tìm & Thay</span>
                </button>
                <div className="status">{busy || (metadataDirty ? "Metadata chưa lưu" : "Sẵn sàng")}</div>
              </div>
            </header>

            {error ? <div className="error">{error}</div> : null}
            {notice ? <div className="notice">{notice}</div> : null}

            <div className="grid">
              <ChaptersPanel
                bookId={analysis.id}
                chapters={analysis.spine}
                previewIndex={previewIndex}
                onPreview={setPreviewIndex}
                onUpdateAnalysis={async (newAnalysis) => {
                  if (newAnalysis.id !== selectedId) {
                    setSelectedId(newAnalysis.id);
                  } else {
                    setAnalysis(newAnalysis);
                    setMetadata(newAnalysis.metadata || {});
                    setMetadataDirty(false);
                  }
                  await refreshBooks();
                }}
                onSetBusy={setBusy}
                onSetError={setError}
              />
              <PreviewPanel
                bookId={analysis.id}
                chapters={analysis.spine}
                previewIndex={previewIndex}
                previewUrl={previewUrl}
                onUpdateAnalysis={async (newAnalysis) => {
                  if (newAnalysis.id !== selectedId) {
                    setSelectedId(newAnalysis.id);
                  } else {
                    setAnalysis(newAnalysis);
                    setMetadata(newAnalysis.metadata || {});
                    setMetadataDirty(false);
                  }
                  await refreshBooks();
                }}
                onSetBusy={setBusy}
                onSetError={setError}
                onSaveSuccess={() => setPreviewRevision((prev) => prev + 1)}
              />
              <VolumesPanel
                analysis={analysis}
                ranges={ranges}
                includeFrontmatter={includeFrontmatter}
                busy={Boolean(busy)}
                exports={exports}
                exportProgress={exportProgress}
                onApplyDetected={applyDetected}
                onAddRange={addRange}
                onUpdateRange={updateRange}
                onRemoveRange={removeRange}
                onIncludeFrontmatterChange={setIncludeFrontmatter}
                onExport={exportSelected}
              />
            </div>

            <MetadataModal
              open={metadataOpen}
              analysis={analysis}
              metadata={metadata}
              dirty={metadataDirty}
              busy={Boolean(busy)}
              onChange={updateMetadata}
              onReset={resetMetadata}
              onSave={saveOriginalMetadata}
              onClose={() => setMetadataOpen(false)}
            />
          </>
        ) : (
          <div className="emptyState">{busy || "Không tìm thấy EPUB trong thư mục hiện tại."}</div>
        )}
      </section>

      <MergeModal
        open={mergeOpen}
        books={books}
        currentBookId={selectedId}
        onClose={() => setMergeOpen(false)}
        onMergeSuccess={handleMergeSuccess}
        onSetBusy={setBusy}
        onSetError={setError}
      />

      <CreateEpubModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImportSuccess={handleImportSuccess}
        onSetBusy={setBusy}
        onSetError={setError}
      />

      {analysis && (
        <OptimizeModal
          open={optimizeOpen}
          bookId={analysis.id}
          bookTitle={metadata.title || analysis.title}
          onClose={() => setOptimizeOpen(false)}
          onSuccess={async () => {
            setOptimizeOpen(false);
            await loadAnalysis(analysis.id);
            setPreviewRevision((prev) => prev + 1);
          }}
        />
      )}

      {analysis && (
        <EmbedFontModal
          open={fontOpen}
          analysis={analysis}
          onClose={() => setFontOpen(false)}
          onUpdateAnalysis={async (newAnalysis) => {
            if (newAnalysis.id !== selectedId) {
              setSelectedId(newAnalysis.id);
            } else {
              setAnalysis(newAnalysis);
              setMetadata(newAnalysis.metadata || {});
              setMetadataDirty(false);
            }
            await refreshBooks();
            setPreviewRevision((prev) => prev + 1);
          }}
          onSetBusy={setBusy}
          onSetError={setError}
        />
      )}

      {analysis && (
        <FindReplaceModal
          open={findReplaceOpen}
          bookId={analysis.id}
          currentChapterIndex={previewIndex}
          chapters={analysis.spine}
          onClose={() => setFindReplaceOpen(false)}
          onUpdateAnalysis={async (newAnalysis) => {
            if (newAnalysis.id !== selectedId) {
              setSelectedId(newAnalysis.id);
            } else {
              setAnalysis(newAnalysis);
              setMetadata(newAnalysis.metadata || {});
              setMetadataDirty(false);
            }
            await refreshBooks();
            setPreviewRevision((prev) => prev + 1);
          }}
          onSetBusy={setBusy}
          onSetError={setError}
        />
      )}
      {analysis && (
        <RepairModal
          open={repairOpen}
          bookId={analysis.id}
          bookTitle={metadata.title || analysis.title}
          onClose={() => setRepairOpen(false)}
          onSuccess={async (newAnalysis) => {
            if (newAnalysis.id !== selectedId) {
              setSelectedId(newAnalysis.id);
            } else {
              setAnalysis(newAnalysis);
              setMetadata(newAnalysis.metadata || {});
              setMetadataDirty(false);
            }
            await refreshBooks();
            setPreviewRevision((prev) => prev + 1);
          }}
        />
      )}
      {analysis && (
        <GalleryModal
          open={galleryOpen}
          bookId={analysis.id}
          onClose={() => setGalleryOpen(false)}
          onSaveSuccess={async (newAnalysis) => {
            if (newAnalysis.id !== selectedId) {
              setSelectedId(newAnalysis.id);
            } else {
              setAnalysis(newAnalysis);
              setMetadata(newAnalysis.metadata || {});
              setMetadataDirty(false);
            }
            await refreshBooks();
            setPreviewRevision((prev) => prev + 1);
          }}
        />
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
