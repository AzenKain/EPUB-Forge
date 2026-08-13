import React, { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle, Download, RefreshCw, Sparkles, X } from "lucide-react";
import { api } from "../lib/api";
import { formatBytes } from "../lib/format";
import type { UpdateCheckResponse, UpdateProgressResponse } from "../lib/types";

type Props = {
  open: boolean;
  onClose: () => void;
  updateInfo: UpdateCheckResponse | null;
};

export function UpdateModal({ open, onClose, updateInfo }: Props) {
  const [status, setStatus] = useState<"idle" | "downloading" | "applying" | "completed" | "error">("idle");
  const [percent, setPercent] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [pollIntervalId, setPollIntervalId] = useState<any | null>(null);

  useEffect(() => {
    return () => {
      if (pollIntervalId) {
        clearInterval(pollIntervalId);
      }
    };
  }, [pollIntervalId]);

  const [isRestarting, setIsRestarting] = useState(false);

  async function handleRestart() {
    setIsRestarting(true);
    try {
      await fetch("/api/update/restart", { method: "POST" });
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (err) {
      console.error("Lỗi khi gửi yêu cầu khởi động lại:", err);
      setIsRestarting(false);
    }
  }

  if (!open || !updateInfo) return null;

  const isUpdating = status === "downloading" || status === "applying";

  async function handleStartUpdate() {
    if (isUpdating) return;

    setStatus("downloading");
    setPercent(0);
    setErrorMsg("");

    try {
      const res = await fetch("/api/update/run", { method: "POST" });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Không thể bắt đầu cập nhật");
      }

      const interval = setInterval(async () => {
        try {
          const progress = await api<UpdateProgressResponse>("/api/update/progress");
          
          setStatus(progress.status);
          setPercent(progress.percent);
          
          if (progress.status === "completed") {
            clearInterval(interval);
            setPollIntervalId(null);
          } else if (progress.status === "error") {
            clearInterval(interval);
            setErrorMsg(progress.error || "Có lỗi xảy ra trong quá trình cài đặt bản cập nhật.");
            setPollIntervalId(null);
          }
        } catch (pollErr) {
          console.error("Lỗi khi kiểm tra tiến trình cập nhật:", pollErr);
        }
      }, 500);

      setPollIntervalId(interval);
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  function handleClose() {
    if (isUpdating) {
      if (!window.confirm("Bản cập nhật đang được tải hoặc cài đặt. Bạn có chắc chắn muốn đóng giao diện (tiến trình cập nhật vẫn sẽ chạy ngầm)?")) {
        return;
      }
    }
    onClose();
  }

  const renderedReleaseNotes = updateInfo.releaseNotes ? (
    <div
      style={{
        whiteSpace: "pre-wrap",
        fontFamily: "var(--font-mono, monospace)",
        fontSize: "12px",
        lineHeight: "1.5",
        color: "#4e473e",
      }}
    >
      {updateInfo.releaseNotes}
    </div>
  ) : (
    <em style={{ color: "#8c8273", fontSize: "13px" }}>Không có mô tả chi tiết cho bản phát hành này.</em>
  );

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={handleClose}>
      <section
        className="metadataModal"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
        style={{
          width: "min(600px, 95vw)",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          padding: 0,
          overflow: "hidden",
          borderRadius: "12px",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.04)"
        }}
      >
        <header className="modalHeader" style={{ padding: "18px 24px", borderBottom: "1px solid #e6dfd3", background: "linear-gradient(to right, #fdfbf7, #f6f3eb)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ background: "#e8f5e9", color: "#1f624d", padding: "8px", borderRadius: "8px" }}>
              <Sparkles size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, color: "#1f624d", fontSize: "16px", fontWeight: 700 }}>
                Cập nhật ứng dụng
              </h3>
              <p style={{ margin: "2px 0 0", color: "#8c8273", fontSize: "12px" }}>
                Có phiên bản mới dành cho EPUB-Forge
              </p>
            </div>
          </div>
          <button className="iconButton" onClick={handleClose} title="Đóng" disabled={isUpdating} style={{ opacity: isUpdating ? 0.5 : 1 }}>
            <X size={18} />
          </button>
        </header>

        <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
          {/* Version Info Card */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              background: "#fdfbf7",
              border: "1px solid #eee7dc",
              borderRadius: "10px",
              padding: "16px 20px",
              marginBottom: "20px"
            }}
          >
            <div>
              <span style={{ fontSize: "12px", color: "#8c8273", display: "block" }}>Phiên bản hiện tại</span>
              <strong style={{ fontSize: "16px", color: "#544f45" }}>v{updateInfo.currentVersion}</strong>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", color: "#1f624d" }}>
              <RefreshCw size={16} className={isUpdating ? "spin" : ""} style={{ animation: isUpdating ? "spin 2s linear infinite" : "none" }} />
              <span style={{ fontSize: "10px", marginTop: "4px", fontWeight: 600 }}>CẬP NHẬT</span>
            </div>
            <div style={{ textAlign: "right" }}>
              <span style={{ fontSize: "12px", color: "#8c8273", display: "block" }}>Phiên bản mới nhất</span>
              <strong style={{ fontSize: "18px", color: "#1f624d" }}>v{updateInfo.latestVersion}</strong>
            </div>
          </div>

          {/* Release Notes */}
          {status === "idle" && (
            <div style={{ marginBottom: "20px" }}>
              <h4 style={{ margin: "0 0 10px 0", color: "#27231e", fontSize: "13px", fontWeight: 650 }}>
                Thông tin bản phát hành:
              </h4>
              <div
                style={{
                  border: "1px solid #eee7dc",
                  borderRadius: "8px",
                  padding: "14px",
                  background: "#fcfbf9",
                  maxHeight: "180px",
                  overflowY: "auto"
                }}
              >
                {renderedReleaseNotes}
              </div>
              {updateInfo.assetName && (
                <div style={{ marginTop: "12px", fontSize: "12px", color: "#6f675c", display: "flex", gap: "8px" }}>
                  <span>Tệp tải xuống: <code style={{ color: "#27231e" }}>{updateInfo.assetName}</code></span>
                  {updateInfo.assetSize > 0 && (
                    <span>({formatBytes(updateInfo.assetSize)})</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Update Progress Area */}
          {status !== "idle" && (
            <div style={{ padding: "10px 0" }}>
              {status === "downloading" && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px", fontSize: "13px" }}>
                    <span style={{ color: "#544f45", fontWeight: 500 }}>Đang tải bản cập nhật...</span>
                    <span style={{ color: "#1f624d", fontWeight: 700 }}>{percent}%</span>
                  </div>
                  <div style={{ height: "10px", width: "100%", background: "#eee7dc", borderRadius: "5px", overflow: "hidden", marginBottom: "8px" }}>
                    <div
                      style={{
                        height: "100%",
                        width: `${percent}%`,
                        background: "linear-gradient(90deg, #2e7d32, #1f624d)",
                        borderRadius: "5px",
                        transition: "width 0.3s ease-out"
                      }}
                    />
                  </div>
                  <span style={{ fontSize: "11px", color: "#8c8273" }}>Vui lòng không tắt máy chủ trong quá trình tải xuống.</span>
                </div>
              )}

              {status === "applying" && (
                <div style={{ textAlign: "center", padding: "16px 0" }}>
                  <RefreshCw size={28} className="spin" style={{ color: "#1f624d", marginBottom: "12px", animation: "spin 1.5s linear infinite" }} />
                  <div style={{ fontSize: "14px", fontWeight: 650, color: "#1f624d", marginBottom: "4px" }}>Đang ghi đè tệp ứng dụng...</div>
                  <div style={{ fontSize: "12px", color: "#8c8273" }}>Quá trình tự cập nhật đang được áp dụng.</div>
                </div>
              )}

              {status === "completed" && (
                <div
                  style={{
                    display: "flex",
                    gap: "14px",
                    background: "#f4faf7",
                    border: "1px solid #cce8e1",
                    borderRadius: "8px",
                    padding: "16px 20px",
                    alignItems: "flex-start"
                  }}
                >
                  <CheckCircle size={24} style={{ color: "#2e7d32", flexShrink: 0, marginTop: "2px" }} />
                  <div style={{ flex: 1 }}>
                    <strong style={{ display: "block", color: "#1f624d", fontSize: "14px", marginBottom: "4px" }}>
                      Cập nhật thành công!
                    </strong>
                    <span style={{ fontSize: "13px", color: "#3f493f", lineHeight: "1.4" }}>
                      Tệp ứng dụng đã được thay thế bằng phiên bản mới <strong>v{updateInfo.latestVersion}</strong>.
                      Bạn có thể khởi động lại ứng dụng ngay bây giờ để áp dụng các thay đổi.
                    </span>
                    <div style={{ marginTop: "14px" }}>
                      <button
                        type="button"
                        onClick={handleRestart}
                        disabled={isRestarting}
                        style={{
                          background: "#1f624d",
                          color: "#fff",
                          border: "none",
                          padding: "8px 16px",
                          borderRadius: "6px",
                          cursor: "pointer",
                          fontWeight: 600,
                          fontSize: "12px",
                          transition: "background 0.2s"
                        }}
                      >
                        {isRestarting ? "Đang khởi động lại..." : "Khởi động lại ngay"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {status === "error" && (
                <div
                  style={{
                    display: "flex",
                    gap: "14px",
                    background: "#fdf3f2",
                    border: "1px solid #f8d7da",
                    borderRadius: "8px",
                    padding: "16px 20px",
                    alignItems: "flex-start"
                  }}
                >
                  <AlertTriangle size={24} style={{ color: "#d32f2f", flexShrink: 0, marginTop: "2px" }} />
                  <div>
                    <strong style={{ display: "block", color: "#d32f2f", fontSize: "14px", marginBottom: "4px" }}>
                      Lỗi cập nhật
                    </strong>
                    <span style={{ fontSize: "13px", color: "#721c24", lineHeight: "1.4", fontFamily: "var(--font-mono, monospace)" }}>
                      {errorMsg}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <footer
          className="modalFooter"
          style={{
            padding: "16px 24px",
            borderTop: "1px solid #e6dfd3",
            background: "#f6f3eb",
            display: "flex",
            justifyContent: "flex-end",
            gap: "12px",
            alignItems: "center"
          }}
        >
          {status === "idle" ? (
            <>
              <button type="button" className="smallButton" onClick={handleClose}>
                Bỏ qua
              </button>
              <button
                type="button"
                className="smallButton strong"
                onClick={handleStartUpdate}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  background: "#1f624d",
                  color: "#fff",
                  border: "none",
                  padding: "8px 16px",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: 600
                }}
              >
                <Download size={15} />
                <span>Cập nhật ngay</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              className="smallButton"
              onClick={handleClose}
              disabled={isUpdating}
              style={{ opacity: isUpdating ? 0.5 : 1 }}
            >
              Đóng
            </button>
          )}
        </footer>
      </section>
      
      {/* Keyframe animation in JSX style */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spin {
          display: inline-block;
        }
      `}</style>
    </div>
  );
}
