import { BookOpen, FileArchive, PanelLeftClose, PanelLeftOpen, RefreshCw, Combine, FileText } from "lucide-react";
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
};

export function BookSidebar({ books, selectedId, busy, collapsed, onRefresh, onSelect, onToggle, onMergeClick, onImportTxtClick }: Props) {
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

      <div className="sidebarText" style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", width: "100%" }}>
          <button className="toolButton" onClick={onRefresh} disabled={busy} title="Quét lại thư mục" style={{ width: "100%" }}>
            <RefreshCw size={18} />
            <span>Quét lại</span>
          </button>
          <button className="toolButton" onClick={onMergeClick} disabled={busy} title="Gộp nhiều EPUB thành 1" style={{ width: "100%" }}>
            <Combine size={18} />
            <span>Gộp EPUB</span>
          </button>
        </div>
        <button className="toolButton" onClick={onImportTxtClick} disabled={busy} title="Nhập truyện từ file TXT thô" style={{ width: "100%" }}>
          <FileText size={18} />
          <span>Nhập truyện TXT</span>
        </button>
      </div>

      <div className="bookList">
        {books.map((book) => (
          <button
            key={book.id}
            className={book.id === selectedId ? "bookItem active" : "bookItem"}
            onClick={() => onSelect(book.id)}
            title={book.name}
            data-tooltip={book.name}
          >
            <BookOpen size={16} />
            <span className="sidebarText">{book.name}</span>
            <small className="sidebarText">{formatBytes(book.size)}</small>
          </button>
        ))}
      </div>
    </aside>
  );
}

