import React, { useState, useEffect } from "react";
import { BookOpen, Image as ImageIcon, Link as LinkIcon, Upload, X, Trash2, Check } from "lucide-react";
import type { BookAnalysis, ExportRange } from "../lib/types";

type Props = {
  open: boolean;
  analysis: BookAnalysis;
  rangeIndex: number;
  range: ExportRange | null;
  includeFrontmatter: boolean;
  onSaveCover: (index: number, coverValue: string) => void;
  onClose: () => void;
};

function ImageWithFallback({ src, alt, className = "rowPreviewImg" }: { src: string; alt: string; className?: string }) {
  const [error, setError] = useState(false);

  useEffect(() => {
    setError(false);
  }, [src]);

  if (error || !src) {
    return (
      <div className="imageFallbackPlaceholder">
        <ImageIcon size={18} className="fallbackIcon" />
        <span className="fallbackText">Ảnh lỗi</span>
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

export function CoverModal({ open, analysis, rangeIndex, range, includeFrontmatter, onSaveCover, onClose }: Props) {
  if (!open || !range) {
    return null;
  }

  const [activeTab, setActiveTab] = useState<"upload" | "link" | "book">("upload");
  const [linkUrl, setLinkUrl] = useState("");
  const [tempCover, setTempCover] = useState<string>(range.coverImage || "");
  const [rangeImages, setRangeImages] = useState<string[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);

  useEffect(() => {
    if (open && range) {
      setLoadingImages(true);
      fetch(`/api/epubs/${encodeURIComponent(analysis.id)}/range-images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startIndex: range.startIndex,
          endIndex: range.endIndex,
          includeFrontmatter
        })
      })
        .then((res) => {
          if (!res.ok) throw new Error("Lỗi tải ảnh");
          return res.json();
        })
        .then((data) => {
          setRangeImages(Array.isArray(data) ? data : []);
        })
        .catch((err) => {
          console.error(err);
          setRangeImages([]);
        })
        .finally(() => {
          setLoadingImages(false);
        });
    } else {
      setRangeImages([]);
    }
  }, [open, range?.startIndex, range?.endIndex, includeFrontmatter, analysis.id]);

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        setTempCover(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleLinkSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (linkUrl.trim()) {
      setTempCover(linkUrl.trim());
      setLinkUrl("");
    }
  };

  const saveAndClose = () => {
    onSaveCover(rangeIndex, tempCover);
    onClose();
  };

  const removeCover = () => {
    setTempCover("");
  };

  
  const getCoverSrc = (path: string) => {
    if (!path) return "";
    if (path.startsWith("data:image/") || path.startsWith("http://") || path.startsWith("https://")) {
      return path;
    }
    return `/api/epubs/${encodeURIComponent(analysis.id)}/assets?path=${encodeURIComponent(path)}`;
  };

  const originalCoverUrl = analysis.coverPath
    ? `/api/epubs/${encodeURIComponent(analysis.id)}/assets?path=${encodeURIComponent(analysis.coverPath)}`
    : "";

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <section className="metadataModal coverModal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modalHeader">
          <div>
            <h3>Cấu hình ảnh bìa: {range.label || `Volume ${rangeIndex + 1}`}</h3>
            <p>Chọn ảnh bìa riêng cho tập sách này</p>
          </div>
          <button className="iconButton" onClick={onClose} title="Đóng">
            <X size={18} />
          </button>
        </header>

        <div className="coverModalBody">
          {}
          <div className="coverPreviewsSection">
            <div className="previewBox">
              <span className="previewTitle">Ảnh bìa gốc</span>
              {originalCoverUrl ? (
                <div className="previewImgWrapper">
                  <ImageWithFallback src={originalCoverUrl} alt="Original Cover" className="previewImg" />
                </div>
              ) : (
                <div className="noPreview">Không có ảnh bìa gốc</div>
              )}
            </div>

            <div className="previewBox active">
              <span className="previewTitle">Ảnh bìa sẽ dùng</span>
              <div className="previewImgWrapper">
                {tempCover ? (
                  <ImageWithFallback src={getCoverSrc(tempCover)} alt="Custom Cover" className="previewImg" />
                ) : originalCoverUrl ? (
                  <ImageWithFallback src={originalCoverUrl} alt="Original Cover" className="previewImg fallback" />
                ) : (
                  <div className="noPreview">Không có ảnh bìa</div>
                )}
              </div>
              <span className="coverStatusText">
                {tempCover ? "Đang dùng ảnh bìa tùy chỉnh" : "Đang dùng ảnh bìa gốc của sách"}
              </span>
            </div>
          </div>

          {}
          <div className="coverSelectorSection">
            <div className="coverTabs">
              <button
                type="button"
                className={`coverTab ${activeTab === "upload" ? "active" : ""}`}
                onClick={() => setActiveTab("upload")}
              >
                <Upload size={14} />
                Tải ảnh lên
              </button>
              <button
                type="button"
                className={`coverTab ${activeTab === "link" ? "active" : ""}`}
                onClick={() => setActiveTab("link")}
              >
                <LinkIcon size={14} />
                Dán Link
              </button>
              <button
                type="button"
                className={`coverTab ${activeTab === "book" ? "active" : ""}`}
                onClick={() => setActiveTab("book")}
              >
                <BookOpen size={14} />
                Chọn từ sách ({rangeImages.length})
              </button>
            </div>

            <div className="coverTabContent">
              {activeTab === "upload" && (
                <div className="tabPanePane">
                  <label className="dragDropUpload">
                    <input
                      type="file"
                      accept="image/png, image/jpeg, image/jpg, image/gif"
                      onChange={handleImageUpload}
                      style={{ display: "none" }}
                    />
                    <Upload size={28} className="uploadIcon" />
                    <span className="uploadText">Nhấp để chọn ảnh từ máy tính</span>
                    <span className="uploadSubText">Hỗ trợ PNG, JPEG, GIF</span>
                  </label>
                </div>
              )}

              {activeTab === "link" && (
                <form onSubmit={handleLinkSubmit} className="tabPanePane linkPane">
                  <div className="field">
                    <span>Nhập URL ảnh đại diện</span>
                    <div className="linkInputRow">
                      <input
                        type="url"
                        placeholder="https://example.com/cover.jpg"
                        value={linkUrl}
                        onChange={(e) => setLinkUrl(e.target.value)}
                      />
                      <button type="submit" className="smallButton strong" disabled={!linkUrl.trim()}>
                        Áp dụng
                      </button>
                    </div>
                  </div>
                  <small style={{ color: "#687168", fontSize: "11px" }}>
                    Nhập đường dẫn trực tiếp (http/https) của ảnh bìa bạn muốn dùng.
                  </small>
                </form>
              )}

              {activeTab === "book" && (
                <div className="tabPanePane bookImagesPane">
                  {loadingImages ? (
                    <div className="noImagesText">Đang quét ảnh minh họa của tập này...</div>
                  ) : rangeImages.length > 0 ? (
                    <div className="bookImagesList">
                      {rangeImages.map((img) => {
                        const isSelected = tempCover === img;
                        const fileName = img.split("/").pop() || img;
                        return (
                          <div
                            key={img}
                            className={`bookImageRowItem ${isSelected ? "selected" : ""}`}
                            onClick={() => setTempCover(img)}
                          >
                            <div className="bookImageRowPreview">
                              <ImageWithFallback src={getCoverSrc(img)} alt={fileName} />
                            </div>
                            <div className="bookImageRowInfo">
                              <span className="imagePath" title={img}>{img}</span>
                              <span className="imageFileName">{fileName}</span>
                            </div>
                            <div className="bookImageRowAction">
                              {isSelected ? (
                                <div className="selectedRowBadge">
                                  <Check size={14} color="#fff" />
                                  <span>Đang chọn</span>
                                </div>
                              ) : (
                                <span className="selectRowLabel">Chọn</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="noImagesText">Không tìm thấy tệp ảnh minh họa nào trong các chương của tập này.</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <footer className="modalFooter">
          {tempCover && (
            <button type="button" className="smallButton danger" onClick={removeCover} style={{ marginRight: "auto" }}>
              <Trash2 size={15} />
              <span>Khôi phục ảnh bìa gốc</span>
            </button>
          )}
          <button type="button" className="smallButton" onClick={onClose}>
            Hủy bỏ
          </button>
          <button type="button" className="smallButton strong" onClick={saveAndClose}>
            Xác nhận
          </button>
        </footer>
      </section>
    </div>
  );
}
