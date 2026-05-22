import React, { useState, useRef } from "react";
import { X, BookOpen, ArrowUp, ArrowDown, Trash2, Save, Upload, AlertCircle, CheckCircle, RefreshCw } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  onImportSuccess: (newFileName: string) => void;
  onSetBusy: (busyText: string) => void;
  onSetError: (errorText: string) => void;
};

type SelectedImageFile = {
  id: string;
  file: File;
  previewUrl: string;
  name: string;
  size: number;
};

export function MangaModal({ open, onClose, onImportSuccess, onSetBusy, onSetError }: Props) {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [direction, setDirection] = useState("rtl");
  const [images, setImages] = useState<SelectedImageFile[]>([]);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalError, setModalError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addFiles(Array.from(e.target.files));
      e.target.value = "";
    }
  };

  const addFiles = (files: File[]) => {
    const imageFiles = files.filter(f => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;

    const newFiles: SelectedImageFile[] = imageFiles.map(file => ({
      id: Math.random().toString(36).substring(2, 9) + Date.now(),
      file,
      previewUrl: URL.createObjectURL(file),
      name: file.name,
      size: file.size
    }));

    setImages(prev => {
      const combined = [...prev, ...newFiles];
      return combined.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    });
  };

  const handleRemoveImage = (id: string, previewUrl: string) => {
    setImages(prev => prev.filter(img => img.id !== id));
    URL.revokeObjectURL(previewUrl);
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    setImages(prev => {
      const updated = [...prev];
      const temp = updated[index];
      updated[index] = updated[index - 1];
      updated[index - 1] = temp;
      return updated;
    });
  };

  const handleMoveDown = (index: number) => {
    if (index === images.length - 1) return;
    setImages(prev => {
      const updated = [...prev];
      const temp = updated[index];
      updated[index] = updated[index + 1];
      updated[index + 1] = temp;
      return updated;
    });
  };

  const handleSortAlphabetically = () => {
    setImages(prev => [...prev].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })));
  };

  const handleClearAll = () => {
    images.forEach(img => URL.revokeObjectURL(img.previewUrl));
    setImages([]);
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setModalError("Vui lòng nhập tiêu đề Manga.");
      return;
    }
    if (images.length === 0) {
      setModalError("Vui lòng tải lên ít nhất một trang truyện.");
      return;
    }

    setModalError("");
    setIsSubmitting(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append("title", title.trim());
    formData.append("author", author.trim() || "Khuyết danh");
    formData.append("direction", direction);

    images.forEach((img) => {
      formData.append("images", img.file, img.name);
    });

    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percentage = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(percentage);
      }
    };

    xhr.onload = () => {
      setIsSubmitting(false);
      setUploadProgress(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        let responseData;
        try {
          responseData = JSON.parse(xhr.responseText);
        } catch (e) {
          responseData = { fileName: "manga.epub" };
        }
        
        images.forEach(img => URL.revokeObjectURL(img.previewUrl));
        setImages([]);
        setTitle("");
        setAuthor("");
        
        onImportSuccess(responseData.fileName || "manga.epub");
        onClose();
      } else {
        let errText = "Không thể tạo sách Manga.";
        try {
          const errData = JSON.parse(xhr.responseText);
          errText = errData.error || errText;
        } catch (e) {}
        setModalError(errText);
      }
    };

    xhr.onerror = () => {
      setIsSubmitting(false);
      setUploadProgress(null);
      setModalError("Lỗi kết nối mạng hoặc server không phản hồi.");
    };

    xhr.open("POST", "/api/epubs/create-manga");
    xhr.send(formData);
  };

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <section 
        className="metadataModal mangaModal" 
        role="dialog" 
        aria-modal="true" 
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: "900px",
          maxWidth: "95vw",
          height: "680px",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          background: "#fbf8f3",
          borderRadius: "12px",
          border: "1px solid #e6dfd3",
          boxShadow: "0 12px 36px rgba(23, 32, 28, 0.15)",
          overflow: "hidden",
          animation: "mangaModalFadeIn 0.25s ease-out"
        }}
      >
        <style dangerouslySetInnerHTML={{ __html: `
          @keyframes mangaModalFadeIn {
            from { transform: scale(0.97); opacity: 0; }
            to { transform: scale(1); opacity: 1; }
          }
          
          .mangaModalLayout {
            display: flex;
            flex: 1;
            overflow: hidden;
            background: #fbf8f3;
          }

          .mangaModalFormPanel {
            flex: 1;
            padding: 20px;
            border-right: 1px solid #e6dfd3;
            display: flex;
            flex-direction: column;
            gap: 16px;
            overflow-y: auto;
          }

          .mangaModalListPanel {
            flex: 1.3;
            padding: 20px;
            display: flex;
            flex-direction: column;
            background: #faf7f0;
            overflow-y: auto;
          }

          .mangaFormGroup {
            display: flex;
            flex-direction: column;
            gap: 6px;
          }

          .mangaFormGroup label {
            font-size: 13px;
            font-weight: 600;
            color: #544f45;
          }

          .mangaInput {
            border: 1px solid #c9c6bd;
            border-radius: 8px;
            padding: 8px 12px;
            font-size: 13px;
            background: #fff;
            transition: all 0.2s ease;
          }

          .mangaInput:focus {
            border-color: #2f7d69;
            outline: none;
            box-shadow: 0 0 0 2px rgba(47, 125, 105, 0.15);
          }

          .mangaSelect {
            border: 1px solid #c9c6bd;
            border-radius: 8px;
            padding: 8px 12px;
            font-size: 13px;
            background: #fff;
            transition: all 0.2s ease;
            cursor: pointer;
          }

          .mangaSelect:focus {
            border-color: #2f7d69;
            outline: none;
          }

          .mangaUploadArea {
            border: 2px dashed #c9c6bd;
            border-radius: 10px;
            padding: 24px;
            text-align: center;
            background: #fff;
            cursor: pointer;
            transition: all 0.2s ease;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
          }

          .mangaUploadArea:hover {
            border-color: #2f7d69;
            background: #f0f7f5;
          }

          .mangaUploadArea p {
            margin: 0;
            font-size: 12px;
            color: #8c8273;
          }

          .mangaUploadArea span {
            font-size: 13px;
            font-weight: 600;
            color: #2f7d69;
          }

          .mangaListHeader {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
            padding-bottom: 8px;
            border-bottom: 1px solid #e6dfd3;
          }

          .mangaListTitle {
            font-size: 14px;
            font-weight: 700;
            color: #1f624d;
            display: flex;
            align-items: center;
            gap: 6px;
          }

          .mangaListActions {
            display: flex;
            gap: 10px;
          }

          .mangaListActionBtn {
            background: none;
            border: none;
            color: #2f7d69;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            padding: 0;
            display: flex;
            align-items: center;
            gap: 4px;
            transition: color 0.2s ease;
          }

          .mangaListActionBtn:hover {
            color: #1f624d;
            text-decoration: underline;
          }

          .mangaListActionBtn.danger {
            color: #ba2525;
          }

          .mangaListActionBtn.danger:hover {
            color: #8f1f1f;
          }

          .mangaItemsContainer {
            display: flex;
            flex-direction: column;
            gap: 8px;
            flex: 1;
            min-height: 0;
          }

          .mangaItemRow {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 8px;
            background: #fff;
            border: 1px solid #e6dfd3;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.02);
            transition: transform 0.2s ease;
          }

          .mangaItemRow:hover {
            transform: translateY(-1px);
            box-shadow: 0 3px 6px rgba(0,0,0,0.04);
          }

          .mangaItemThumb {
            width: 44px;
            height: 60px;
            background: #eae6db;
            border-radius: 4px;
            overflow: hidden;
            flex-shrink: 0;
            border: 1px solid #e6dfd3;
          }

          .mangaItemThumb img {
            width: 100%;
            height: 100%;
            object-fit: cover;
          }

          .mangaItemDetails {
            flex: 1;
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 2px;
          }

          .mangaItemName {
            font-size: 12px;
            font-weight: 600;
            color: #332d21;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .mangaItemSize {
            font-size: 10px;
            color: #8c8273;
          }

          .mangaRowActions {
            display: flex;
            gap: 2px;
          }

          .mangaRowBtn {
            background: none;
            border: none;
            color: #8c8273;
            padding: 4px;
            cursor: pointer;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
          }

          .mangaRowBtn:hover:not(:disabled) {
            background: #f0faf7;
            color: #2f7d69;
          }

          .mangaRowBtn.danger:hover {
            background: #fbebeb;
            color: #ba2525;
          }

          .mangaRowBtn:disabled {
            opacity: 0.3;
            cursor: not-allowed;
          }

          .mangaEmptyState {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 40px 20px;
            text-align: center;
            color: #8c8273;
            gap: 8px;
            border: 1px dashed #c9c6bd;
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.4);
            flex: 1;
          }

          .progressBarContainer {
            width: 100%;
            height: 6px;
            background: #e6dfd3;
            border-radius: 3px;
            overflow: hidden;
            margin-top: 4px;
          }

          .progressBarFill {
            height: 100%;
            background: #2f7d69;
            transition: width 0.1s ease;
          }
        ` }} />

        <header className="modalHeader" style={{ borderBottom: "1px solid #e6dfd3", padding: "16px 20px" }}>
          <div>
            <h3 style={{ margin: 0, color: "#1f624d", display: "flex", alignItems: "center", gap: "8px" }}>
              <BookOpen size={18} />
              <span>Đóng gói Manga EPUB</span>
            </h3>
            <p style={{ margin: "2px 0 0", color: "#8c8273", fontSize: "12px" }}>
              Tạo tệp EPUB truyện tranh chuyên dụng với viewport full-bleed từ thư mục hình ảnh của bạn.
            </p>
          </div>
          <button className="iconButton" onClick={onClose} title="Đóng" disabled={isSubmitting}>
            <X size={18} />
          </button>
        </header>

        <div className="mangaModalLayout">
          <form className="mangaModalFormPanel" onSubmit={handleSubmit}>
            <div className="mangaFormGroup">
              <label>Tiêu đề Manga <span style={{ color: "#ba2525" }}>*</span></label>
              <input 
                type="text" 
                className="mangaInput" 
                placeholder="Ví dụ: XXXX - Tập 1" 
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={isSubmitting}
                required
              />
            </div>

            <div className="mangaFormGroup">
              <label>Tác giả / Artist</label>
              <input 
                type="text" 
                className="mangaInput" 
                placeholder="Ví dụ: XXXX" 
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <div className="mangaFormGroup">
              <label>Hướng lật trang (Page Progression)</label>
              <select 
                className="mangaSelect" 
                value={direction} 
                onChange={(e) => setDirection(e.target.value)}
                disabled={isSubmitting}
              >
                <option value="rtl">Phải sang Trái (RTL - Manga Nhật Bản)</option>
                <option value="ltr">Trái sang Phải (LTR - Manhua, Webtoon, Comic)</option>
              </select>
            </div>

            <div className="mangaFormGroup" style={{ marginTop: "8px" }}>
              <label>Tải ảnh lên</label>
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileSelect} 
                accept="image/*" 
                multiple 
                style={{ display: "none" }}
              />
              <div className="mangaUploadArea" onClick={() => fileInputRef.current?.click()}>
                <Upload size={24} style={{ color: "#2f7d69" }} />
                <span>Chọn các trang truyện (Hình ảnh)</span>
                <p>Hỗ trợ JPG, PNG, WebP. Tự động sắp xếp theo bảng chữ cái.</p>
              </div>
            </div>

            {modalError && (
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "10px 12px",
                background: "#fdf2f2",
                border: "1px solid #f8b4b4",
                borderRadius: "8px",
                color: "#9b1c1c",
                fontSize: "12px",
                lineHeight: "1.4"
              }}>
                <AlertCircle size={14} style={{ flexShrink: 0 }} />
                <span>{modalError}</span>
              </div>
            )}

            {isSubmitting && (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "auto" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#1f624d", fontWeight: "600" }}>
                  <span>{uploadProgress !== null ? `Đang tải ảnh & đóng gói EPUB: ${uploadProgress}%` : "Đang xử lý tạo file EPUB..."}</span>
                </div>
                {uploadProgress !== null && (
                  <div className="progressBarContainer">
                    <div className="progressBarFill" style={{ width: `${uploadProgress}%` }} />
                  </div>
                )}
              </div>
            )}
          </form>

          {/* Right panel: Uploaded List & Order */}
          <div className="mangaModalListPanel">
            <div className="mangaListHeader">
              <span className="mangaListTitle">
                <BookOpen size={15} />
                <span>Các trang đã nạp ({images.length})</span>
              </span>
              {images.length > 0 && (
                <div className="mangaListActions">
                  <button type="button" className="mangaListActionBtn" onClick={handleSortAlphabetically} disabled={isSubmitting}>
                    <RefreshCw size={12} />
                    <span>Sắp xếp A-Z</span>
                  </button>
                  <button type="button" className="mangaListActionBtn danger" onClick={handleClearAll} disabled={isSubmitting}>
                    <Trash2 size={12} />
                    <span>Xoá tất cả</span>
                  </button>
                </div>
              )}
            </div>

            {images.length === 0 ? (
              <div className="mangaEmptyState">
                <BookOpen size={28} style={{ color: "#c9c6bd", marginBottom: "4px" }} />
                <span style={{ fontSize: "13px", fontWeight: "600", color: "#8c8273" }}>Chưa có trang truyện nào được chọn</span>
                <p style={{ margin: "2px 0 0", fontSize: "11px", color: "#8c8273" }}>Hãy nhấn "Chọn các trang truyện" bên trái để tải lên.</p>
              </div>
            ) : (
              <div className="mangaItemsContainer">
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", overflowY: "auto", flex: 1, paddingRight: "4px" }}>
                  {images.map((img, idx) => (
                    <div key={img.id} className="mangaItemRow">
                      <div className="mangaItemThumb">
                        <img src={img.previewUrl} alt={img.name} />
                      </div>
                      <div className="mangaItemDetails">
                        <span className="mangaItemName" title={img.name}>{img.name}</span>
                        <span className="mangaItemSize">Trang {idx + 1} · {formatSize(img.size)}</span>
                      </div>
                      <div className="mangaRowActions">
                        <button 
                          type="button" 
                          className="mangaRowBtn" 
                          onClick={() => handleMoveUp(idx)} 
                          disabled={idx === 0 || isSubmitting}
                          title="Di chuyển lên"
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button 
                          type="button" 
                          className="mangaRowBtn" 
                          onClick={() => handleMoveDown(idx)} 
                          disabled={idx === images.length - 1 || isSubmitting}
                          title="Di chuyển xuống"
                        >
                          <ArrowDown size={14} />
                        </button>
                        <button 
                          type="button" 
                          className="mangaRowBtn danger" 
                          onClick={() => handleRemoveImage(img.id, img.previewUrl)} 
                          disabled={isSubmitting}
                          title="Xóa trang"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <footer className="modalFooter" style={{ padding: "12px 20px", borderTop: "1px solid #e6dfd3", background: "#f3eedf", display: "flex", justifyContent: "flex-end", gap: "10px" }}>
          <button 
            type="button" 
            className="smallButton" 
            onClick={onClose} 
            disabled={isSubmitting}
            style={{
              padding: "8px 16px",
              fontSize: "13px",
              fontWeight: "500",
              cursor: "pointer",
              borderRadius: "6px",
              border: "1px solid #c9c6bd",
              background: "#fff",
              color: "#544f45"
            }}
          >
            Hủy bỏ
          </button>
          <button 
            type="submit" 
            className="smallButton strong" 
            onClick={handleSubmit}
            disabled={isSubmitting || images.length === 0}
            style={{
              padding: "8px 16px",
              fontSize: "13px",
              fontWeight: "600",
              cursor: "pointer",
              borderRadius: "6px",
              border: "none",
              background: "#2f7d69",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              boxShadow: "0 2px 4px rgba(47, 125, 105, 0.2)"
            }}
          >
            <Save size={14} />
            <span>Tạo Manga EPUB</span>
          </button>
        </footer>
      </section>
    </div>
  );
}
