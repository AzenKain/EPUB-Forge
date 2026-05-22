import { useState, useRef } from "react";
import { BookOpen, FileArchive, PanelLeftClose, PanelLeftOpen, RefreshCw, Combine, FileText, Plus, Trash2, Puzzle } from "lucide-react";
import type { EpubFile } from "../lib/types";
import { formatBytes } from "../lib/format";

type Props = {
  books: EpubFile[];
  selectedId: string;
  busy: boolean;
  collapsed: boolean;
  onRefresh: () => void;
  onSelect: (id: string) => void;
  onToggle: () => void;
  onMergeClick: () => void;
  onImportTxtClick: () => void;
  onExtensionsClick: () => void;
  onUploadBooks: (files: File[]) => void;
  onDeleteBook: (id: string, name: string) => void;
  onDeleteBooks: (ids: string[]) => void;
};

export function BookSidebar({
  books,
  selectedId,
  busy,
  collapsed,
  onRefresh,
  onSelect,
  onToggle,
  onMergeClick,
  onImportTxtClick,
  onExtensionsClick,
  onUploadBooks,
  onDeleteBook,
  onDeleteBooks
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<string[]>([]);

  const handleAddBookClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const filesArray = Array.from(e.target.files);
      if (filesArray.length > 0) {
        onUploadBooks(filesArray);
        e.target.value = "";
      }
    }
  };

  const toggleBulkMode = () => {
    setIsBulkMode(!isBulkMode);
    setBulkSelectedIds([]);
  };

  const handleBookClick = (bookId: string) => {
    if (isBulkMode) {
      if (bulkSelectedIds.includes(bookId)) {
        setBulkSelectedIds(bulkSelectedIds.filter((id) => id !== bookId));
      } else {
        setBulkSelectedIds([...bulkSelectedIds, bookId]);
      }
    } else {
      onSelect(bookId);
    }
  };

  const handleBulkDelete = () => {
    if (bulkSelectedIds.length > 0) {
      onDeleteBooks(bulkSelectedIds);
      setIsBulkMode(false);
      setBulkSelectedIds([]);
    }
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <button className="sidebarToggle" onClick={onToggle} title={collapsed ? "Mở danh sách EPUB" : "Thu gọn danh sách EPUB"}>
          {collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
        </button>
        <FileArchive className="brandIcon" size={22} />
        <div className="sidebarText">
          <h1>EPUBForge</h1>
          <p>{books.length} EPUB trong thư mục</p>
        </div>
      </div>

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".epub"
        multiple
        style={{ display: "none" }}
      />

      <div className="sidebarText" style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", width: "100%" }}>
          <button className="toolButton" onClick={handleAddBookClick} disabled={busy} title="Thêm sách EPUB từ hệ thống" style={{ width: "100%" }}>
            <Plus size={18} />
            <span>Mở sách</span>
          </button>
          <button className="toolButton" onClick={onRefresh} disabled={busy} title="Quét lại thư mục" style={{ width: "100%" }}>
            <RefreshCw size={18} />
            <span>Quét lại</span>
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", width: "100%" }}>
          <button className="toolButton" onClick={onMergeClick} disabled={busy} title="Gộp nhiều EPUB thành 1" style={{ width: "100%" }}>
            <Combine size={18} />
            <span>Gộp EPUB</span>
          </button>
          <button className="toolButton" onClick={onImportTxtClick} disabled={busy} title="Tạo EPUB từ chương text hoặc manga" style={{ width: "100%" }}>
            <FileText size={18} />
            <span>Tạo EPUB</span>
          </button>
        </div>
        <button className="toolButton" onClick={onExtensionsClick} disabled={busy} title="Tiện ích tải/xử lý EPUB từ website" style={{ width: "100%" }}>
          <Puzzle size={18} />
          <span>Tiện ích mở rộng</span>
        </button>
      </div>

      {!collapsed && (
        <div className="bookListHeader" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 10px 8px 10px", borderBottom: "1px solid #e0dcd3", margin: "16px 0 8px 0" }}>
          {isBulkMode ? (
            <>
              <span style={{ fontWeight: "bold", fontSize: "12px", color: "#8f2c18" }}>
                Đã chọn: {bulkSelectedIds.length}
              </span>
              <div style={{ display: "flex", gap: "10px" }}>
                {bulkSelectedIds.length > 0 && (
                  <button
                    onClick={handleBulkDelete}
                    style={{ background: "none", border: "none", color: "#8f2c18", cursor: "pointer", fontSize: "12px", fontWeight: "bold", padding: 0 }}
                  >
                    Xoá đã chọn
                  </button>
                )}
                <button
                  onClick={toggleBulkMode}
                  style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: "12px", padding: 0 }}
                >
                  Huỷ
                </button>
              </div>
            </>
          ) : (
            <>
              <span style={{ fontWeight: "bold", fontSize: "12px", color: "#666" }}>DANH SÁCH SÁCH</span>
              {books.length > 0 && (
                <button
                  onClick={toggleBulkMode}
                  style={{ background: "none", border: "none", color: "#1a5f49", cursor: "pointer", fontSize: "12px", fontWeight: "bold", padding: 0 }}
                >
                  Chọn nhiều
                </button>
              )}
            </>
          )}
        </div>
      )}

      <div className="bookList">
        {books.map((book) => {
          const isChecked = bulkSelectedIds.includes(book.id);
          return (
            <div
              key={book.id}
              className={book.id === selectedId && !isBulkMode ? "bookItem active" : "bookItem"}
              onClick={() => handleBookClick(book.id)}
              title={book.name}
              data-tooltip={book.name}
              style={{ position: "relative", cursor: "pointer" }}
            >
              {isBulkMode ? (
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => {}} 
                  style={{ marginRight: "4px", cursor: "pointer" }}
                />
              ) : (
                <BookOpen size={16} style={{ flexShrink: 0 }} />
              )}
              <span className="sidebarText" style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", marginRight: "20px" }}>
                {book.name}
              </span>
              <small className="sidebarText">{formatBytes(book.size)}</small>
              {!isBulkMode && (
                <button
                  className="bookDeleteBtn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteBook(book.id, book.name);
                  }}
                  title={`Xoá ${book.name}`}
                  disabled={busy}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
