import React, { useState, useEffect } from "react";
import { Save, X, Upload, Link as LinkIcon, BookOpen, Check, Image as ImageIcon, Search, Globe } from "lucide-react";
import type { BookAnalysis, BookMetadata } from "../lib/types";

type Props = {
  open: boolean;
  analysis: BookAnalysis;
  metadata: BookMetadata;
  dirty: boolean;
  busy: boolean;
  onChange: (patch: Partial<BookMetadata>) => void;
  onReset: () => void;
  onSave: () => void;
  onClose: () => void;
};

function ImageWithFallback({ src, alt, className = "rowPreviewImg" }: { src: string; alt: string; className?: string }) {
  const [error, setError] = useState(false);

  useEffect(() => {
    setError(false);
  }, [src]);

  if (error || !src) {
    return (
      <div className="imageFallbackPlaceholder" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#f0ede4", width: "100%", height: "100%", color: "#8a928a" }}>
        <ImageIcon size={18} style={{ color: "#a3a8a3" }} />
        <span style={{ fontSize: "10px", marginTop: "4px" }}>Ảnh lỗi</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      onError={() => setError(true)}
      className={className}
    />
  );
}

export function MetadataModal({ open, analysis, metadata, dirty, busy, onChange, onReset, onSave, onClose }: Props) {
  if (!open) {
    return null;
  }

  const [activeTab, setActiveTab] = useState<"upload" | "link" | "book">("book");
  const [linkUrl, setLinkUrl] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchSource, setSearchSource] = useState("auto");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<BookMetadata[]>([]);

  useEffect(() => {
    if (open) {
      setSearchQuery(metadata.title || analysis?.title || "");
      setSearchResults([]);
    }
  }, [open, metadata.title, analysis?.title]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchResults([]);
    try {
      const res = await fetch(`/api/metadata/search?q=${encodeURIComponent(searchQuery.trim())}&source=${searchSource}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Lỗi khi tìm kiếm trực tuyến");
      }
      const data = await res.json();
      setSearchResults(Array.isArray(data) ? data : []);
    } catch (err: any) {
      alert(err.message || "Không tìm thấy kết quả hoặc có lỗi kết nối.");
    } finally {
      setSearching(false);
    }
  };

  const handleSelectBook = (book: BookMetadata) => {
    onChange({
      title: book.title || metadata.title,
      creator: book.creator || metadata.creator,
      language: book.language || metadata.language,
      publisher: book.publisher || metadata.publisher,
      description: book.description || metadata.description,
      subject: book.subject || metadata.subject,
      coverImage: book.coverImage || metadata.coverImage
    });
    setSearchResults([]);
  };

  const getAssetUrl = (path: string) => {
    if (!path) return "";
    if (path.startsWith("data:image/") || path.startsWith("http://") || path.startsWith("https://")) {
      return path;
    }
    return `/api/epubs/${encodeURIComponent(analysis.id)}/assets?path=${encodeURIComponent(path)}`;
  };

  const currentCover = metadata.coverImage || analysis.coverPath;

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        onChange({ coverImage: reader.result });
      }
    };
    reader.readAsDataURL(file);
  };

  const handleLinkSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (linkUrl.trim()) {
      onChange({ coverImage: linkUrl.trim() });
      setLinkUrl("");
    }
  };

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <section className="metadataModal" role="dialog" aria-modal="true" aria-labelledby="metadata-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modalHeader">
          <div>
            <h3 id="metadata-title">Metadata</h3>
            <p>{analysis.fileName}</p>
          </div>
          <button className="iconButton" onClick={onClose} title="Đóng">
            <X size={18} />
          </button>
        </header>

        <div className="metadataLayout">
          {}
          <div className="coverSection">
            <span className="coverGalleryTitle">Ảnh bìa sách</span>
            <div className="coverPreviewContainer">
              {currentCover ? (
                <ImageWithFallback className="coverPreviewImg" src={getAssetUrl(currentCover)} alt="Ảnh bìa" />
              ) : (
                <div className="coverPreviewImg" style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "#f0ede4", color: "#687168", fontSize: "11px" }}>
                  Không có ảnh bìa
                </div>
              )}
              <span style={{ fontSize: "11px", color: "#687168", wordBreak: "break-all", textAlign: "center", marginTop: "4px" }}>
                {currentCover && !currentCover.startsWith("data:") ? currentCover.split("/").pop() : currentCover.startsWith("data:") ? "Ảnh tự chọn từ thiết bị" : "Chưa chọn ảnh"}
              </span>
            </div>

            {}
            <div className="coverTabs" style={{ marginTop: "12px" }}>
              <button
                type="button"
                className={`coverTab ${activeTab === "book" ? "active" : ""}`}
                onClick={() => setActiveTab("book")}
                style={{ fontSize: "12px", padding: "6px 8px" }}
              >
                <BookOpen size={12} />
                Trong sách
              </button>
              <button
                type="button"
                className={`coverTab ${activeTab === "upload" ? "active" : ""}`}
                onClick={() => setActiveTab("upload")}
                style={{ fontSize: "12px", padding: "6px 8px" }}
              >
                <Upload size={12} />
                Tải lên
              </button>
              <button
                type="button"
                className={`coverTab ${activeTab === "link" ? "active" : ""}`}
                onClick={() => setActiveTab("link")}
                style={{ fontSize: "12px", padding: "6px 8px" }}
              >
                <LinkIcon size={12} />
                Link URL
              </button>
            </div>

            {}
            <div className="coverTabContent" style={{ flex: 1, minHeight: 0 }}>
              {activeTab === "book" && (
                <div className="tabPanePane" style={{ flex: 1, minHeight: 0 }}>
                  {analysis.images.length > 0 ? (
                    <div className="bookImagesList metadataBookImagesList">
                      {analysis.images.map((img) => {
                        const isSelected = img === currentCover;
                        const fileName = img.split("/").pop() || img;
                        return (
                          <button
                            type="button"
                            key={img}
                            className={`bookImageRowItem ${isSelected ? "selected" : ""}`}
                            onClick={() => onChange({ coverImage: img })}
                            title={img}
                          >
                            <div className="bookImageRowPreview">
                              <ImageWithFallback src={getAssetUrl(img)} alt={fileName} />
                            </div>
                            <span className="bookImageRowInfo">
                              <span className="imageFileName">{fileName}</span>
                              <span className="imagePath">{img}</span>
                            </span>
                            {isSelected ? (
                              <span className="selectedRowBadge">
                                <Check size={12} />
                                Đang chọn
                              </span>
                            ) : (
                              <span className="selectRowLabel">Chọn</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="noImagesText">Không tìm thấy ảnh nào trong sách.</div>
                  )}
                </div>
              )}

              {activeTab === "upload" && (
                <div className="tabPanePane">
                  <label className="dragDropUpload" style={{ padding: "16px", minHeight: "120px" }}>
                    <input
                      type="file"
                      accept="image/png, image/jpeg, image/jpg, image/gif"
                      onChange={handleImageUpload}
                      style={{ display: "none" }}
                    />
                    <Upload size={20} className="uploadIcon" />
                    <span className="uploadText" style={{ fontSize: "12px" }}>Chọn ảnh từ máy tính</span>
                    <span className="uploadSubText" style={{ fontSize: "10px" }}>Hỗ trợ PNG, JPEG, GIF</span>
                  </label>
                </div>
              )}

              {activeTab === "link" && (
                <form onSubmit={handleLinkSubmit} className="tabPanePane linkPane">
                  <div className="field">
                    <span style={{ fontSize: "11px", fontWeight: "600", color: "#687168" }}>Dán đường dẫn ảnh</span>
                    <div className="linkInputRow" style={{ marginTop: "4px" }}>
                      <input
                        type="url"
                        placeholder="https://example.com/image.jpg"
                        value={linkUrl}
                        onChange={(e) => setLinkUrl(e.target.value)}
                        style={{ height: "30px", fontSize: "12px" }}
                      />
                      <button type="submit" className="smallButton strong" disabled={!linkUrl.trim()} style={{ minHeight: "30px", fontSize: "12px", padding: "0 10px" }}>
                        Áp dụng
                      </button>
                    </div>
                  </div>
                </form>
              )}
            </div>
          </div>

          <div className="metadataForm" style={{ padding: 0 }}>
            <div style={{ display: "flex", gap: "8px", alignItems: "flex-end", marginBottom: "16px", background: "#f3eedf", border: "1px solid #e6dfd3", borderRadius: "8px", padding: "10px" }}>
              <div className="field" style={{ flex: 1, margin: 0 }}>
                <span style={{ fontSize: "11px", fontWeight: "600", color: "#234e43", display: "flex", alignItems: "center", gap: "4px" }}>
                  <Globe size={12} />
                  <span>Tìm kiếm Metadata & Ảnh bìa trực tuyến</span>
                </span>
                <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
                  <select
                    value={searchSource}
                    onChange={(e) => setSearchSource(e.target.value)}
                    style={{
                      height: "32px",
                      padding: "0 8px",
                      fontSize: "12px",
                      border: "1px solid #c9c6bd",
                      borderRadius: "6px",
                      background: "#fff",
                      color: "#17201c",
                      outline: "none",
                      cursor: "pointer"
                    }}
                  >
                    <option value="auto">Môi trường: Tự động</option>
                    <option value="anilist">AniList (Light Novel Hàn/Nhật)</option>
                    <option value="google">Google Books (Tổng hợp)</option>
                    <option value="openlibrary">Open Library (Sách tiếng Anh)</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Nhập tên sách hoặc tác giả để tìm..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
                    style={{ height: "32px", fontSize: "12px", border: "1px solid #c9c6bd", borderRadius: "6px", flex: 1, padding: "0 8px", background: "#fff" }}
                  />
                  <button
                    type="button"
                    className="searchOnlineBtn"
                    onClick={handleSearch}
                    disabled={searching || !searchQuery.trim()}
                  >
                    <Search size={12} />
                    <span>{searching ? "Đang tìm..." : "Tìm kiếm"}</span>
                  </button>
                </div>
              </div>
            </div>

            {searchResults.length > 0 && (
              <div
                style={{
                  border: "1px solid #e6dfd3",
                  borderRadius: "8px",
                  background: "#fff",
                  padding: "12px",
                  marginBottom: "16px",
                  maxHeight: "220px",
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  boxShadow: "inset 0 2px 4px 0 rgba(0, 0, 0, 0.06)",
                  flexShrink: 0
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <span style={{ fontSize: "11px", fontWeight: "600", color: "#8c8273" }}>Chọn kết quả phù hợp để tự động điền:</span>
                  <button
                    type="button"
                    onClick={() => setSearchResults([])}
                    style={{ border: "none", background: "none", color: "#c0392b", fontSize: "11px", cursor: "pointer", fontWeight: "500" }}
                  >
                    Đóng [X]
                  </button>
                </div>
                {searchResults.map((book, idx) => (
                  <div
                    key={idx}
                    onClick={() => handleSelectBook(book)}
                    style={{
                      display: "flex",
                      gap: "10px",
                      padding: "8px",
                      borderRadius: "6px",
                      cursor: "pointer",
                      border: "1px solid #f0eae1",
                      background: "#fbf8f3",
                      transition: "all 0.2s"
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "#edf7f5";
                      e.currentTarget.style.borderColor = "#cce8e1";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "#fbf8f3";
                      e.currentTarget.style.borderColor = "#f0eae1";
                    }}
                  >
                    {book.coverImage ? (
                      <img
                        src={book.coverImage}
                        alt={book.title}
                        style={{ width: "38px", height: "50px", objectFit: "cover", borderRadius: "4px", border: "1px solid #e6dfd3", background: "#fff" }}
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div style={{ width: "38px", height: "50px", background: "#f0ede4", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "4px", fontSize: "9px", color: "#8c8273", border: "1px solid #e6dfd3" }}>Ảnh bìa</div>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: "13px", fontWeight: "600", color: "#1f624d", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={book.title}>{book.title}</span>
                      <span style={{ fontSize: "11px", color: "#68655c", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{book.creator || "Không rõ tác giả"}</span>
                      {book.publisher && <span style={{ fontSize: "10px", color: "#8c8273" }}>NXB: {book.publisher}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <TextField label="Title" value={metadata.title} onChange={(title) => onChange({ title })} />
            <TextField label="Author" value={metadata.creator} onChange={(creator) => onChange({ creator })} />
            <div className="formGrid">
              <TextField label="Language" value={metadata.language} onChange={(language) => onChange({ language })} />
              <TextField label="Publisher" value={metadata.publisher} onChange={(publisher) => onChange({ publisher })} />
            </div>
            <TextField label="Subject / Tags" value={metadata.subject} onChange={(subject) => onChange({ subject })} />
            <div className="formGrid">
              <TextField label="Series" value={metadata.series || ""} onChange={(series) => onChange({ series })} />
              <TextField label="Series Index" value={metadata.seriesIndex || ""} onChange={(seriesIndex) => onChange({ seriesIndex })} />
            </div>
            <label className="field">
              <span>Description</span>
              <textarea value={metadata.description} onChange={(event) => onChange({ description: event.target.value })} />
            </label>
          </div>
        </div>

        <footer className="modalFooter">
          <button className="smallButton" onClick={onReset} disabled={!dirty || busy}>
            Hoàn tác
          </button>
          <button className="smallButton strong" onClick={onSave} disabled={busy}>
            <Save size={16} />
            <span>Lưu thay đổi</span>
          </button>
        </footer>
      </section>
    </div>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
