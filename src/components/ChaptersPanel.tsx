import React, { useRef, useState } from "react";
import { Edit2, Trash2, Combine, Scissors, X, Plus } from "lucide-react";
import type { Chapter } from "../lib/types";
import { AutoMergeModal } from "./AutoMergeModal";

type Props = {
  bookId: string;
  chapters: Chapter[];
  previewIndex: number;
  onPreview: (index: number) => void;
  onUpdateAnalysis: (newAnalysis: any) => void | Promise<void>;
  onSetBusy: (busy: string) => void;
  onSetError: (error: string) => void;
};

export function ChaptersPanel({
  bookId,
  chapters,
  previewIndex,
  onPreview,
  onUpdateAnalysis,
  onSetBusy,
  onSetError
}: Props) {
  const [isMultiSelect, setIsMultiSelect] = useState(false);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
  const [isAutoMergeOpen, setIsAutoMergeOpen] = useState(false);
  const [customTitle, setCustomTitle] = useState("");
  const [stripMergedTitles, setStripMergedTitles] = useState(true);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dropPosition, setDropPosition] = useState<"before" | "after">("before");
  const [isReordering, setIsReordering] = useState(false);
  const draggedIndexRef = useRef<number | null>(null);
  const dragOverIndexRef = useRef<number | null>(null);
  const dropPositionRef = useRef<"before" | "after">("before");

  const resetDragState = () => {
    draggedIndexRef.current = null;
    dragOverIndexRef.current = null;
    dropPositionRef.current = "before";
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const setDragTarget = (index: number, position: "before" | "after") => {
    dragOverIndexRef.current = index;
    dropPositionRef.current = position;

    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
    if (dropPosition !== position) {
      setDropPosition(position);
    }
  };

  const handleDropAtCurrentTarget = (e: React.DragEvent) => {
    const source = draggedIndexRef.current;
    const target = dragOverIndexRef.current;

    if (isMultiSelect || isReordering || source === null || target === null) return;

    e.preventDefault();
    e.stopPropagation();

    const insertionIndex = dropPositionRef.current === "before" ? target : target + 1;

    resetDragState();
    handleReorder(source, insertionIndex);
  };

  const handleReorder = async (sourceIndex: number, insertionIndex: number) => {
    if (isReordering || insertionIndex === sourceIndex || insertionIndex === sourceIndex + 1) return;

    try {
      setIsReordering(true);
      onSetBusy("Đang sắp xếp lại chương...");
      onSetError("");
      const res = await fetch(`/api/epubs/${encodeURIComponent(bookId)}/chapters/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reorder", index: sourceIndex, targetIndex: insertionIndex })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Lỗi khi sắp xếp lại chương");
      }
      const data = await res.json();
      await onUpdateAnalysis(data);
    } catch (err: any) {
      onSetError(err.message || "Lỗi khi sắp xếp lại chương");
    } finally {
      setIsReordering(false);
      onSetBusy("");
    }
  };

  const handleRename = async (index: number, currentTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isReordering) return;
    const newTitle = prompt("Nhập tên mới cho chương:", currentTitle);
    if (newTitle === null || newTitle.trim() === "" || newTitle.trim() === currentTitle) return;

    try {
      onSetBusy("Đang đổi tên chương...");
      onSetError("");
      const res = await fetch(`/api/epubs/${encodeURIComponent(bookId)}/chapters/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename", index, newTitle: newTitle.trim() })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Lỗi khi đổi tên chương");
      }
      const data = await res.json();
      onUpdateAnalysis(data);
    } catch (err: any) {
      onSetError(err.message || "Lỗi khi đổi tên chương");
    } finally {
      onSetBusy("");
    }
  };

  const handleDelete = async (index: number, title: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isReordering) return;
    if (!confirm(`Bạn có chắc chắn muốn xoá chương "${title}" khỏi luồng đọc không?`)) return;

    try {
      onSetBusy("Đang xoá chương...");
      onSetError("");
      const res = await fetch(`/api/epubs/${encodeURIComponent(bookId)}/chapters/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", index })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Lỗi khi xoá chương");
      }
      const data = await res.json();
      onUpdateAnalysis(data);
    } catch (err: any) {
      onSetError(err.message || "Lỗi khi xoá chương");
    } finally {
      onSetBusy("");
    }
  };

  const confirmMerge = async () => {
    if (isReordering) return;
    if (selectedIndices.length < 2) return;

    try {
      onSetBusy("Đang gộp chương...");
      onSetError("");
      const res = await fetch(`/api/epubs/${encodeURIComponent(bookId)}/chapters/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "merge",
          mergeIndices: selectedIndices,
          newTitle: customTitle.trim(),
          stripMergedTitles: stripMergedTitles
        })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Lỗi khi gộp chương");
      }
      const data = await res.json();
      onUpdateAnalysis(data);
      setIsMergeModalOpen(false);
      setIsMultiSelect(false);
      setSelectedIndices([]);
    } catch (err: any) {
      onSetError(err.message || "Lỗi khi gộp chương");
    } finally {
      onSetBusy("");
    }
  };

  const handleSplit = async (index: number, title: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isReordering) return;
    if (!confirm(`Bạn có muốn tự động tách chương "${title}" thành các chương nhỏ dựa trên các thẻ tiêu đề (H1-H6) không?`)) return;

    try {
      onSetBusy("Đang tách chương...");
      onSetError("");
      const res = await fetch(`/api/epubs/${encodeURIComponent(bookId)}/chapters/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "split", index })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Lỗi khi tách chương");
      }
      const data = await res.json();
      onUpdateAnalysis(data);
    } catch (err: any) {
      onSetError(err.message || "Không tìm thấy đủ tiêu đề (H1-H6) trong chương này để tự động tách.");
    } finally {
      onSetBusy("");
    }
  };

  const handleRowClick = (chapter: Chapter) => {
    if (isReordering) return;
    if (isMultiSelect) {
      if (selectedIndices.includes(chapter.index)) {
        setSelectedIndices(selectedIndices.filter((idx) => idx !== chapter.index));
      } else {
        setSelectedIndices([...selectedIndices, chapter.index]);
      }
    } else {
      onPreview(chapter.index);
    }
  };

  const handleOpenMultiMerge = () => {
    if (isReordering) return;
    if (selectedIndices.length < 2) return;
    setIsMergeModalOpen(true);
    const mainCh = chapters.find((c) => c.index === selectedIndices[0]);
    setCustomTitle(mainCh?.title || "");
  };

  const handleAddChapter = async () => {
    if (isReordering) return;
    const title = prompt("Nhập tiêu đề cho chương mới:", "Chương mới");
    if (title === null) return;
    
    const index = previewIndex >= 0 && previewIndex < chapters.length ? previewIndex : 0;

    try {
      onSetBusy("Đang thêm chương mới...");
      onSetError("");
      const res = await fetch(`/api/epubs/${encodeURIComponent(bookId)}/chapters/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", index, newTitle: title.trim() })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Lỗi khi thêm chương mới");
      }
      const data = await res.json();
      onUpdateAnalysis(data);
      onPreview(index + 1);
    } catch (err: any) {
      onSetError(err.message || "Lỗi khi thêm chương mới");
    } finally {
      onSetBusy("");
    }
  };

  const handleDeleteMultiple = async () => {
    if (isReordering) return;
    if (selectedIndices.length === 0) return;
    if (!confirm(`Bạn có chắc chắn muốn xoá ${selectedIndices.length} chương đã chọn không?`)) return;

    try {
      onSetBusy("Đang xoá các chương đã chọn...");
      onSetError("");
      const res = await fetch(`/api/epubs/${encodeURIComponent(bookId)}/chapters/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete_multiple",
          mergeIndices: selectedIndices
        })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Lỗi khi xoá nhiều chương");
      }
      const data = await res.json();
      onUpdateAnalysis(data);
      setIsMultiSelect(false);
      setSelectedIndices([]);
    } catch (err: any) {
      onSetError(err.message || "Lỗi khi xoá nhiều chương");
    } finally {
      onSetBusy("");
    }
  };

  const availableChapters = chapters.filter((c) => !selectedIndices.includes(c.index));

  return (
    <section className={isReordering ? "panel chaptersPanel reordering" : "panel chaptersPanel"}>
      <div className="panelHeader" style={{ flexDirection: "column", alignItems: "stretch", gap: "8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
          <h3>Danh sách chương</h3>
          <span style={{ color: "#687168", fontSize: "12px", whiteSpace: "nowrap", flexShrink: 0 }}>{chapters.length} chương</span>
        </div>
        <div style={{ display: "flex", flexWrap: "nowrap", gap: "6px", justifyContent: "flex-end", width: "100%", minWidth: 0 }}>
          {!isMultiSelect && (
            <button
              type="button"
              className="smallButton"
              onClick={() => setIsAutoMergeOpen(true)}
              disabled={isReordering}
              title="Quét gộp tự động"
              style={{ width: "96px", padding: "0 8px", height: "32px", fontSize: "11px", gap: "4px", flex: "0 0 auto" }}
            >
              <Combine size={11} />
              <span>Quét gộp</span>
            </button>
          )}
          {!isMultiSelect && (
            <button
              type="button"
              className="smallButton strong"
              onClick={handleAddChapter}
              disabled={isReordering}
              style={{ width: "68px", padding: "0 8px", height: "32px", fontSize: "11px", gap: "4px", flex: "0 0 auto" }}
            >
              <Plus size={11} />
              <span>Thêm</span>
            </button>
          )}
          <button
            type="button"
            className={`smallButton ${isMultiSelect ? "active" : ""}`}
            disabled={isReordering}
            onClick={() => {
              setIsMultiSelect(!isMultiSelect);
              setSelectedIndices([]);
            }}
            title={isMultiSelect ? "Hủy chọn" : "Chọn nhiều"}
            style={{ width: "68px", padding: "0 8px", height: "32px", fontSize: "11px", flex: "0 0 auto" }}
          >
            {isMultiSelect ? "Hủy" : "Chọn"}
          </button>
          {isMultiSelect && selectedIndices.length >= 2 && (
            <button
              type="button"
              className="smallButton strong"
              onClick={handleOpenMultiMerge}
              disabled={isReordering}
              style={{ width: "86px", padding: "0 8px", height: "32px", fontSize: "11px", gap: "4px", flex: "0 0 auto" }}
            >
              <Combine size={11} />
              <span>Gộp ({selectedIndices.length})</span>
            </button>
          )}
          {isMultiSelect && selectedIndices.length >= 1 && (
            <button
              type="button"
              className="smallButton danger"
              onClick={handleDeleteMultiple}
              disabled={isReordering}
              style={{ width: "82px", padding: "0 8px", height: "32px", fontSize: "11px", gap: "4px", flex: "0 0 auto" }}
            >
              <Trash2 size={11} />
              <span>Xoá ({selectedIndices.length})</span>
            </button>
          )}
        </div>
      </div>
      <div
        className="chapterList"
        aria-busy={isReordering}
        onDragOver={(e) => {
          if (isMultiSelect || isReordering || draggedIndexRef.current === null || dragOverIndexRef.current === null) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={handleDropAtCurrentTarget}
      >
        {isReordering && <div className="chapterListOverlay">Đang sắp xếp...</div>}
        {chapters.map((chapter) => (
          <React.Fragment key={`${chapter.index}-${chapter.path}`}>
            {dragOverIndex === chapter.index && dropPosition === "before" && (
              <div
                className="dropIndicator"
                style={{
                  height: "4px",
                  background: "#2f7d69",
                  borderRadius: "2px",
                  margin: "6px 0",
                  boxShadow: "0 0 8px rgba(47, 125, 105, 0.8)",
                  transition: "all 0.15s ease-in-out",
                  pointerEvents: "none"
                }}
              />
            )}
            <div
              className={`${chapter.index === previewIndex ? "chapterRow active" : "chapterRow"} ${isMultiSelect ? "multiSelectMode" : ""}`}
              onClick={() => handleRowClick(chapter)}
              draggable={!isMultiSelect && !isReordering}
              onDragStart={(e) => {
                if (isMultiSelect || isReordering) return;
                draggedIndexRef.current = chapter.index;
                setDraggedIndex(chapter.index);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(chapter.index));
              }}
              onDragOver={(e) => {
                if (isMultiSelect || isReordering || draggedIndexRef.current === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                
                const rect = e.currentTarget.getBoundingClientRect();
                const relativeY = e.clientY - rect.top;
                const isBefore = relativeY < rect.height / 2;
                const position = isBefore ? "before" : "after";
                
                setDragTarget(chapter.index, position);
              }}
              onDrop={handleDropAtCurrentTarget}
              onDragEnd={resetDragState}
              style={
                draggedIndex === chapter.index
                  ? { opacity: 0.4 }
                  : {}
              }
            >
              {isMultiSelect && (
                <div
                  className={`chapterCheckbox ${selectedIndices.includes(chapter.index) ? "selected" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRowClick(chapter);
                  }}
                >
                  {selectedIndices.includes(chapter.index) ? selectedIndices.indexOf(chapter.index) + 1 : ""}
                </div>
              )}
              <span className="chapterIndex">{chapter.index}</span>
              <span className="chapterTitle" title={chapter.title}>
                {chapter.title}
              </span>
              {!isMultiSelect && (
                <div className="chapterActions">
                  <button
                    type="button"
                    className="chapterActionBtn"
                    disabled={isReordering}
                    onClick={(e) => handleRename(chapter.index, chapter.title, e)}
                    title="Đổi tên"
                  >
                    <Edit2 size={12} />
                  </button>
                  {chapters.length > 1 && (
                    <button
                      type="button"
                      className="chapterActionBtn"
                      disabled={isReordering}
                      onClick={(e) => {
                        e.stopPropagation();
                        const defaultTarget =
                          chapter.index === chapters.length - 1 ? chapter.index - 1 : chapter.index + 1;
                        setSelectedIndices([chapter.index, defaultTarget]);
                        setIsMergeModalOpen(true);
                        setCustomTitle(chapter.title);
                      }}
                      title="Gộp chương sách"
                    >
                      <Combine size={12} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="chapterActionBtn"
                    disabled={isReordering}
                    onClick={(e) => handleSplit(chapter.index, chapter.title, e)}
                    title="Tách tự động (H1-H6)"
                  >
                    <Scissors size={12} />
                  </button>
                  <button
                    type="button"
                    className="chapterActionBtn danger"
                    disabled={isReordering}
                    onClick={(e) => handleDelete(chapter.index, chapter.title, e)}
                    title="Xoá chương"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
            </div>
            {dragOverIndex === chapter.index && dropPosition === "after" && (
              <div
                className="dropIndicator"
                style={{
                  height: "4px",
                  background: "#2f7d69",
                  borderRadius: "2px",
                  margin: "6px 0",
                  boxShadow: "0 0 8px rgba(47, 125, 105, 0.8)",
                  transition: "all 0.15s ease-in-out",
                  pointerEvents: "none"
                }}
              />
            )}
          </React.Fragment>
        ))}
      </div>

      {isMergeModalOpen && selectedIndices.length >= 2 && (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => setIsMergeModalOpen(false)}>
          <section className="metadataModal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <header className="modalHeader">
              <div>
                <h3>Gộp chương sách</h3>
                <p>Nội dung các chương bên dưới sẽ được gộp tuần tự vào chương chính</p>
              </div>
              <button className="iconButton" onClick={() => setIsMergeModalOpen(false)} title="Đóng">
                <X size={18} />
              </button>
            </header>

            <div className="mergeBody">
              <span className="coverLabel" style={{ marginBottom: "4px" }}>
                Thứ tự gộp chương (Dùng nút lên/xuống để sắp xếp thứ tự):
              </span>
              <div className="mergeOrderList">
                {selectedIndices.map((idx, seq) => {
                  const ch = chapters.find((c) => c.index === idx);
                  return (
                    <div key={idx} className="mergeOrderItem">
                      <span className="mergeOrderSeq">{seq + 1}</span>
                      <span className="mergeOrderTitle" title={ch?.title}>
                        {ch?.title || `Chương ${idx}`}
                      </span>
                      {seq === 0 && (
                        <span className="mainChapterLabel">
                          (Chương nhận nội dung chính)
                        </span>
                      )}
                      
                      <div style={{ display: "flex", gap: "4px", marginLeft: seq === 0 ? "8px" : "auto", alignItems: "center" }}>
                        <button
                          type="button"
                          className="chapterActionBtn"
                          disabled={seq === 0}
                          onClick={() => {
                            const list = [...selectedIndices];
                            const temp = list[seq];
                            list[seq] = list[seq - 1];
                            list[seq - 1] = temp;
                            setSelectedIndices(list);
                          }}
                          style={{ padding: "2px 4px", fontSize: "10px", height: "20px", display: "flex", alignItems: "center", justifyContent: "center" }}
                          title="Di chuyển lên"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          className="chapterActionBtn"
                          disabled={seq === selectedIndices.length - 1}
                          onClick={() => {
                            const list = [...selectedIndices];
                            const temp = list[seq];
                            list[seq] = list[seq + 1];
                            list[seq + 1] = temp;
                            setSelectedIndices(list);
                          }}
                          style={{ padding: "2px 4px", fontSize: "10px", height: "20px", display: "flex", alignItems: "center", justifyContent: "center" }}
                          title="Di chuyển xuống"
                        >
                          ▼
                        </button>
                        <button
                          type="button"
                          className="chapterActionBtn danger"
                          disabled={selectedIndices.length <= 2}
                          onClick={() => {
                            setSelectedIndices(selectedIndices.filter((x) => x !== idx));
                          }}
                          style={{ padding: "2px 4px", fontSize: "10px", height: "20px", display: "flex", alignItems: "center", justifyContent: "center" }}
                          title="Xóa khỏi danh sách gộp"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {availableChapters.length > 0 && (
                <div className="field" style={{ marginBottom: "12px" }}>
                  <span style={{ fontSize: "11px", fontWeight: "600", color: "#68655c" }}>Thêm chương khác vào danh sách gộp:</span>
                  <select
                    value=""
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val)) {
                        setSelectedIndices([...selectedIndices, val]);
                      }
                    }}
                    style={{
                      width: "100%",
                      height: "32px",
                      border: "1px solid #c9c6bd",
                      borderRadius: "6px",
                      background: "#fff",
                      padding: "0 8px",
                      fontSize: "12px",
                      color: "#17201c",
                      outline: "none",
                      marginTop: "4px"
                    }}
                  >
                    <option value="" disabled>-- Chọn chương để thêm --</option>
                    {availableChapters.map((c) => (
                      <option key={c.index} value={c.index}>
                        {c.index} - {c.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {(() => {
                const mainCh = chapters.find((c) => c.index === selectedIndices[0]);
                const titleA = mainCh ? mainCh.title : "";
                
                const titles = selectedIndices.map(idx => chapters.find(c => c.index === idx)?.title || "");
                const suggestionCombined = titles.join(" & ");

                return (
                  <div className="mergeOptions">
                    <span className="coverLabel">Gợi ý tên chương:</span>
                    <div
                      className={customTitle === titleA ? "mergeOption active" : "mergeOption"}
                      onClick={() => setCustomTitle(titleA)}
                    >
                      <span className="mergeRadio" />
                      <span className="mergeOptionText">{titleA} (Tên chương chính)</span>
                    </div>
                    <div
                      className={customTitle === suggestionCombined ? "mergeOption active" : "mergeOption"}
                      onClick={() => setCustomTitle(suggestionCombined)}
                    >
                      <span className="mergeRadio" />
                      <span className="mergeOptionText">
                        {suggestionCombined} (Gộp tất cả)
                      </span>
                    </div>
                  </div>
                );
              })()}

              <div className="field">
                <span>Tên chương sau khi gộp:</span>
                <input
                  type="text"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="Nhập tên chương..."
                  autoFocus
                />
              </div>

              <div className="field" style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "12px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  id="stripMergedTitles"
                  checked={stripMergedTitles}
                  onChange={(e) => setStripMergedTitles(e.target.checked)}
                  style={{ width: "auto", height: "auto", cursor: "pointer" }}
                />
                <label htmlFor="stripMergedTitles" style={{ fontSize: "12px", color: "#17201c", cursor: "pointer", userSelect: "none" }}>
                  Tự động xoá tiêu đề chương phụ trong nội dung gộp
                </label>
              </div>
            </div>

            <footer className="modalFooter">
              <button type="button" className="smallButton" onClick={() => setIsMergeModalOpen(false)}>
                Hủy
              </button>
              <button
                type="button"
                className="smallButton strong"
                onClick={confirmMerge}
                disabled={!customTitle.trim()}
              >
                Gộp chương
              </button>
            </footer>
          </section>
        </div>
      )}
      {isAutoMergeOpen && (
        <AutoMergeModal
          open={isAutoMergeOpen}
          bookId={bookId}
          chapters={chapters}
          onClose={() => setIsAutoMergeOpen(false)}
          onUpdateAnalysis={onUpdateAnalysis}
          onSetBusy={onSetBusy}
          onSetError={onSetError}
        />
      )}
    </section>
  );
}
