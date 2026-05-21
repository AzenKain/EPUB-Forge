import React, { useState, useEffect } from "react";
import { X, Search, ChevronDown, Check, RefreshCw } from "lucide-react";

type Props = {
  open: boolean;
  bookId: string;
  currentChapterIndex: number;
  chapters: Array<{ index: number; title: string; path: string }>;
  onClose: () => void;
  onUpdateAnalysis: (newAnalysis: any) => void;
  onSetBusy: (busy: string) => void;
  onSetError: (error: string) => void;
};

type Match = {
  chapterIndex: number;
  chapterTitle: string;
  chapterPath: string;
  lineNumber: number;
  lineContent: string;
  startCol: number;
  endCol: number;
  startOffset: number;
  endOffset: number;
};

export function FindReplaceModal({
  open,
  bookId,
  currentChapterIndex,
  chapters,
  onClose,
  onUpdateAnalysis,
  onSetBusy,
  onSetError
}: Props) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [mode, setMode] = useState<"normal" | "regex">("regex");
  const [scope, setScope] = useState<"all" | "current">("all");
  const [direction, setDirection] = useState<"down" | "up">("down");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [dotAll, setDotAll] = useState(false);

  const [matches, setMatches] = useState<Match[]>([]);
  const [selectedMatchIndex, setSelectedMatchIndex] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!open) {
      setMatches([]);
      setSelectedMatchIndex(null);
      setNotice("");
    }
  }, [open]);

  if (!open) return null;

  const handleFind = async (silent = false, selectIndexOverride?: number) => {
    if (!query) {
      if (!silent) alert("Vui lòng nhập từ khóa cần tìm!");
      return;
    }
    setSearching(true);
    setNotice("");
    try {
      const res = await fetch(`/api/epubs/${encodeURIComponent(bookId)}/find`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          mode,
          scope,
          chapterIndex: currentChapterIndex,
          caseSensitive,
          dotAll
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Lỗi khi tìm kiếm");
      }

      const data = await res.json();
      const foundMatches = data.matches || [];
  
      if (direction === "up") {
        foundMatches.reverse();
      }

      setMatches(foundMatches);

      if (foundMatches.length > 0) {
        if (selectIndexOverride !== undefined) {
          const clampedIndex = Math.max(0, Math.min(selectIndexOverride, foundMatches.length - 1));
          setSelectedMatchIndex(clampedIndex);
        } else {
          setSelectedMatchIndex(0);
        }
        if (!silent) setNotice(`Tìm thấy ${foundMatches.length} kết quả.`);
      } else {
        setSelectedMatchIndex(null);
        if (!silent) setNotice("Không tìm thấy kết quả nào.");
      }
    } catch (err: any) {
      onSetError(err.message || "Đã xảy ra lỗi khi tìm kiếm.");
    } finally {
      setSearching(false);
    }
  };

  const handleReplace = async () => {
    if (selectedMatchIndex === null || matches.length === 0) {
      alert("Vui lòng chọn kết quả cần thay thế bằng cách bấm Tìm hoặc chọn từ danh sách!");
      return;
    }

    onSetBusy("Đang thay thế...");
    try {
      const res = await fetch(`/api/epubs/${encodeURIComponent(bookId)}/replace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          replacement,
          mode,
          scope,
          chapterIndex: currentChapterIndex,
          caseSensitive,
          dotAll,
          replaceAll: false,
          matchIndex: selectedMatchIndex
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Lỗi khi thay thế");
      }

      const data = await res.json();
      onUpdateAnalysis(data.analysis);
    
      await handleFind(true, selectedMatchIndex);
      setNotice("Đã thay thế 1 kết quả.");
    } catch (err: any) {
      alert(err.message);
    } finally {
      onSetBusy("");
    }
  };

  const handleReplaceAndFind = async () => {
    if (selectedMatchIndex === null || matches.length === 0) {
      alert("Vui lòng thực hiện Tìm trước!");
      return;
    }

    const currentIndex = selectedMatchIndex;
    await handleReplace();
  };

  const handleReplaceAll = async () => {
    if (!query) {
      alert("Vui lòng nhập từ khóa cần tìm!");
      return;
    }

    onSetBusy("Đang thay thế toàn bộ...");
    try {
      const res = await fetch(`/api/epubs/${encodeURIComponent(bookId)}/replace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          replacement,
          mode,
          scope,
          chapterIndex: currentChapterIndex,
          caseSensitive,
          dotAll,
          replaceAll: true
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Lỗi khi thay thế toàn bộ");
      }

      const data = await res.json();
      onUpdateAnalysis(data.analysis);
      setMatches([]);
      setSelectedMatchIndex(null);
      setNotice(`Thay thế toàn bộ hoàn tất. Tổng số: ${data.replacedCount} kết quả.`);
    } catch (err: any) {
      alert(err.message);
    } finally {
      onSetBusy("");
    }
  };

  function renderSnippet(content: string, start: number, end: number) {
    if (start < 0 || end > content.length || start > end) {
      return <span>{content}</span>;
    }
    const before = content.substring(0, start);
    const matchStr = content.substring(start, end);
    const after = content.substring(end);
    return (
      <span>
        {before}
        <mark
          style={{
            backgroundColor: "#ffeaa7",
            color: "#17201c",
            fontWeight: "bold",
            padding: "1px 3px",
            borderRadius: "3px"
          }}
        >
          {matchStr}
        </mark>
        {after}
      </span>
    );
  }

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="metadataModal"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: "min(680px, 95vw)",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          padding: 0,
          overflow: "hidden",
          background: "#fbf8f3",
          border: "1px solid #e6dfd3",
          boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)"
        }}
      >
        <header className="modalHeader" style={{ padding: "14px 20px", borderBottom: "1px solid #e6dfd3" }}>
          <div>
            <h3 style={{ margin: 0, color: "#1f624d", display: "flex", alignItems: "center", gap: "8px" }}>
              <Search size={18} />
              <span>Tìm kiếm & Thay thế</span>
            </h3>
          </div>
          <button className="iconButton" onClick={onClose} title="Đóng">
            <X size={18} />
          </button>
        </header>

        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px", minHeight: 0 }}>
          {/* Main search panel matching Sigil layout */}
          <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "10px" }}>
              {/* Find Row */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ width: "65px", fontSize: "13px", fontWeight: "600", color: "#544f45", textAlign: "right" }}>
                  Find:
                </span>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Nhập từ khoá hoặc regex tìm kiếm..."
                  onKeyDown={(e) => e.key === "Enter" && handleFind()}
                  style={{
                    flex: 1,
                    padding: "8px 12px",
                    fontSize: "13px",
                    border: "1px solid #c9c6bd",
                    borderRadius: "6px",
                    outline: "none",
                    background: "#fff",
                    color: "#17201c"
                  }}
                />
              </div>

              {/* Replace Row */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ width: "65px", fontSize: "13px", fontWeight: "600", color: "#544f45", textAlign: "right" }}>
                  Replace:
                </span>
                <input
                  type="text"
                  value={replacement}
                  onChange={(e) => setReplacement(e.target.value)}
                  placeholder="Nhập chuỗi thay thế..."
                  style={{
                    flex: 1,
                    padding: "8px 12px",
                    fontSize: "13px",
                    border: "1px solid #c9c6bd",
                    borderRadius: "6px",
                    outline: "none",
                    background: "#fff",
                    color: "#17201c"
                  }}
                />
              </div>

              {/* Options Row (Mode, Scope, Direction) */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
                <span style={{ width: "65px", fontSize: "13px", fontWeight: "600", color: "#544f45", textAlign: "right" }}>
                  Mode:
                </span>
                
                {/* Mode Select */}
                <select
                  value={mode}
                  onChange={(e: any) => setMode(e.target.value)}
                  style={{
                    padding: "6px 10px",
                    fontSize: "12px",
                    border: "1px solid #c9c6bd",
                    borderRadius: "4px",
                    background: "#fff",
                    color: "#17201c",
                    outline: "none",
                    cursor: "pointer"
                  }}
                >
                  <option value="regex">Regex</option>
                  <option value="normal">Normal</option>
                </select>

                {/* Scope Select */}
                <select
                  value={scope}
                  onChange={(e: any) => setScope(e.target.value)}
                  style={{
                    padding: "6px 10px",
                    fontSize: "12px",
                    border: "1px solid #c9c6bd",
                    borderRadius: "4px",
                    background: "#fff",
                    color: "#17201c",
                    outline: "none",
                    cursor: "pointer"
                  }}
                >
                  <option value="all">All text files</option>
                  <option value="current">Current file</option>
                </select>

                {/* Direction Select */}
                <select
                  value={direction}
                  onChange={(e: any) => setDirection(e.target.value)}
                  style={{
                    padding: "6px 10px",
                    fontSize: "12px",
                    border: "1px solid #c9c6bd",
                    borderRadius: "4px",
                    background: "#fff",
                    color: "#17201c",
                    outline: "none",
                    cursor: "pointer"
                  }}
                >
                  <option value="down">Down</option>
                  <option value="up">Up</option>
                </select>
              </div>

              {/* Checkboxes Row */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
                <span style={{ width: "65px" }}></span>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "16px" }}>
                  {/* Case sensitive */}
                  <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", color: "#4d574f", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={caseSensitive}
                      onChange={(e) => setCaseSensitive(e.target.checked)}
                      style={{ cursor: "pointer" }}
                    />
                    <span>Case sensitive</span>
                  </label>

                  {/* Wrap */}
                  <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", color: "#4d574f", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={wrap}
                      onChange={(e) => setWrap(e.target.checked)}
                      style={{ cursor: "pointer" }}
                    />
                    <span>Wrap</span>
                  </label>

                  {/* Dot all (Regex matches newlines) */}
                  {mode === "regex" && (
                    <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", color: "#4d574f", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={dotAll}
                        onChange={(e) => setDotAll(e.target.checked)}
                        style={{ cursor: "pointer" }}
                      />
                      <span>Dot all (Regex matches newlines)</span>
                    </label>
                  )}
                </div>
              </div>
            </div>

            {/* Buttons Sidepanel */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", minWidth: "140px" }}>
              <button
                onClick={() => handleFind()}
                disabled={searching}
                style={{
                  padding: "8px 12px",
                  fontSize: "12px",
                  fontWeight: "600",
                  background: "#2f7d69",
                  color: "#fff",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  width: "100%",
                  boxShadow: "0 2px 4px rgba(47, 125, 105, 0.15)"
                }}
              >
                Find
              </button>
              <button
                onClick={handleReplaceAndFind}
                disabled={selectedMatchIndex === null}
                style={{
                  padding: "8px 12px",
                  fontSize: "12px",
                  fontWeight: "600",
                  background: "#fff",
                  color: "#2f7d69",
                  border: "1px solid #2f7d69",
                  borderRadius: "4px",
                  cursor: "pointer",
                  width: "100%"
                }}
              >
                Replace and Find
              </button>
              <button
                onClick={handleReplace}
                disabled={selectedMatchIndex === null}
                style={{
                  padding: "8px 12px",
                  fontSize: "12px",
                  fontWeight: "600",
                  background: "#fff",
                  color: "#544f45",
                  border: "1px solid #c9c6bd",
                  borderRadius: "4px",
                  cursor: "pointer",
                  width: "100%"
                }}
              >
                Replace
              </button>
              <button
                onClick={handleReplaceAll}
                style={{
                  padding: "8px 12px",
                  fontSize: "12px",
                  fontWeight: "600",
                  background: "#544f45",
                  color: "#fff",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  width: "100%"
                }}
              >
                Replace all
              </button>
            </div>
          </div>

          {/* Progress / Status banner */}
          {(notice || searching) && (
            <div
              style={{
                background: "#f3eedf",
                padding: "8px 12px",
                borderRadius: "6px",
                fontSize: "12px",
                color: "#1f624d",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                border: "1px solid #e6dfd3"
              }}
            >
              {searching && (
                <div style={{
                  width: "12px",
                  height: "12px",
                  border: "2px solid #e6dfd3",
                  borderTopColor: "#2f7d69",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite"
                }} />
              )}
              <span>{searching ? "Đang tìm kiếm..." : notice}</span>
            </div>
          )}

          {/* Results list */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, marginTop: "8px" }}>
            <span style={{ fontSize: "11px", fontWeight: "700", color: "#8c8273", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>
              Kết quả tìm kiếm ({matches.length})
            </span>

            {matches.length === 0 ? (
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px dashed #c9c6bd",
                  borderRadius: "8px",
                  background: "#fff",
                  color: "#8c8273",
                  fontSize: "13px",
                  padding: "40px 20px",
                  textAlign: "center"
                }}
              >
                Chưa có kết quả tìm kiếm nào. Nhấn nút "Find" để bắt đầu tìm.
              </div>
            ) : (
              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  border: "1px solid #c9c6bd",
                  borderRadius: "8px",
                  background: "#fff",
                  display: "flex",
                  flexDirection: "column"
                }}
              >
                {matches.map((match, idx) => {
                  const isSelected = selectedMatchIndex === idx;
                  return (
                    <div
                      key={`${match.chapterIndex}-${match.lineNumber}-${idx}`}
                      onClick={() => setSelectedMatchIndex(idx)}
                      style={{
                        padding: "10px 14px",
                        borderBottom: "1px solid #f0eae1",
                        background: isSelected ? "#e9f6f0" : "#fff",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                        transition: "background-color 0.1s ease"
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: "12px", fontWeight: "600", color: isSelected ? "#1f624d" : "#544f45" }}>
                          {match.chapterTitle}
                        </span>
                        <span style={{ fontSize: "11px", color: "#8c8273", background: "#f5f3ec", padding: "2px 6px", borderRadius: "4px" }}>
                          Dòng {match.lineNumber}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: "12px",
                          fontFamily: "monospace",
                          color: "#17201c",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-all",
                          lineHeight: "1.4",
                          paddingLeft: "6px",
                          borderLeft: isSelected ? "3px solid #2f7d69" : "3px solid #e6dfd3"
                        }}
                      >
                        {renderSnippet(match.lineContent, match.startCol, match.endCol)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <footer className="modalFooter" style={{ padding: "12px 20px", borderTop: "1px solid #e6dfd3", background: "#f3eedf", display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="smallButton"
            onClick={onClose}
            style={{
              padding: "8px 16px",
              fontSize: "13px",
              fontWeight: "500",
              cursor: "pointer",
              borderRadius: "6px",
              border: "1px solid #c9c6bd",
              background: "#fff",
              color: "#544f45"
            }}
          >
            Đóng
          </button>
        </footer>

        <style dangerouslySetInnerHTML={{ __html: `
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}} />
      </section>
    </div>
  );
}
