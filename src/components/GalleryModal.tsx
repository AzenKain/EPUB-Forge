import React, { useState, useEffect } from "react";
import { X, Image as ImageIcon, ArrowUp, ArrowDown, Trash2, Save, Check, Layers, AlertCircle, Download, Images } from "lucide-react";
import type { BookAnalysis, GalleryImage } from "../lib/types";

type Props = {
  open: boolean;
  bookId: string;
  onClose: () => void;
  onSaveSuccess: (newAnalysis: BookAnalysis) => void;
};

export function GalleryModal({ open, bookId, onClose, onSaveSuccess }: Props) {
  const [available, setAvailable] = useState<GalleryImage[]>([]);
  const [selected, setSelected] = useState<GalleryImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [mode, setMode] = useState<"gallery" | "library">("gallery");
  const [downloadSelected, setDownloadSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (open && bookId) {
      setLoading(true);
      setError("");
      setSuccess("");
      fetch(`/api/epubs/${encodeURIComponent(bookId)}/gallery`)
        .then((res) => {
          if (!res.ok) throw new Error("Không thể tải thông tin gallery từ server");
          return res.json();
        })
        .then((data) => {
          setAvailable(data.availableImages || []);
          setSelected(data.selectedImages || []);
          setDownloadSelected([]);
          setMode("gallery");
        })
        .catch((err) => {
          console.error(err);
          setError(err.message || "Đã xảy ra lỗi khi tải dữ liệu.");
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [open, bookId]);

  if (!open) return null;

  const handleToggleSelect = (img: GalleryImage) => {
    const isSel = selected.some((s) => s.fullPath === img.fullPath);
    if (isSel) {
      const updatedSel = selected.filter((s) => s.fullPath !== img.fullPath);
      const ordered = updatedSel.map((s, idx) => ({ ...s, order: idx }));
      setSelected(ordered);

      setAvailable(
        available.map((a) => (a.fullPath === img.fullPath ? { ...a, selected: false, order: 0 } : a))
      );
    } else {
      const newImg = { ...img, selected: true, order: selected.length, caption: "" };
      setSelected([...selected, newImg]);

      setAvailable(
        available.map((a) => (a.fullPath === img.fullPath ? { ...a, selected: true, order: selected.length } : a))
      );
    }
  };

  const handleCaptionChange = (fullPath: string, caption: string) => {
    setSelected(
      selected.map((s) => (s.fullPath === fullPath ? { ...s, caption } : s))
    );
    setAvailable(
      available.map((a) => (a.fullPath === fullPath ? { ...a, caption } : a))
    );
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const newSel = [...selected];
    const temp = newSel[index];
    newSel[index] = newSel[index - 1];
    newSel[index - 1] = temp;
    const ordered = newSel.map((s, idx) => ({ ...s, order: idx }));
    setSelected(ordered);
  };

  const handleMoveDown = (index: number) => {
    if (index === selected.length - 1) return;
    const newSel = [...selected];
    const temp = newSel[index];
    newSel[index] = newSel[index + 1];
    newSel[index + 1] = temp;
    const ordered = newSel.map((s, idx) => ({ ...s, order: idx }));
    setSelected(ordered);
  };

  const toggleDownloadSelect = (fullPath: string) => {
    setDownloadSelected((current) => (
      current.includes(fullPath)
        ? current.filter((path) => path !== fullPath)
        : [...current, fullPath]
    ));
  };

  const selectAllForDownload = () => {
    setDownloadSelected(available.map((img) => img.fullPath));
  };

  const clearDownloadSelection = () => {
    setDownloadSelected([]);
  };

  const getDownloadFileName = (contentDisposition: string | null, fallback: string) => {
    if (!contentDisposition) return fallback;
    const utfMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utfMatch) {
      try {
        return decodeURIComponent(utfMatch[1]);
      } catch {
        return utfMatch[1];
      }
    }
    const plainMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
    return plainMatch ? plainMatch[1] : fallback;
  };

  const handleDownloadImages = async (paths: string[], all = false) => {
    if (!all && paths.length === 0) return;
    setDownloading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/epubs/${encodeURIComponent(bookId)}/gallery/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths, all }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Không thể tải ảnh.");
      }
      const blob = await res.blob();
      const fallback = all || paths.length > 1 ? "gallery-images.zip" : "image";
      const fileName = getDownloadFileName(res.headers.get("Content-Disposition"), fallback);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setSuccess(all ? "Đã tải tất cả ảnh." : `Đã tải ${paths.length} ảnh.`);
    } catch (err: any) {
      setError(err.message || "Lỗi khi tải ảnh.");
    } finally {
      setDownloading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/epubs/${encodeURIComponent(bookId)}/gallery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: selected }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Không thể lưu trang Gallery.");
      }
      const data = await res.json();
      setSuccess("Đã lưu trang Gallery thành công!");
      setTimeout(() => {
        onSaveSuccess(data);
        onClose();
      }, 1000);
    } catch (err: any) {
      setError(err.message || "Lỗi khi lưu trang Gallery.");
    } finally {
      setSaving(false);
    }
  };

  const getImgSrc = (fullPath: string) => {
    return `/api/epubs/${encodeURIComponent(bookId)}/assets?path=${encodeURIComponent(fullPath)}`;
  };

  const downloadSelectedImages = downloadSelected
    .map((fullPath) => available.find((img) => img.fullPath === fullPath))
    .filter((img): img is GalleryImage => !!img);

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <section className="metadataModal galleryModal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <style dangerouslySetInnerHTML={{ __html: `
          .galleryModal {
            width: 1040px;
            max-width: 95vw;
            height: 680px;
            max-height: 90vh;
            display: flex;
            flex-direction: column;
            background: #faf9f6;
            border-radius: 12px;
            border: 1px solid #c9c6bd;
            box-shadow: 0 12px 36px rgba(23, 32, 28, 0.15);
            overflow: hidden;
            animation: modalFadeIn 0.25s ease-out;
          }

          @keyframes modalFadeIn {
            from { transform: scale(0.97); opacity: 0; }
            to { transform: scale(1); opacity: 1; }
          }

          .galleryModalBody {
            display: flex;
            flex: 1;
            overflow: hidden;
            min-height: 0;
            background: #faf9f6;
          }

          /* Left Panel: Available Grid */
          .galleryGridPanel {
            flex: 1.3;
            border-right: 1px solid #e2dfd6;
            padding: 16px;
            display: flex;
            flex-direction: column;
            overflow-y: auto;
            min-width: 0;
          }

          .galleryGridTitle {
            font-size: 14px;
            font-weight: 700;
            color: #373e3a;
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            gap: 6px;
          }

          .galleryPanelHeader {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 10px;
          }

          .galleryPanelHeader .galleryGridTitle {
            margin-bottom: 0;
            min-width: 0;
          }

          .galleryModeTabs,
          .galleryDownloadActions {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
          }

          .galleryModeTab,
          .galleryMiniBtn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
            border: 1px solid #c9c6bd;
            border-radius: 6px;
            background: #fffdf8;
            color: #4d574f;
            min-height: 30px;
            padding: 0 9px;
            font-size: 12px;
            font-weight: 650;
            white-space: nowrap;
          }

          .galleryModeTab.active,
          .galleryMiniBtn.primary {
            border-color: #1f624d;
            background: #e9f6f0;
            color: #1f624d;
          }

          .galleryMiniBtn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }

          .galleryToolbar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 10px;
            margin-bottom: 12px;
            min-height: 32px;
          }

          .galleryToolbarText {
            font-size: 12px;
            color: #687168;
            overflow-wrap: anywhere;
          }

          .galleryImagesGrid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
            gap: 12px;
          }

          .galleryImageCard {
            position: relative;
            background: #fff;
            border: 1px solid #e2dfd6;
            border-radius: 8px;
            overflow: hidden;
            aspect-ratio: 3/4;
            cursor: pointer;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 2px 4px rgba(0,0,0,0.02);
          }

          .galleryImageCard:hover {
            transform: translateY(-2px);
            border-color: #1f624d;
            box-shadow: 0 4px 8px rgba(31, 98, 77, 0.08);
          }

          .galleryImageCard.selected {
            border-color: #1f624d;
            background: #f0f7f4;
            box-shadow: 0 0 0 2px rgba(31, 98, 77, 0.2);
          }

          .galleryImageCard.downloadSelected {
            border-color: #2f6f8f;
            background: #edf6f8;
            box-shadow: 0 0 0 2px rgba(47, 111, 143, 0.18);
          }

          .galleryImageCard img {
            width: 100%;
            height: 100%;
            object-fit: contain;
            background: #eae6db;
          }

          .cardSelectionBadge {
            position: absolute;
            top: 6px;
            right: 6px;
            width: 22px;
            height: 22px;
            border-radius: 50%;
            background: rgba(255,255,255,0.9);
            border: 1px solid #c9c6bd;
            display: flex;
            align-items: center;
            justify-content: center;
            color: transparent;
            transition: all 0.2s ease;
          }

          .galleryImageCard.selected .cardSelectionBadge {
            background: #1f624d;
            border-color: #1f624d;
            color: #fff;
          }

          .galleryImageCard.downloadSelected .cardSelectionBadge {
            background: #2f6f8f;
            border-color: #2f6f8f;
            color: #fff;
          }

          .cardOrderIndex {
            position: absolute;
            bottom: 6px;
            left: 6px;
            background: rgba(31, 98, 77, 0.9);
            color: #fff;
            font-size: 10px;
            font-weight: 700;
            padding: 2px 6px;
            border-radius: 10px;
            pointer-events: none;
          }

          /* Right Panel: Selected & Captions List */
          .gallerySelectionPanel {
            flex: 1;
            padding: 16px;
            display: flex;
            flex-direction: column;
            overflow-y: auto;
            background: #f4f2e9;
            min-width: 0;
          }

          .selectedList {
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-top: 8px;
          }

          .selectedItemRow {
            display: flex;
            gap: 10px;
            background: #fff;
            border: 1px solid #e2dfd6;
            border-radius: 8px;
            padding: 8px;
            align-items: center;
            box-shadow: 0 2px 4px rgba(0,0,0,0.03);
          }

          .selectedRowThumb {
            width: 50px;
            height: 66px;
            border-radius: 4px;
            overflow: hidden;
            background: #eae6db;
            flex-shrink: 0;
            border: 1px solid #e2dfd6;
          }

          .selectedRowThumb img {
            width: 100%;
            height: 100%;
            object-fit: contain;
          }

          .selectedRowInputs {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 4px;
            min-width: 0;
          }

          .selectedRowPath {
            font-size: 10px;
            color: #687168;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .selectedRowCaptionInput {
            border: 1px solid #c9c6bd;
            border-radius: 4px;
            padding: 4px 8px;
            font-size: 12px;
            background: #faf9f6;
            transition: all 0.2s ease;
          }

          .selectedRowCaptionInput:focus {
            border-color: #1f624d;
            background: #fff;
            outline: none;
          }

          .selectedRowActions {
            display: flex;
            flex-direction: column;
            gap: 2px;
          }

          .rowActionBtn {
            background: none;
            border: none;
            color: #687168;
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
          }

          .rowActionBtn:hover:not(:disabled) {
            background: #f0ede4;
            color: #1f624d;
          }

          .rowActionBtn.danger:hover {
            background: #fbebeb;
            color: #ba2525;
          }

          .rowActionBtn:disabled {
            opacity: 0.3;
            cursor: not-allowed;
          }

          .noImagesMessage {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: #687168;
            font-size: 13px;
            gap: 8px;
            padding: 40px 0;
            text-align: center;
            flex: 1;
          }

          .toastMessage {
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            line-height: 1.4;
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 12px;
          }

          .toastMessage.error {
            background: #fbebeb;
            color: #ba2525;
            border: 1px solid #f2c4c4;
          }

          .toastMessage.success {
            background: #e9f6f0;
            color: #1f624d;
            border: 1px solid #94bfa7;
          }
        ` }} />

        <header className="modalHeader">
          <div>
            <h3>Gallery & Thư viện ảnh</h3>
            <p>Chọn ảnh minh họa cho EPUB hoặc tải ảnh gốc từ sách.</p>
          </div>
          <button className="iconButton" onClick={onClose} title="Đóng">
            <X size={18} />
          </button>
        </header>

        <div className="galleryModalBody">
          {loading ? (
            <div className="noImagesMessage">
              <span className="animate-spin">⏳</span>
              <span>Đang tải danh sách ảnh trong sách...</span>
            </div>
          ) : (
            <>
              {/* Left Panel: Available Images */}
              <div className="galleryGridPanel">
                <div className="galleryPanelHeader">
                  <span className="galleryGridTitle">
                    {mode === "gallery" ? <ImageIcon size={15} /> : <Images size={15} />}
                    <span>Ảnh trong sách ({available.length})</span>
                  </span>
                  <div className="galleryModeTabs">
                    <button
                      type="button"
                      className={`galleryModeTab ${mode === "gallery" ? "active" : ""}`}
                      onClick={() => setMode("gallery")}
                    >
                      <Layers size={13} />
                      <span>Gallery</span>
                    </button>
                    <button
                      type="button"
                      className={`galleryModeTab ${mode === "library" ? "active" : ""}`}
                      onClick={() => setMode("library")}
                    >
                      <Download size={13} />
                      <span>Thư viện</span>
                    </button>
                  </div>
                </div>

                {mode === "library" && (
                  <div className="galleryToolbar">
                    <span className="galleryToolbarText">Đã chọn {downloadSelected.length} ảnh để tải xuống</span>
                    <div className="galleryDownloadActions">
                      <button type="button" className="galleryMiniBtn" onClick={selectAllForDownload} disabled={available.length === 0}>
                        Tất cả
                      </button>
                      <button type="button" className="galleryMiniBtn" onClick={clearDownloadSelection} disabled={downloadSelected.length === 0}>
                        Bỏ chọn
                      </button>
                    </div>
                  </div>
                )}
                
                {available.length === 0 ? (
                  <div className="noImagesMessage">
                    <AlertCircle size={24} />
                    <span>Không tìm thấy file ảnh nào trong tài nguyên sách.</span>
                  </div>
                ) : (
                  <div className="galleryImagesGrid">
                    {available.map((img) => {
                      const isSel = selected.some((s) => s.fullPath === img.fullPath);
                      const selItem = selected.find((s) => s.fullPath === img.fullPath);
                      const isDownloadSel = downloadSelected.includes(img.fullPath);
                      return (
                        <div
                          key={img.fullPath}
                          className={`galleryImageCard ${mode === "gallery" && isSel ? "selected" : ""} ${mode === "library" && isDownloadSel ? "downloadSelected" : ""}`}
                          onClick={() => mode === "gallery" ? handleToggleSelect(img) : toggleDownloadSelect(img.fullPath)}
                          title={mode === "gallery" ? "Chọn ảnh cho trang Gallery" : "Chọn ảnh để tải xuống"}
                        >
                          <img src={getImgSrc(img.fullPath)} alt={img.fullPath.split("/").pop()} />
                          <div className="cardSelectionBadge">
                            <Check size={12} strokeWidth={3} />
                          </div>
                          {mode === "gallery" && isSel && selItem && (
                            <span className="cardOrderIndex">#{selItem.order + 1}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Right Panel: Selected List */}
              <div className="gallerySelectionPanel">
                {mode === "gallery" ? (
                  <>
                    <span className="galleryGridTitle">
                      <Layers size={15} />
                      <span>Ảnh hiển thị ở Gallery ({selected.length})</span>
                    </span>

                    {selected.length === 0 ? (
                      <div className="noImagesMessage">
                        <span>Chọn ảnh ở lưới bên trái để đưa vào Gallery.</span>
                      </div>
                    ) : (
                      <div className="selectedList">
                        {selected.map((img, idx) => {
                          const fileName = img.fullPath.split("/").pop() || img.fullPath;
                          return (
                            <div key={img.fullPath} className="selectedItemRow">
                              <div className="selectedRowThumb">
                                <img src={getImgSrc(img.fullPath)} alt={fileName} />
                              </div>
                              <div className="selectedRowInputs">
                                <span className="selectedRowPath" title={img.fullPath}>{fileName}</span>
                                <input
                                  type="text"
                                  className="selectedRowCaptionInput"
                                  placeholder="Nhập chú thích cho ảnh..."
                                  value={img.caption}
                                  onChange={(e) => handleCaptionChange(img.fullPath, e.target.value)}
                                />
                              </div>
                              <div className="selectedRowActions">
                                <button
                                  type="button"
                                  className="rowActionBtn"
                                  onClick={() => handleMoveUp(idx)}
                                  disabled={idx === 0}
                                  title="Di chuyển lên"
                                >
                                  <ArrowUp size={13} />
                                </button>
                                <button
                                  type="button"
                                  className="rowActionBtn"
                                  onClick={() => handleMoveDown(idx)}
                                  disabled={idx === selected.length - 1}
                                  title="Di chuyển xuống"
                                >
                                  <ArrowDown size={13} />
                                </button>
                                <button
                                  type="button"
                                  className="rowActionBtn danger"
                                  onClick={() => handleToggleSelect(img)}
                                  title="Bỏ chọn"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <span className="galleryGridTitle">
                      <Download size={15} />
                      <span>Ảnh chọn để tải ({downloadSelected.length})</span>
                    </span>
                    <div className="galleryToolbar">
                      <div className="galleryDownloadActions">
                        <button
                          type="button"
                          className="galleryMiniBtn primary"
                          onClick={() => handleDownloadImages(downloadSelected)}
                          disabled={downloading || downloadSelected.length === 0}
                        >
                          <Download size={13} />
                          <span>Tải ảnh đã chọn</span>
                        </button>
                        <button
                          type="button"
                          className="galleryMiniBtn"
                          onClick={() => handleDownloadImages([], true)}
                          disabled={downloading || available.length === 0}
                        >
                          <Download size={13} />
                          <span>Tải tất cả</span>
                        </button>
                      </div>
                    </div>

                    {downloadSelectedImages.length === 0 ? (
                      <div className="noImagesMessage">
                        <span>Chọn một hoặc nhiều ảnh ở lưới bên trái để tải xuống.</span>
                      </div>
                    ) : (
                      <div className="selectedList">
                        {downloadSelectedImages.map((img) => {
                          const fileName = img.fullPath.split("/").pop() || img.fullPath;
                          return (
                            <div key={img.fullPath} className="selectedItemRow">
                              <div className="selectedRowThumb">
                                <img src={getImgSrc(img.fullPath)} alt={fileName} />
                              </div>
                              <div className="selectedRowInputs">
                                <span className="selectedRowPath" title={img.fullPath}>{fileName}</span>
                                <span className="selectedRowPath" title={img.fullPath}>{img.fullPath}</span>
                              </div>
                              <div className="selectedRowActions">
                                <button
                                  type="button"
                                  className="rowActionBtn danger"
                                  onClick={() => toggleDownloadSelect(img.fullPath)}
                                  title="Bỏ chọn"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>

        <footer className="modalFooter">
          {error && (
            <div className="toastMessage error">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="toastMessage success">
              <Check size={14} />
              <span>{success}</span>
            </div>
          )}
          <button type="button" className="smallButton" onClick={onClose} disabled={saving || downloading}>
            Hủy bỏ
          </button>
          <button
            type="button"
            className="smallButton strong"
            onClick={handleSave}
            disabled={saving || downloading || loading || selected.length === 0}
          >
            <Save size={14} />
            <span>Lưu Gallery</span>
          </button>
        </footer>
      </section>
    </div>
  );
}
