import React, { useState } from "react";
import { X, Sparkles, AlertTriangle, CheckCircle, Wrench, Play } from "lucide-react";

type Props = {
  open: boolean;
  bookId: string;
  bookTitle: string;
  onClose: () => void;
  onSuccess: (newAnalysis: any) => void;
};

type RepairResult = {
  success: boolean;
  logs: string[];
  analysis: any;
};

export function RepairModal({ open, bookId, bookTitle, onClose, onSuccess }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RepairResult | null>(null);

  if (!open) return null;

  const handleRepair = async () => {
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const res = await fetch(`/api/epubs/${encodeURIComponent(bookId)}/repair`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Lỗi khi tự động sửa sách");
      }
      const data = await res.json();
      setResult(data);
      if (data.success && data.analysis) {
        onSuccess(data.analysis);
      }
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
              <Wrench size={18} />
              <span>Sửa lỗi EPUB tự động</span>
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
                <strong>Hệ thống sẽ tự động quét và sửa các lỗi cấu trúc EPUB phổ biến:</strong>
                <ul style={{ margin: "8px 0 0 16px", padding: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
                  <li><strong>Sửa lỗi Mục lục (TOC/NCX)</strong>: Xóa các liên kết hỏng, loại bỏ các mục trùng lặp, tự động lấy tiêu đề thực tế từ file HTML thay cho tiêu đề rác/rỗng, và renumber lại playOrder.</li>
                  <li><strong>Đồng bộ TOC & Spine</strong>: Tự động khởi tạo file NCX mục lục mới nếu tệp tin bị thiếu hoặc rỗng.</li>
                  <li><strong>Sửa cú pháp XHTML</strong>: Tự động đóng các thẻ đơn bị lỗi (<code>br</code>, <code>img</code>, <code>hr</code>, <code>link</code>, <code>meta</code>) để tránh lỗi XML/trang trắng trên Apple Books, Kobo...</li>
                  <li><strong>Khai báo Namespace XHTML</strong>: Bổ sung thuộc tính <code>xmlns="http://www.w3.org/1999/xhtml"</code> cho thẻ <code>html</code>.</li>
                  <li><strong>Dọn dẹp Manifest & Spine</strong>: Loại bỏ các chương ảo/lỗi khỏi spine, tự động điền media-type chính xác dựa trên phần mở rộng tệp, và đăng ký các tệp chưa được khai báo vào Manifest.</li>
                  <li><strong>Chuẩn hóa Mimetype</strong>: Đảm bảo tệp mimetype được viết đầu tiên và lưu ở dạng không nén (Store).</li>
                </ul>
              </div>

              <p style={{ fontSize: "12px", color: "#8c8273", lineHeight: "1.5", margin: 0, fontStyle: "italic" }}>
                * Quá trình này sẽ trực tiếp sửa đổi tệp EPUB gốc trong thư mục <code>edit/</code>. Bạn nên sao lưu trước nếu cần thiết.
              </p>

              <button
                type="button"
                className="smallButton strong"
                onClick={handleRepair}
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
                <span>Bắt đầu sửa lỗi tự động</span>
              </button>
            </div>
          )}

          {loading && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 0", gap: "16px" }}>
              <div className="spinner" style={{ width: "36px", height: "36px", border: "3px solid #e6dfd3", borderTopColor: "#2f7d69", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                <span style={{ fontSize: "14px", fontWeight: "600", color: "#1f624d" }}>Đang phân tích cấu trúc & sửa lỗi EPUB...</span>
                <span style={{ fontSize: "12px", color: "#8c8273" }}>Vui lòng đợi trong giây lát.</span>
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
                <span style={{ fontSize: "16px", fontWeight: "600" }}>Hoàn thành sửa lỗi EPUB!</span>
              </div>

              <div>
                <span style={{ fontSize: "12px", fontWeight: "600", color: "#8c8273", display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                  <span>Chi tiết các hoạt động sửa lỗi:</span>
                </span>
                <div
                  style={{
                    maxHeight: "260px",
                    overflowY: "auto",
                    border: "1px solid #e6dfd3",
                    borderRadius: "6px",
                    background: "#fff",
                    padding: "12px 16px",
                    fontSize: "12px",
                    fontFamily: "monospace",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px"
                  }}
                >
                  {result.logs.map((log, index) => {
                    let color = "#544f45";
                    if (log.startsWith("[Mục lục]")) color = "#2f7d69";
                    else if (log.startsWith("[XHTML]")) color = "#2980b9";
                    else if (log.startsWith("[Manifest]") || log.startsWith("[Spine]")) color = "#e67e22";
                    else if (log.startsWith("[Mimetype]")) color = "#8e44ad";
                    
                    return (
                      <div key={index} style={{ color, wordBreak: "break-all", lineHeight: "1.4" }}>
                        • {log}
                      </div>
                    );
                  })}
                </div>
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
