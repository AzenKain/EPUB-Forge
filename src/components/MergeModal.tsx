import React, { useEffect, useState } from "react";
import { Combine, X } from "lucide-react";
import type { EpubFile } from "../lib/types";

type Props = {
  open: boolean;
  books: EpubFile[];
  currentBookId?: string;
  onClose: () => void;
  onMergeSuccess: (newFileName: string) => Promise<void>;
  onSetBusy: (busy: string) => void;
  onSetError: (error: string) => void;
};

export function MergeModal({
  open,
  books,
  currentBookId,
  onClose,
  onMergeSuccess,
  onSetBusy,
  onSetError
}: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [customTitle, setCustomTitle] = useState("");

  
  useEffect(() => {
    if (open) {
      if (currentBookId && books.some((b) => b.id === currentBookId)) {
        setSelectedIds([currentBookId]);
        const book = books.find((b) => b.id === currentBookId);
        if (book) {
          setCustomTitle(stripExtension(book.name) + " Merged");
        }
      } else if (books.length > 0) {
        setSelectedIds([books[0].id]);
        setCustomTitle(stripExtension(books[0].name) + " Merged");
      } else {
        setSelectedIds([]);
        setCustomTitle("");
      }
    }
  }, [open, currentBookId, books]);

  if (!open) return null;

  function stripExtension(filename: string): string {
    return filename.replace(/\.epub$/i, "");
  }

  const availableBooks = books.filter((b) => !selectedIds.includes(b.id));

  const handleMerge = async () => {
    if (selectedIds.length < 2) {
      alert("Vui lòng chọn ít nhất 2 EPUB để gộp.");
      return;
    }
    if (!customTitle.trim()) {
      alert("Vui lòng nhập tên cho EPUB gộp.");
      return;
    }

    try {
      onSetBusy("Đang gộp các tệp EPUB...");
      onSetError("");
      const res = await fetch("/api/epubs/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookIds: selectedIds,
          title: customTitle.trim()
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Lỗi khi gộp EPUB");
      }

      const data = await res.json();
      onClose();
      await onMergeSuccess(data.fileName);
    } catch (err: any) {
      onSetError(err.message || "Lỗi khi gộp EPUB");
    } finally {
      onSetBusy("");
    }
  };

  
  const selectedBooks = selectedIds.map((id) => books.find((b) => b.id === id)).filter(Boolean) as EpubFile[];
  const firstBookTitle = selectedBooks[0] ? stripExtension(selectedBooks[0].name) : "";
  const combinedSuggestion = selectedBooks.map((b) => stripExtension(b.name)).join(" & ");

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="metadataModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-title"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: "min(620px, 100%)" }}
      >
        <header className="modalHeader">
          <div>
            <h3 id="merge-title">Gộp nhiều EPUB thành 1</h3>
            <p>Nội dung các tệp EPUB sẽ được gộp tuần tự theo thứ tự hiển thị bên dưới</p>
          </div>
          <button className="iconButton" onClick={onClose} title="Đóng">
            <X size={18} />
          </button>
        </header>

        <div className="mergeBody">
          <span className="coverLabel" style={{ marginBottom: "4px" }}>
            Thứ tự gộp tệp EPUB (Dùng nút lên/xuống để sắp xếp thứ tự):
          </span>
          
          <div className="mergeOrderList">
            {selectedIds.length === 0 ? (
              <div style={{ padding: "12px", textAlign: "center", color: "#8a928a", fontSize: "12px" }}>
                Chưa chọn tệp EPUB nào
              </div>
            ) : (
              selectedIds.map((id, seq) => {
                const book = books.find((b) => b.id === id);
                return (
                  <div key={id} className="mergeOrderItem">
                    <span className="mergeOrderSeq">{seq + 1}</span>
                    <span className="mergeOrderTitle" title={book?.name} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                      {book?.name || `Sách ${id}`}
                    </span>
                    {seq === 0 && (
                      <span className="mainChapterLabel" style={{ marginRight: "8px" }}>
                        (Sách chính - Lấy ảnh bìa/metadata gốc)
                      </span>
                    )}

                    <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                      <button
                        type="button"
                        className="chapterActionBtn"
                        disabled={seq === 0}
                        onClick={() => {
                          const list = [...selectedIds];
                          const temp = list[seq];
                          list[seq] = list[seq - 1];
                          list[seq - 1] = temp;
                          setSelectedIds(list);
                        }}
                        style={{ padding: "2px 4px", fontSize: "10px", height: "20px", display: "flex", alignItems: "center", justifyContent: "center" }}
                        title="Di chuyển lên"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        className="chapterActionBtn"
                        disabled={seq === selectedIds.length - 1}
                        onClick={() => {
                          const list = [...selectedIds];
                          const temp = list[seq];
                          list[seq] = list[seq + 1];
                          list[seq + 1] = temp;
                          setSelectedIds(list);
                        }}
                        style={{ padding: "2px 4px", fontSize: "10px", height: "20px", display: "flex", alignItems: "center", justifyContent: "center" }}
                        title="Di chuyển xuống"
                      >
                        ▼
                      </button>
                      <button
                        type="button"
                        className="chapterActionBtn danger"
                        onClick={() => {
                          setSelectedIds(selectedIds.filter((x) => x !== id));
                        }}
                        style={{ padding: "2px 4px", fontSize: "10px", height: "20px", display: "flex", alignItems: "center", justifyContent: "center" }}
                        title="Xóa khỏi danh sách gộp"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {availableBooks.length > 0 && (
            <div className="field" style={{ marginBottom: "12px" }}>
              <span style={{ fontSize: "11px", fontWeight: "600", color: "#68655c" }}>Thêm tệp EPUB khác vào danh sách gộp:</span>
              <select
                value=""
                onChange={(e) => {
                  const val = e.target.value;
                  if (val) {
                    setSelectedIds([...selectedIds, val]);
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
                <option value="" disabled>-- Chọn tệp EPUB để thêm --</option>
                {availableBooks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {selectedIds.length >= 2 && (
            <div className="mergeOptions">
              <span className="coverLabel">Gợi ý tên sách gộp:</span>
              <div
                className={customTitle === firstBookTitle ? "mergeOption active" : "mergeOption"}
                onClick={() => setCustomTitle(firstBookTitle)}
              >
                <span className="mergeRadio" />
                <span className="mergeOptionText">{firstBookTitle} (Tên sách chính)</span>
              </div>
              <div
                className={customTitle === combinedSuggestion ? "mergeOption active" : "mergeOption"}
                onClick={() => setCustomTitle(combinedSuggestion)}
              >
                <span className="mergeRadio" />
                <span className="mergeOptionText" title={combinedSuggestion}>
                  {combinedSuggestion} (Gộp tất cả)
                </span>
              </div>
            </div>
          )}

          <div className="field">
            <span>Tên sách sau khi gộp:</span>
            <input
              type="text"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              placeholder="Nhập tên tệp sách..."
              autoFocus
            />
          </div>
        </div>

        <footer className="modalFooter">
          <button type="button" className="smallButton" onClick={onClose}>
            Hủy
          </button>
          <button
            type="button"
            className="smallButton strong"
            onClick={handleMerge}
            disabled={selectedIds.length < 2 || !customTitle.trim()}
          >
            <Combine size={14} />
            <span>Bắt đầu gộp</span>
          </button>
        </footer>
      </section>
    </div>
  );
}
