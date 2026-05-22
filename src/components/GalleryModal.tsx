import React, { useState, useEffect } from "react";
import { X, Image as ImageIcon, ArrowUp, ArrowDown, Trash2, Save, Check, Layers, AlertCircle } from "lucide-react";
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

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <section className="metadataModal galleryModal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <style dangerouslySetInnerHTML={{ __html: `
          .galleryModal {
            width: 950px;
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
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 6px;
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
            <h3>Thiết lập Gallery Minh Họa</h3>
            <p>Tạo trang tuyển tập hình ảnh nằm ngay sau bìa sách.</p>
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
                <span className="galleryGridTitle">
                  <ImageIcon size={15} />
                  <span>Ảnh có sẵn trong sách ({available.length})</span>
                </span>
                
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
                      return (
                        <div
                          key={img.fullPath}
                          className={`galleryImageCard ${isSel ? "selected" : ""}`}
                          onClick={() => handleToggleSelect(img)}
                        >
                          <img src={getImgSrc(img.fullPath)} alt={img.fullPath.split("/").pop()} />
                          <div className="cardSelectionBadge">
                            <Check size={12} strokeWidth={3} />
                          </div>
                          {isSel && selItem && (
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
                <span className="galleryGridTitle">
                  <Layers size={15} />
                  <span>Ảnh đã chọn hiển thị ở Gallery ({selected.length})</span>
                </span>

                {selected.length === 0 ? (
                  <div className="noImagesMessage">
                    <span>Vui lòng chọn ảnh ở lưới bên trái để đưa vào Gallery.</span>
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
          <button type="button" className="smallButton" onClick={onClose} disabled={saving}>
            Hủy bỏ
          </button>
          <button
            type="button"
            className="smallButton strong"
            onClick={handleSave}
            disabled={saving || loading || selected.length === 0}
          >
            <Save size={14} />
            <span>Lưu Gallery</span>
          </button>
        </footer>
      </section>
    </div>
  );
}
