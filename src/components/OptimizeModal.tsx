import React, { useState } from "react";
import { X, Sparkles, AlertTriangle, CheckCircle, Trash2, ArrowDown } from "lucide-react";

type Props = {
  open: boolean;
  bookId: string;
  bookTitle: string;
  onClose: () => void;
  onSuccess: () => void;
};

type OptimizeResult = {
  success: boolean;
  originalSize: number;
  newSize: number;
  removedFiles: string[];
};

export function OptimizeModal({ open, bookId, bookTitle, onClose, onSuccess }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<OptimizeResult | null>(null);

  
  const [cleanUnusedImages, setCleanUnusedImages] = useState(true);
  const [cleanUnusedFonts, setCleanUnusedFonts] = useState(true);
  const [compressImages, setCompressImages] = useState(true);
  const [imageQuality, setImageQuality] = useState(75);

  if (!open) return null;

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const handleOptimize = async () => {
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const res = await fetch(`/api/epubs/${encodeURIComponent(bookId)}/optimize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cleanUnusedImages,
          cleanUnusedFonts,
          compressImages,
          imageQuality,
        }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Lỗi khi tối ưu hóa sách");
      }
      const data = await res.json();
      setResult(data);
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Đã xảy ra lỗi không xác định.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="metadataModal"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, 95vw)",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          padding: 0,
          overflow: "hidden",
          background: "#fbf8f3",
          border: "1px solid #e6dfd3",
          boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)"
        }}
      >
        <header className="modalHeader" style={{ padding: "16px 20px", borderBottom: "1px solid #e6dfd3" }}>
          <div>
            <h3 style={{ margin: 0, color: "#1f624d", display: "flex", alignItems: "center", gap: "8px" }}>
              <Sparkles size={18} />
              <span>Tối ưu hóa EPUB</span>
            </h3>
            <p style={{ margin: "2px 0 0", color: "#8c8273", fontSize: "12px" }}>
              {bookTitle}
            </p>
          </div>
          <button className="iconButton" onClick={onClose} title="Đóng">
            <X size={18} />
          </button>
        </header>

        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
          {error && (
            <div
              style={{
                background: "#fdf2f2",
                border: "1px solid #f8b4b4",
                color: "#9b1c1c",
                borderRadius: "8px",
                padding: "12px",
                fontSize: "13px",
                marginBottom: "16px",
                display: "flex",
                alignItems: "center",
                gap: "8px"
              }}
            >
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          )}

          {!result && !loading && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div
                style={{
                  background: "#edf7f5",
                  border: "1px solid #cce8e1",
                  borderRadius: "8px",
                  padding: "14px",
                  fontSize: "13px",
                  color: "#234e43",
                  lineHeight: "1.5"
                }}
              >
                <strong>Bộ tối ưu hóa giúp giảm thiểu dung lượng file sách:</strong>
                <ul style={{ margin: "8px 0 0 16px", padding: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
                  <li>Phân tích và phát hiện toàn bộ tài nguyên thừa không sử dụng trong sách.</li>
                  <li>Cập nhật file OPF Manifest đảm bảo tệp tin sạch sẽ, chuẩn cấu trúc EPUB.</li>
                </ul>
              </div>

              
              <div
                style={{
                  border: "1px solid #e6dfd3",
                  borderRadius: "8px",
                  background: "#fff",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "14px"
                }}
              >
                <span style={{ fontSize: "11px", fontWeight: "700", color: "#8c8273", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Tùy chỉnh tối ưu hóa
                </span>

                <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer", fontSize: "13px", color: "#17201c" }}>
                  <input
                    type="checkbox"
                    checked={cleanUnusedImages}
                    onChange={(e) => setCleanUnusedImages(e.target.checked)}
                    style={{ width: "16px", height: "16px", accentColor: "#2f7d69", marginTop: "2px" }}
                  />
                  <div>
                    <strong style={{ display: "block" }}>Dọn dẹp ảnh thừa không dùng</strong>
                    <span style={{ color: "#687168", fontSize: "11px" }}>Tự động xóa các file ảnh rác không được liên kết trong bất kỳ chương nào.</span>
                  </div>
                </label>

                <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer", fontSize: "13px", color: "#17201c" }}>
                  <input
                    type="checkbox"
                    checked={cleanUnusedFonts}
                    onChange={(e) => setCleanUnusedFonts(e.target.checked)}
                    style={{ width: "16px", height: "16px", accentColor: "#2f7d69", marginTop: "2px" }}
                  />
                  <div>
                    <strong style={{ display: "block" }}>Dọn dẹp font chữ thừa</strong>
                    <span style={{ color: "#687168", fontSize: "11px" }}>Tự động xóa các tệp font (.ttf, .otf, .woff) không được khai báo sử dụng.</span>
                  </div>
                </label>

                <div style={{ borderTop: "1px solid #f0eae1", paddingTop: "12px", display: "flex", flexDirection: "column", gap: "12px" }}>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer", fontSize: "13px", color: "#17201c" }}>
                    <input
                      type="checkbox"
                      checked={compressImages}
                      onChange={(e) => setCompressImages(e.target.checked)}
                      style={{ width: "16px", height: "16px", accentColor: "#2f7d69", marginTop: "2px" }}
                    />
                    <div>
                      <strong style={{ display: "block" }}>Nén giảm dung lượng ảnh</strong>
                      <span style={{ color: "#687168", fontSize: "11px" }}>Thực hiện nén lại toàn bộ hình ảnh JPEG và PNG trong sách để tiết kiệm bộ nhớ.</span>
                    </div>
                  </label>

                  {compressImages && (
                    <div style={{ paddingLeft: "26px", display: "flex", flexDirection: "column", gap: "6px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12px" }}>
                        <span style={{ color: "#687168" }}>Chất lượng ảnh JPEG sau nén:</span>
                        <strong style={{ color: "#2f7d69", fontSize: "13px" }}>{imageQuality}%</strong>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span style={{ fontSize: "11px", color: "#8a928a" }}>Dung lượng nhỏ</span>
                        <input
                          type="range"
                          min="10"
                          max="100"
                          value={imageQuality}
                          onChange={(e) => setImageQuality(parseInt(e.target.value))}
                          style={{ flex: 1, accentColor: "#2f7d69", height: "6px", borderRadius: "3px", cursor: "pointer" }}
                        />
                        <span style={{ fontSize: "11px", color: "#8a928a" }}>Chất lượng cao</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <p style={{ fontSize: "12px", color: "#8c8273", lineHeight: "1.5", margin: 0, fontStyle: "italic" }}>
                * Quá trình này ghi đè trực tiếp lên tệp sách đang chỉnh sửa trong thư mục <code>edit/</code> để tránh phát sinh file rác.
              </p>

              <button
                type="button"
                className="smallButton strong"
                onClick={handleOptimize}
                disabled={!cleanUnusedImages && !cleanUnusedFonts && !compressImages}
                style={{
                  width: "100%",
                  height: "42px",
                  fontSize: "14px",
                  fontWeight: "600",
                  marginTop: "8px",
                  background: "#2f7d69",
                  color: "#fff",
                  borderRadius: "8px",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  boxShadow: "0 4px 6px -1px rgba(47, 125, 105, 0.2)"
                }}
              >
                <Sparkles size={16} />
                <span>Bắt đầu tối ưu hóa</span>
              </button>
            </div>
          )}

          {loading && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 0", gap: "16px" }}>
              <div className="spinner" style={{ width: "36px", height: "36px", border: "3px solid #e6dfd3", borderTopColor: "#2f7d69", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                <span style={{ fontSize: "14px", fontWeight: "600", color: "#1f624d" }}>Đang quét và tối ưu hóa tài nguyên...</span>
                <span style={{ fontSize: "12px", color: "#8c8273" }}>Quá trình này có thể mất vài giây tùy vào kích thước sách.</span>
              </div>
              <style dangerouslySetInnerHTML={{ __html: `
                @keyframes spin {
                  to { transform: rotate(360deg); }
                }
              `}} />
            </div>
          )}

          {result && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "#1f624d" }}>
                <CheckCircle size={24} />
                <span style={{ fontSize: "16px", fontWeight: "600" }}>Tối ưu hóa hoàn tất thành công!</span>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "12px",
                  background: "#fff",
                  border: "1px solid #e6dfd3",
                  borderRadius: "8px",
                  padding: "16px"
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span style={{ fontSize: "11px", color: "#8c8273", textTransform: "uppercase", fontWeight: "600" }}>Dung lượng gốc</span>
                  <span style={{ fontSize: "15px", fontWeight: "600", color: "#544f45" }}>{formatSize(result.originalSize)}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span style={{ fontSize: "11px", color: "#8c8273", textTransform: "uppercase", fontWeight: "600" }}>Dung lượng mới</span>
                  <span style={{ fontSize: "15px", fontWeight: "600", color: "#1f624d" }}>{formatSize(result.newSize)}</span>
                </div>
                <div style={{ gridColumn: "span 2", borderTop: "1px solid #f0eae1", paddingTop: "10px", marginTop: "4px", display: "flex", alignItems: "center", gap: "8px" }}>
                  <ArrowDown size={16} style={{ color: "#2f7d69" }} />
                  <span style={{ fontSize: "13px", fontWeight: "600", color: "#2f7d69" }}>
                    Tiết kiệm được: {formatSize(Math.max(0, result.originalSize - result.newSize))} ({result.originalSize > 0 ? ((Math.max(0, result.originalSize - result.newSize) / result.originalSize) * 100).toFixed(1) : 0}%)
                  </span>
                </div>
              </div>

              <div>
                <span style={{ fontSize: "12px", fontWeight: "600", color: "#8c8273", display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                  <Trash2 size={12} />
                  <span>Đã xóa {result.removedFiles.length} tệp tin thừa không sử dụng:</span>
                </span>
                {result.removedFiles.length === 0 ? (
                  <div style={{ fontSize: "13px", color: "#8c8273", fontStyle: "italic", background: "#fbf8f3", border: "1px dashed #e6dfd3", borderRadius: "6px", padding: "10px", textAlign: "center" }}>
                    Không phát hiện hoặc không thực hiện xóa tệp tin rác nào.
                  </div>
                ) : (
                  <div
                    style={{
                      maxHeight: "150px",
                      overflowY: "auto",
                      border: "1px solid #e6dfd3",
                      borderRadius: "6px",
                      background: "#fff",
                      padding: "8px 12px",
                      fontSize: "12px",
                      fontFamily: "monospace",
                      display: "flex",
                      flexDirection: "column",
                      gap: "4px"
                    }}
                  >
                    {result.removedFiles.map((file) => (
                      <div key={file} style={{ color: "#c0392b", wordBreak: "break-all" }}>
                        - {file}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <footer className="modalFooter" style={{ padding: "12px 20px", borderTop: "1px solid #e6dfd3", background: "#f3eedf", display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="smallButton"
            onClick={onClose}
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
            {result ? "Đóng" : "Hủy"}
          </button>
        </footer>
      </section>
    </div>
  );
}
