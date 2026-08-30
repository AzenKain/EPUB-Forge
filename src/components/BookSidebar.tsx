import { useState, useRef, useEffect, useMemo } from "react";
import {
  BookOpen,
  FileArchive,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Combine,
  FileText,
  Plus,
  Trash2,
  Puzzle,
  Pencil,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  FolderPlus,
  FolderInput,
  Search,
  X,
  GripVertical,
  Loader2
} from "lucide-react";
import type { EpubFile } from "../lib/types";
import { formatBytes } from "../lib/format";

type Props = {
  books: EpubFile[];
  folders: string[];
  selectedId: string;
  busy: boolean;
  movingBookIds?: Set<string>;
  collapsed: boolean;
  onRefresh: () => void;
  onSelect: (id: string) => void;
  onToggle: () => void;
  onMergeClick: () => void;
  onImportTxtClick: () => void;
  onExtensionsClick: () => void;
  onUploadBooks: (files: File[], folder?: string) => void;
  onDeleteBook: (id: string, name: string) => void;
  onDeleteBooks: (ids: string[]) => void;
  onRenameBook: (id: string, name: string) => void;
  onMoveBook: (id: string, targetFolder: string) => void;
  onMoveBooks?: (ids: string[], targetFolder: string) => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (oldName: string, newName: string) => void;
  onDeleteFolder: (name: string) => void;
};

export function BookSidebar({
  books,
  folders,
  selectedId,
  busy,
  movingBookIds,
  collapsed,
  onRefresh,
  onSelect,
  onToggle,
  onMergeClick,
  onImportTxtClick,
  onExtensionsClick,
  onUploadBooks,
  onDeleteBook,
  onDeleteBooks,
  onRenameBook,
  onMoveBook,
  onMoveBooks,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [targetUploadFolder, setTargetUploadFolder] = useState<string>("");
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});

  // Drag and Drop state
  const [draggedBook, setDraggedBook] = useState<EpubFile | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const [justDroppedBookId, setJustDroppedBookId] = useState<string | null>(null);
  const [justReceivedFolder, setJustReceivedFolder] = useState<string | null>(null);
  const dropTimeoutRef = useRef<number | null>(null);
  const folderTimeoutRef = useRef<number | null>(null);

  // Move Modal state
  const [moveBook, setMoveBook] = useState<EpubFile | null>(null);
  const [isBulkMoveModal, setIsBulkMoveModal] = useState(false);
  const [selectedTargetFolder, setSelectedTargetFolder] = useState<string>("");
  const [customNewFolderName, setCustomNewFolderName] = useState<string>("");
  const [isCreatingNewFolderInMove, setIsCreatingNewFolderInMove] = useState(false);

  // Auto-expand folder when a book inside it is selected
  useEffect(() => {
    if (!selectedId) return;
    const selectedBook = books.find((b) => b.id === selectedId);
    if (selectedBook?.folder) {
      setExpandedFolders((prev) => ({ ...prev, [selectedBook.folder!]: true }));
    }
  }, [selectedId, books]);

  // Combine and deduplicate all folder names
  const allFolderNames = useMemo(() => {
    const set = new Set<string>();
    for (const f of folders) {
      if (f && f.trim()) set.add(f.trim());
    }
    for (const b of books) {
      if (b.folder && b.folder.trim()) set.add(b.folder.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "vi", { sensitivity: "base" }));
  }, [folders, books]);

  // Group books by folder
  const { rootBooks, folderBooksMap } = useMemo(() => {
    const root: EpubFile[] = [];
    const map: Record<string, EpubFile[]> = {};

    for (const f of allFolderNames) {
      map[f] = [];
    }

    for (const b of books) {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch = !q || b.name.toLowerCase().includes(q) || (b.folder && b.folder.toLowerCase().includes(q));
      if (!matchesSearch) continue;

      if (b.folder && b.folder.trim()) {
        const f = b.folder.trim();
        if (!map[f]) map[f] = [];
        map[f].push(b);
      } else {
        root.push(b);
      }
    }

    return { rootBooks: root, folderBooksMap: map };
  }, [books, allFolderNames, searchQuery]);

  const hoverExpandTimerRef = useRef<number | null>(null);

  const triggerLandingAnimation = (bookId: string, folder: string) => {
    setJustDroppedBookId(bookId);
    if (folder) setJustReceivedFolder(folder);

    if (dropTimeoutRef.current) window.clearTimeout(dropTimeoutRef.current);
    if (folderTimeoutRef.current) window.clearTimeout(folderTimeoutRef.current);

    dropTimeoutRef.current = window.setTimeout(() => setJustDroppedBookId(null), 1500);
    folderTimeoutRef.current = window.setTimeout(() => setJustReceivedFolder(null), 1200);
  };

  // Drag and Drop event handlers
  const handleDragStart = (e: React.DragEvent, book: EpubFile) => {
    if (busy) {
      e.preventDefault();
      return;
    }
    setDraggedBook(book);
    e.dataTransfer.effectAllowed = "move";
    if (isBulkMode && bulkSelectedIds.includes(book.id) && bulkSelectedIds.length > 1) {
      e.dataTransfer.setData("application/json", JSON.stringify({ type: "BULK", ids: bulkSelectedIds }));
      e.dataTransfer.setData("text/plain", book.id);
    } else {
      e.dataTransfer.setData(
        "application/json",
        JSON.stringify({ type: "SINGLE", id: book.id, name: book.name, sourceFolder: book.folder || "" })
      );
      e.dataTransfer.setData("text/plain", book.id);
    }
  };

  const handleDragOver = (e: React.DragEvent, targetFolder: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverTarget !== targetFolder) {
      setDragOverTarget(targetFolder);
      if (targetFolder && targetFolder !== "__ROOT__") {
        if (hoverExpandTimerRef.current) window.clearTimeout(hoverExpandTimerRef.current);
        hoverExpandTimerRef.current = window.setTimeout(() => {
          setExpandedFolders((prev) => ({ ...prev, [targetFolder]: true }));
        }, 300);
      }
    }
  };

  const handleDragLeave = (e: React.DragEvent, targetFolder: string) => {
    e.preventDefault();
    if (e.currentTarget.contains(e.relatedTarget as Node)) {
      return;
    }
    if (hoverExpandTimerRef.current) {
      window.clearTimeout(hoverExpandTimerRef.current);
      hoverExpandTimerRef.current = null;
    }
    if (dragOverTarget === targetFolder) {
      setDragOverTarget(null);
    }
  };

  const handleDrop = (e: React.DragEvent, targetFolder: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (hoverExpandTimerRef.current) {
      window.clearTimeout(hoverExpandTimerRef.current);
      hoverExpandTimerRef.current = null;
    }
    const target = targetFolder === "__ROOT__" ? "" : targetFolder;
    setDragOverTarget(null);

    let bookIdToMove: string | null = null;
    let bulkIdsToMove: string[] | null = null;
    let sourceFolder = "";

    try {
      const rawJson = e.dataTransfer.getData("application/json");
      if (rawJson) {
        const parsed = JSON.parse(rawJson);
        if (parsed.type === "BULK" && Array.isArray(parsed.ids) && parsed.ids.length > 0) {
          bulkIdsToMove = parsed.ids;
        } else if (parsed.type === "SINGLE" && parsed.id) {
          bookIdToMove = parsed.id;
          sourceFolder = parsed.sourceFolder || "";
        }
      }
    } catch {
      // fallback
    }

    if (!bookIdToMove && !bulkIdsToMove) {
      const fallbackId = e.dataTransfer.getData("text/plain");
      if (fallbackId) {
        bookIdToMove = fallbackId;
        const sourceBook = books.find((b) => b.id === fallbackId);
        if (sourceBook) sourceFolder = sourceBook.folder || "";
      }
    }

    // Direct React state fallback - NEVER FAILS!
    if (!bookIdToMove && !bulkIdsToMove && draggedBook) {
      if (isBulkMode && bulkSelectedIds.includes(draggedBook.id) && bulkSelectedIds.length > 1) {
        bulkIdsToMove = bulkSelectedIds;
      } else {
        bookIdToMove = draggedBook.id;
        sourceFolder = draggedBook.folder || "";
      }
    }

    setDraggedBook(null);

    if (bulkIdsToMove && bulkIdsToMove.length > 0) {
      if (onMoveBooks) {
        onMoveBooks(bulkIdsToMove, target);
      } else {
        for (const id of bulkIdsToMove) {
          onMoveBook(id, target);
        }
      }
      setIsBulkMode(false);
      setBulkSelectedIds([]);
      if (target) {
        setExpandedFolders((prev) => ({ ...prev, [target]: true }));
      }
      if (bulkIdsToMove[0]) triggerLandingAnimation(bulkIdsToMove[0], target);
      return;
    }

    if (bookIdToMove && sourceFolder !== target) {
      onMoveBook(bookIdToMove, target);
      if (target) {
        setExpandedFolders((prev) => ({ ...prev, [target]: true }));
      }
      triggerLandingAnimation(bookIdToMove, target);
    }
  };

  const handleDragEnd = () => {
    if (hoverExpandTimerRef.current) {
      window.clearTimeout(hoverExpandTimerRef.current);
      hoverExpandTimerRef.current = null;
    }
    setDraggedBook(null);
    setDragOverTarget(null);
  };

  const handleAddBookClick = (folder: string = "") => {
    setTargetUploadFolder(folder);
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const filesArray = Array.from(e.target.files);
      if (filesArray.length > 0) {
        onUploadBooks(filesArray, targetUploadFolder);
        e.target.value = "";
        setTargetUploadFolder("");
      }
    }
  };

  const toggleBulkMode = () => {
    setIsBulkMode(!isBulkMode);
    setBulkSelectedIds([]);
  };

  const toggleFolder = (folderName: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedFolders((prev) => ({
      ...prev,
      [folderName]: prev[folderName] === undefined ? false : !prev[folderName]
    }));
  };

  const isFolderExpanded = (folderName: string) => {
    return expandedFolders[folderName] !== false; // Default to expanded
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

  const handleFolderCheckboxToggle = (folderName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const booksInFolder = folderBooksMap[folderName] || [];
    const folderBookIds = booksInFolder.map((b) => b.id);
    const allSelected = folderBookIds.length > 0 && folderBookIds.every((id) => bulkSelectedIds.includes(id));

    if (allSelected) {
      setBulkSelectedIds(bulkSelectedIds.filter((id) => !folderBookIds.includes(id)));
    } else {
      const newSet = new Set([...bulkSelectedIds, ...folderBookIds]);
      setBulkSelectedIds(Array.from(newSet));
    }
  };

  const handleBulkDelete = () => {
    if (bulkSelectedIds.length > 0) {
      onDeleteBooks(bulkSelectedIds);
      setIsBulkMode(false);
      setBulkSelectedIds([]);
    }
  };

  const handleOpenBulkMove = () => {
    if (bulkSelectedIds.length === 0) return;
    setIsBulkMoveModal(true);
    setMoveBook(null);
    setSelectedTargetFolder("");
    setIsCreatingNewFolderInMove(false);
    setCustomNewFolderName("");
  };

  const handleOpenSingleMove = (book: EpubFile) => {
    setMoveBook(book);
    setIsBulkMoveModal(false);
    setSelectedTargetFolder(book.folder || "");
    setIsCreatingNewFolderInMove(false);
    setCustomNewFolderName("");
  };

  const handleConfirmMove = () => {
    let destFolder = selectedTargetFolder;
    if (isCreatingNewFolderInMove) {
      destFolder = customNewFolderName.trim();
      if (!destFolder) return;
    }

    if (isBulkMoveModal) {
      if (onMoveBooks) {
        onMoveBooks(bulkSelectedIds, destFolder);
      } else {
        for (const id of bulkSelectedIds) {
          onMoveBook(id, destFolder);
        }
      }
      setIsBulkMode(false);
      setBulkSelectedIds([]);
    } else if (moveBook) {
      onMoveBook(moveBook.id, destFolder);
    }

    setMoveBook(null);
    setIsBulkMoveModal(false);
  };

  const handleCreateNewFolderPrompt = () => {
    const name = window.prompt("Nhập tên thư mục mới:");
    if (name && name.trim()) {
      onCreateFolder(name.trim());
      setExpandedFolders((prev) => ({ ...prev, [name.trim()]: true }));
    }
  };

  const handleRenameFolderPrompt = (folderName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newName = window.prompt(`Đổi tên thư mục "${folderName}":`, folderName);
    if (newName && newName.trim() && newName.trim() !== folderName) {
      onRenameFolder(folderName, newName.trim());
    }
  };

  const handleDeleteFolderPrompt = (folderName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const bookCount = (folderBooksMap[folderName] || []).length;
    const confirmMsg = bookCount > 0
      ? `Bạn có chắc muốn xoá thư mục "${folderName}" cùng ${bookCount} tệp EPUB bên trong?`
      : `Bạn có chắc muốn xoá thư mục "${folderName}"?`;
    if (window.confirm(confirmMsg)) {
      onDeleteFolder(folderName);
    }
  };

  const expandAllFolders = () => {
    const next: Record<string, boolean> = {};
    for (const f of allFolderNames) next[f] = true;
    setExpandedFolders(next);
  };

  const collapseAllFolders = () => {
    const next: Record<string, boolean> = {};
    for (const f of allFolderNames) next[f] = false;
    setExpandedFolders(next);
  };

  return (
    <aside className={`sidebar ${draggedBook ? "sidebarIsDragging" : ""}`}>
      <div className="brand">
        <button className="sidebarToggle" onClick={onToggle} title={collapsed ? "Mở danh sách EPUB" : "Thu gọn danh sách EPUB"}>
          {collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
        </button>
        <FileArchive className="brandIcon" size={22} />
        <div className="sidebarText">
          <h1>EPUBForge</h1>
          <p>
            {books.length} EPUB {allFolderNames.length > 0 ? `trong ${allFolderNames.length} thư mục` : ""}
          </p>
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
          <button className="toolButton" onClick={() => handleAddBookClick("")} disabled={busy} title="Thêm sách EPUB từ hệ thống" style={{ width: "100%" }}>
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
        <>
          {/* Quick Search */}
          <div className="sidebarSearchBox">
            <Search size={14} color="#8c968e" />
            <input
              type="text"
              placeholder="Tìm kiếm sách, series..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "#8c968e", display: "flex" }}
                title="Xoá tìm kiếm"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Section Header */}
          <div className="bookListHeader" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 4px 6px 4px", borderBottom: "1px solid #e0dcd3", margin: "8px 0 4px 0" }}>
            {isBulkMode ? (
              <>
                <span style={{ fontWeight: "bold", fontSize: "12px", color: "#8f2c18" }}>
                  Đã chọn: {bulkSelectedIds.length}
                </span>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  {bulkSelectedIds.length > 0 && (
                    <>
                      <button
                        onClick={handleOpenBulkMove}
                        style={{ background: "none", border: "none", color: "#1a5f49", cursor: "pointer", fontSize: "12px", fontWeight: "bold", padding: 0 }}
                        title="Chuyển các sách đã chọn vào thư mục"
                      >
                        Chuyển
                      </button>
                      <button
                        onClick={handleBulkDelete}
                        style={{ background: "none", border: "none", color: "#8f2c18", cursor: "pointer", fontSize: "12px", fontWeight: "bold", padding: 0 }}
                      >
                        Xoá
                      </button>
                    </>
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
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ fontWeight: "bold", fontSize: "12px", color: "#666" }}>DANH SÁCH SÁCH</span>
                  <button
                    onClick={handleCreateNewFolderPrompt}
                    style={{ background: "none", border: "none", color: "#1a5f49", cursor: "pointer", padding: "2px", display: "flex", alignItems: "center" }}
                    title="Tạo thư mục mới"
                  >
                    <FolderPlus size={15} />
                  </button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  {allFolderNames.length > 0 && (
                    <button
                      onClick={allFolderNames.every((f) => expandedFolders[f] === false) ? expandAllFolders : collapseAllFolders}
                      style={{ background: "none", border: "none", color: "#687168", cursor: "pointer", fontSize: "11px", padding: 0 }}
                      title="Thu gọn/mở rộng tất cả thư mục"
                    >
                      {allFolderNames.every((f) => expandedFolders[f] === false) ? "Mở hết" : "Thu hết"}
                    </button>
                  )}
                  {books.length > 0 && (
                    <button
                      onClick={toggleBulkMode}
                      style={{ background: "none", border: "none", color: "#1a5f49", cursor: "pointer", fontSize: "12px", fontWeight: "bold", padding: 0 }}
                    >
                      Chọn nhiều
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* Book & Folder Tree List */}
      <div className="bookList">
        {/* Render Folder Groups */}
        {allFolderNames.map((folderName) => {
          const folderBooks = folderBooksMap[folderName] || [];
          const isExpanded = isFolderExpanded(folderName);
          const folderBookIds = folderBooks.map((b) => b.id);
          const allFolderBooksSelected = folderBookIds.length > 0 && folderBookIds.every((id) => bulkSelectedIds.includes(id));
          const someFolderBooksSelected = folderBookIds.some((id) => bulkSelectedIds.includes(id));
          const isFolderActive = folderBooks.some((b) => b.id === selectedId);
          const isDragOverThis = dragOverTarget === folderName;
          const isFolderReceived = justReceivedFolder === folderName;

          return (
            <div
              key={folderName}
              className={`folderSection ${isDragOverThis ? "dragOver" : ""}`}
              onDragOver={(e) => handleDragOver(e, folderName)}
              onDragLeave={(e) => handleDragLeave(e, folderName)}
              onDrop={(e) => handleDrop(e, folderName)}
            >
              <div
                className={`folderHeader ${isFolderActive && !isBulkMode ? "active" : ""} ${isDragOverThis ? "dragOver" : ""} ${isFolderReceived ? "justReceived" : ""}`}
                onClick={(e) => toggleFolder(folderName, e)}
                title={isDragOverThis ? `Thả vào đây để chuyển sách vào "${folderName}"` : folderName}
              >
                {isBulkMode ? (
                  <input
                    type="checkbox"
                    checked={allFolderBooksSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someFolderBooksSelected && !allFolderBooksSelected;
                    }}
                    onClick={(e) => handleFolderCheckboxToggle(folderName, e)}
                    onChange={() => {}}
                    style={{ marginRight: "2px", cursor: "pointer" }}
                  />
                ) : (
                  <span className="folderChevron">
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                )}
                {isExpanded ? (
                  <FolderOpen size={16} className="folderIcon" />
                ) : (
                  <Folder size={16} className="folderIcon" />
                )}
                <span className="folderTitle">
                  {isDragOverThis ? `[+] Thả vào "${folderName}"` : folderName}
                </span>
                <span className="folderBadge">{folderBooks.length}</span>

                {!isBulkMode && (
                  <div className="folderActions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="bookInlineActionBtn"
                      onClick={() => handleAddBookClick(folderName)}
                      title={`Thêm EPUB vào "${folderName}"`}
                      disabled={busy}
                    >
                      <Plus size={13} />
                    </button>
                    <button
                      className="bookInlineActionBtn"
                      onClick={(e) => handleRenameFolderPrompt(folderName, e)}
                      title={`Đổi tên thư mục "${folderName}"`}
                      disabled={busy}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      className="bookInlineActionBtn danger"
                      onClick={(e) => handleDeleteFolderPrompt(folderName, e)}
                      title={`Xoá thư mục "${folderName}"`}
                      disabled={busy}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>

              {/* Folder Children (Books inside this folder) */}
              {isExpanded && (
                <div className={`folderChildren ${isDragOverThis ? "dragOver" : ""}`}>
                  {isDragOverThis && (
                    <div className="dropPlaceholder">
                      <FolderOpen size={15} />
                      <span>Thả vào "{folderName}"</span>
                    </div>
                  )}
                  {folderBooks.length === 0 && !isDragOverThis ? (
                    <div className="folderEmpty">Thư mục trống (Kéo thả sách vào đây)</div>
                  ) : (
                    folderBooks.map((book) => {
                      const isChecked = bulkSelectedIds.includes(book.id);
                      const isItemDragging = draggedBook?.id === book.id;
                      const isItemMoving = Boolean(movingBookIds?.has(book.id));
                      const isItemJustDropped = justDroppedBookId === book.id;
                      return (
                        <div
                          key={book.id}
                          className={`bookItem inFolder ${book.id === selectedId && !isBulkMode ? "active" : ""} ${isItemDragging ? "isDragging" : ""} ${isItemMoving ? "isMoving" : ""} ${isItemJustDropped ? "justDropped" : ""} ${isBulkMode ? "inBulkMode" : ""}`}
                          onClick={() => handleBookClick(book.id)}
                          draggable={!isBulkMode && !busy && !isItemMoving}
                          onDragStart={(e) => handleDragStart(e, book)}
                          onDragEnd={handleDragEnd}
                          title={isItemMoving ? "Đang chuyển sách..." : `Kéo thả để chuyển thư mục. Nhấn để mở: ${book.name}`}
                          data-tooltip={book.name}
                        >
                          {!isBulkMode && <GripVertical size={13} className="dragGrip" />}
                          {isBulkMode ? (
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {}}
                              style={{ marginRight: "4px", cursor: "pointer" }}
                            />
                          ) : isItemMoving ? (
                            <Loader2 size={15} className="spinIcon" style={{ flexShrink: 0, color: "#2f7d69" }} />
                          ) : (
                            <BookOpen size={15} style={{ flexShrink: 0, color: "#2f7d69" }} />
                          )}
                          <div className="bookItemInfo">
                            <span className="bookItemTitle">{book.name}</span>
                            <small className="bookItemSize">{isItemMoving ? "Đang chuyển..." : formatBytes(book.size)}</small>
                          </div>
                          {!isBulkMode && !isItemMoving && (
                            <div className="bookActions">
                              <button
                                className="bookInlineActionBtn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenSingleMove(book);
                                }}
                                title={`Chuyển thư mục cho ${book.name}`}
                                disabled={busy}
                              >
                                <FolderInput size={13} />
                              </button>
                              <button
                                className="bookInlineActionBtn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onRenameBook(book.id, book.name);
                                }}
                                title={`Đổi tên ${book.name}`}
                                disabled={busy}
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                className="bookInlineActionBtn danger"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDeleteBook(book.id, book.name);
                                }}
                                title={`Xoá ${book.name}`}
                                disabled={busy}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Render Root Books (Not in any folder) */}
        {rootBooks.length > 0 && (
          <div
            className="folderSection"
            style={{ marginTop: allFolderNames.length > 0 ? "8px" : "0" }}
            onDragOver={(e) => handleDragOver(e, "__ROOT__")}
            onDragLeave={(e) => handleDragLeave(e, "__ROOT__")}
            onDrop={(e) => handleDrop(e, "__ROOT__")}
          >
            {allFolderNames.length > 0 && (
              <div className="sidebarSectionLabel" style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Sách ngoài thư mục ({rootBooks.length})</span>
                {draggedBook?.folder && (
                  <span style={{ color: "#2f7d69", fontWeight: "normal" }}>Thả vào đây để đưa ra gốc</span>
                )}
              </div>
            )}

            {/* Drop target indicator when dragging a nested book out to root */}
            {draggedBook && draggedBook.folder && (
              <div
                className={`rootDropZone ${dragOverTarget === "__ROOT__" ? "dragOver" : ""}`}
                onDragOver={(e) => handleDragOver(e, "__ROOT__")}
                onDragLeave={(e) => handleDragLeave(e, "__ROOT__")}
                onDrop={(e) => handleDrop(e, "__ROOT__")}
              >
                <span>📥 Thả sách vào đây để đưa ra thư mục gốc (edit/)</span>
              </div>
            )}

            {rootBooks.map((book) => {
              const isChecked = bulkSelectedIds.includes(book.id);
              const isItemDragging = draggedBook?.id === book.id;
              const isItemMoving = Boolean(movingBookIds?.has(book.id));
              const isItemJustDropped = justDroppedBookId === book.id;
              return (
                <div
                  key={book.id}
                  className={`bookItem ${book.id === selectedId && !isBulkMode ? "active" : ""} ${isItemDragging ? "isDragging" : ""} ${isItemMoving ? "isMoving" : ""} ${isItemJustDropped ? "justDropped" : ""} ${isBulkMode ? "inBulkMode" : ""}`}
                  onClick={() => handleBookClick(book.id)}
                  draggable={!isBulkMode && !busy && !isItemMoving}
                  onDragStart={(e) => handleDragStart(e, book)}
                  onDragEnd={handleDragEnd}
                  title={isItemMoving ? "Đang chuyển sách..." : `Kéo thả để chuyển thư mục. Nhấn để mở: ${book.name}`}
                  data-tooltip={book.name}
                >
                  {!isBulkMode && <GripVertical size={13} className="dragGrip" />}
                  {isBulkMode ? (
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {}}
                      style={{ marginRight: "4px", cursor: "pointer" }}
                    />
                  ) : isItemMoving ? (
                    <Loader2 size={16} className="spinIcon" style={{ flexShrink: 0, color: "#2f7d69" }} />
                  ) : (
                    <BookOpen size={16} style={{ flexShrink: 0 }} />
                  )}
                  <div className="bookItemInfo">
                    <span className="bookItemTitle">{book.name}</span>
                    <small className="bookItemSize">{isItemMoving ? "Đang chuyển..." : formatBytes(book.size)}</small>
                  </div>
                  {!isBulkMode && !isItemMoving && (
                    <div className="bookActions">
                      <button
                        className="bookInlineActionBtn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenSingleMove(book);
                        }}
                        title={`Chuyển vào thư mục`}
                        disabled={busy}
                      >
                        <FolderInput size={13} />
                      </button>
                      <button
                        className="bookInlineActionBtn"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRenameBook(book.id, book.name);
                        }}
                        title={`Đổi tên ${book.name}`}
                        disabled={busy}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        className="bookInlineActionBtn danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteBook(book.id, book.name);
                        }}
                        title={`Xoá ${book.name}`}
                        disabled={busy}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* If there are no root books but user is dragging a book, show root drop zone so they can move book out */}
        {rootBooks.length === 0 && allFolderNames.length > 0 && draggedBook && draggedBook.folder && (
          <div
            className={`rootDropZone ${dragOverTarget === "__ROOT__" ? "dragOver" : ""}`}
            onDragOver={(e) => handleDragOver(e, "__ROOT__")}
            onDragLeave={(e) => handleDragLeave(e, "__ROOT__")}
            onDrop={(e) => handleDrop(e, "__ROOT__")}
          >
            <span>📥 Thả sách vào đây để đưa ra thư mục gốc (edit/)</span>
          </div>
        )}

        {/* Empty state when searching or no books */}
        {books.length === 0 && allFolderNames.length === 0 && (
          <div style={{ textAlign: "center", padding: "24px 10px", color: "#8c968e", fontSize: "13px" }}>
            Chưa có sách EPUB nào trong thư mục edit.
          </div>
        )}
        {books.length > 0 && rootBooks.length === 0 && Object.values(folderBooksMap).every((arr) => arr.length === 0) && (
          <div style={{ textAlign: "center", padding: "20px 10px", color: "#8c968e", fontSize: "13px" }}>
            Không tìm thấy sách phù hợp với từ khoá.
          </div>
        )}
      </div>

      {/* Move Book Modal Dialog */}
      {(moveBook || isBulkMoveModal) && (
        <div className="modalBackdrop" onClick={() => { setMoveBook(null); setIsBulkMoveModal(false); }}>
          <div className="metadataModal" style={{ maxWidth: "460px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <h3>
                {isBulkMoveModal ? `Chuyển ${bulkSelectedIds.length} sách vào thư mục` : `Chuyển sách "${moveBook?.name}"`}
              </h3>
              <button
                className="iconButton"
                onClick={() => { setMoveBook(null); setIsBulkMoveModal(false); }}
                style={{ width: "28px", height: "28px" }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", maxHeight: "360px", overflowY: "auto" }}>
              <div style={{ fontSize: "13px", fontWeight: "600", color: "#444" }}>Chọn thư mục đích:</div>

              {/* Option: Root directory */}
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: "1px solid #d8d5cc",
                  background: !isCreatingNewFolderInMove && selectedTargetFolder === "" ? "#e9f6f0" : "#fffdf8",
                  cursor: "pointer"
                }}
              >
                <input
                  type="radio"
                  name="targetFolder"
                  checked={!isCreatingNewFolderInMove && selectedTargetFolder === ""}
                  onChange={() => {
                    setSelectedTargetFolder("");
                    setIsCreatingNewFolderInMove(false);
                  }}
                />
                <span style={{ fontSize: "13px", fontWeight: "500" }}>📁 Thư mục gốc (edit/)</span>
              </label>

              {/* Existing Folders */}
              {allFolderNames.map((folderName) => (
                <label
                  key={folderName}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid #d8d5cc",
                    background: !isCreatingNewFolderInMove && selectedTargetFolder === folderName ? "#e9f6f0" : "#fffdf8",
                    cursor: "pointer"
                  }}
                >
                  <input
                    type="radio"
                    name="targetFolder"
                    checked={!isCreatingNewFolderInMove && selectedTargetFolder === folderName}
                    onChange={() => {
                      setSelectedTargetFolder(folderName);
                      setIsCreatingNewFolderInMove(false);
                    }}
                  />
                  <span style={{ fontSize: "13px", fontWeight: "500" }}>📁 {folderName}</span>
                </label>
              ))}

              {/* Option: Create new folder */}
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: "1px solid #d8d5cc",
                  background: isCreatingNewFolderInMove ? "#e9f6f0" : "#fffdf8",
                  cursor: "pointer"
                }}
              >
                <input
                  type="radio"
                  name="targetFolder"
                  checked={isCreatingNewFolderInMove}
                  onChange={() => setIsCreatingNewFolderInMove(true)}
                />
                <span style={{ fontSize: "13px", fontWeight: "500" }}>➕ Tạo thư mục mới...</span>
              </label>

              {isCreatingNewFolderInMove && (
                <div style={{ paddingLeft: "26px", marginTop: "-4px" }}>
                  <input
                    type="text"
                    placeholder="Nhập tên thư mục mới..."
                    value={customNewFolderName}
                    onChange={(e) => setCustomNewFolderName(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "7px 10px",
                      borderRadius: "6px",
                      border: "1px solid #c9c6bd",
                      background: "#fff",
                      fontSize: "13px"
                    }}
                    autoFocus
                  />
                </div>
              )}
            </div>

            <div className="modalFooter">
              <button
                className="toolButton"
                onClick={() => { setMoveBook(null); setIsBulkMoveModal(false); }}
                style={{ minHeight: "34px", padding: "0 14px" }}
              >
                Huỷ
              </button>
              <button
                className="primaryButton"
                onClick={handleConfirmMove}
                disabled={isCreatingNewFolderInMove && !customNewFolderName.trim()}
                style={{ minHeight: "34px", padding: "0 18px" }}
              >
                Chuyển sách
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
