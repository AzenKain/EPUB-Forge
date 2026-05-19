import React, { useState, useEffect } from "react";
import { Save, X, Upload, Link as LinkIcon, BookOpen, Check, Image as ImageIcon } from "lucide-react";
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
                    <div className="bookImagesGrid" style={{ maxHeight: "200px" }}>
                      {analysis.images.map((img) => {
                        const isSelected = img === currentCover;
                        return (
                          <div
                            key={img}
                            className={`bookImageItem ${isSelected ? "selected" : ""}`}
                            onClick={() => onChange({ coverImage: img })}
                            title={img}
                          >
                            <ImageWithFallback src={getAssetUrl(img)} alt="Book Image" />
                            {isSelected && (
                              <div className="selectedCheck">
                                <Check size={10} color="#fff" />
                              </div>
                            )}
                          </div>
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

          {}
          <div className="metadataForm" style={{ padding: 0 }}>
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
            <span>Lưu vào EPUB gốc</span>
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
