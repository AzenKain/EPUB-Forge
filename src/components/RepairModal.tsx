import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle, FileWarning, RefreshCw, ShieldCheck, Wrench, X } from "lucide-react";
import type { ValidationReport } from "../lib/types";

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
  report?: ValidationReport;
};

const severityColor = {
  error: "#9b1c1c",
  warning: "#9a5b00",
  info: "#35658f"
};

const manualRepairTasks = [
  {
    fixId: "BUILD_TOC_PAGE",
    title: "Xây dựng trang mục lục",
    description: "Tạo hoặc dựng lại trang TOC hiển thị trong spine từ danh sách chương hiện tại."
  },
  {
    fixId: "BUILD_COVER_PAGE",
    title: "Xây dựng trang cover",
    description: "Tạo hoặc dựng lại trang bìa XHTML từ ảnh cover có trong EPUB và đưa lên đầu spine."
  },
  {
    fixId: "BUILD_CHAPTER_TITLES",
    title: "Xây dựng lại tiêu đề chương",
    description: "Tự động bổ sung thẻ tiêu đề (h2) hiển thị ở đầu mỗi chương nếu file chưa có tiêu đề."
  }
];

export function RepairModal({ open, bookId, bookTitle, onClose, onSuccess }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [selectedFixes, setSelectedFixes] = useState<string[]>([]);
  const [result, setResult] = useState<RepairResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setError("");
    setReport(null);
    setSelectedFixes([]);
    setResult(null);
    void handleValidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bookId]);

  const fixableIssues = useMemo(() => report?.issues.filter((issue) => issue.fixable && issue.fixId) || [], [report]);
  const selectedSet = useMemo(() => new Set(selectedFixes), [selectedFixes]);

  if (!open) return null;

  async function handleValidate() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/epubs/${encodeURIComponent(bookId)}/validate`, { method: "POST" });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Không thể kiểm tra EPUB");
      }
      const data = (await res.json()) as ValidationReport;
      setReport(data);
      setSelectedFixes([]);
      setResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleRepair() {
    if (selectedFixes.length === 0) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch(`/api/epubs/${encodeURIComponent(bookId)}/repair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fixes: selectedFixes })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Không thể sửa EPUB");
      }
      const data = (await res.json()) as RepairResult;
      setResult(data);
      if (data.report) {
        setReport(data.report);
      }
      setSelectedFixes([]);
      if (data.success && data.analysis) {
        onSuccess(data.analysis);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function toggleFix(fixId: string) {
    setSelectedFixes((current) => (current.includes(fixId) ? current.filter((id) => id !== fixId) : [...current, fixId]));
  }

  function selectAllFixable() {
    setSelectedFixes(Array.from(new Set(fixableIssues.map((issue) => issue.fixId).filter(Boolean) as string[])));
  }

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="metadataModal"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
        style={{ width: "min(820px, 95vw)", maxHeight: "90vh", display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}
      >
        <header className="modalHeader" style={{ padding: "16px 20px", borderBottom: "1px solid #e6dfd3" }}>
          <div>
            <h3 style={{ margin: 0, color: "#1f624d", display: "flex", alignItems: "center", gap: "8px" }}>
              <ShieldCheck size={18} />
              <span>Kiểm tra & Sửa EPUB</span>
            </h3>
            <p style={{ margin: "2px 0 0", color: "#8c8273", fontSize: "12px" }}>{bookTitle}</p>
          </div>
          <button className="iconButton" onClick={onClose} title="Đóng">
            <X size={18} />
          </button>
        </header>

        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
          {error && (
            <div className="error" style={{ marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          )}

          {loading && !report ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "180px", color: "#1f624d", fontWeight: 600 }}>
              Đang kiểm tra EPUB...
            </div>
          ) : null}

          {report ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "10px" }}>
                <Metric label="Status" value={report.valid ? "Valid" : "Invalid"} tone={report.valid ? "#1f624d" : "#9b1c1c"} />
                <Metric label="Errors" value={String(report.errors)} tone="#9b1c1c" />
                <Metric label="Warnings" value={String(report.warnings)} tone="#9a5b00" />
                <Metric label="Info" value={String(report.infos)} tone="#35658f" />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", color: report.valid ? "#1f624d" : "#8f2c18", fontWeight: 650 }}>
                  {report.valid ? <CheckCircle size={20} /> : <AlertTriangle size={20} />}
                  <span>{report.valid ? "Không có validation error." : "Có lỗi cần xem lại."}</span>
                </div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <button type="button" className="smallButton" onClick={handleValidate} disabled={loading}>
                    <RefreshCw size={15} />
                    <span>Kiểm tra lại</span>
                  </button>
                  {fixableIssues.length > 0 ? (
                    <button type="button" className="smallButton" onClick={selectAllFixable} disabled={loading}>
                      <span>Chọn tất cả có thể sửa</span>
                    </button>
                  ) : null}
                </div>
              </div>

              <div style={{ border: "1px solid #d7e7df", borderRadius: "8px", background: "#f8fcfa", padding: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ color: "#1f624d", fontWeight: 700, fontSize: "13px" }}>Tác vụ dựng lại thủ công</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px" }}>
                  {manualRepairTasks.map((task) => {
                    const checked = selectedSet.has(task.fixId);
                    return (
                      <label
                        key={task.fixId}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "22px minmax(0, 1fr)",
                          gap: "8px",
                          alignItems: "start",
                          border: "1px solid #dcece5",
                          borderRadius: "7px",
                          background: checked ? "#e9f6f0" : "#fff",
                          padding: "10px",
                          cursor: loading ? "not-allowed" : "pointer"
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={loading}
                          onChange={() => toggleFix(task.fixId)}
                          style={{ marginTop: "2px" }}
                        />
                        <span style={{ minWidth: 0 }}>
                          <strong style={{ display: "block", color: "#26352f", fontSize: "12px", marginBottom: "3px" }}>{task.title}</strong>
                          <span style={{ display: "block", color: "#687168", fontSize: "11px", lineHeight: 1.4 }}>{task.description}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div style={{ border: "1px solid #e6dfd3", borderRadius: "8px", overflow: "hidden", background: "#fff" }}>
                {report.issues.length === 0 ? (
                  <div style={{ padding: "16px", color: "#6f675c", fontSize: "13px" }}>Không có issue.</div>
                ) : (
                  report.issues.map((issue, index) => {
                    const checked = Boolean(issue.fixId && selectedSet.has(issue.fixId));
                    return (
                      <label
                        key={`${issue.code}-${issue.file || "book"}-${index}`}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "28px 92px minmax(0, 1fr)",
                          gap: "10px 12px",
                          padding: "10px 12px",
                          borderTop: index === 0 ? "none" : "1px solid #eee7dc",
                          fontSize: "12px",
                          alignItems: "start",
                          cursor: issue.fixable ? "pointer" : "default",
                          background: checked ? "#f4faf7" : "#fff"
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!issue.fixable || !issue.fixId || loading}
                          onChange={() => issue.fixId && toggleFix(issue.fixId)}
                          style={{ marginTop: "2px" }}
                        />
                        <strong style={{ color: severityColor[issue.severity] }}>{issue.severity.toUpperCase()}</strong>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", alignItems: "center", marginBottom: "4px", minWidth: 0 }}>
                            <code style={{ color: "#544f45", whiteSpace: "normal", overflowWrap: "anywhere", lineHeight: 1.35 }}>{issue.code}</code>
                            {issue.file ? (
                              <span style={{ color: "#6f675c", wordBreak: "break-all", display: "inline-flex", gap: "5px", alignItems: "center", minWidth: 0 }}>
                                <FileWarning size={13} style={{ flex: "0 0 auto" }} />
                                <span style={{ minWidth: 0 }}>{issue.file}</span>
                              </span>
                            ) : null}
                          </div>
                          <div style={{ color: "#27231e", lineHeight: 1.4, overflowWrap: "anywhere" }}>{issue.message}</div>
                          {issue.fixable ? (
                            <div style={{ color: "#1f624d", marginTop: "4px", fontSize: "11px" }}>Có thể sửa: {issue.fixId}</div>
                          ) : null}
                        </div>
                      </label>
                    );
                  })
                )}
              </div>

              {result ? (
                <div style={{ border: "1px solid #cce8e1", borderRadius: "8px", background: "#f6fbf8", padding: "12px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#1f624d", fontWeight: 650, marginBottom: "8px" }}>
                    <Wrench size={18} />
                    <span>Kết quả sửa</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "5px", fontSize: "12px", fontFamily: "monospace", color: "#3f493f" }}>
                    {result.logs.map((log, index) => (
                      <div key={index} style={{ wordBreak: "break-word" }}>
                        - {log}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <footer className="modalFooter" style={{ padding: "12px 20px", borderTop: "1px solid #e6dfd3", background: "#f3eedf", display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "center" }}>
          <span style={{ fontSize: "12px", color: "#8c8273" }}>
            {selectedFixes.length > 0 ? `${selectedFixes.length} nhóm sửa đã chọn` : "Chưa chọn mục sửa"}
          </span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button type="button" className="smallButton" onClick={onClose}>
              Đóng
            </button>
            <button type="button" className="smallButton strong" onClick={handleRepair} disabled={loading || selectedFixes.length === 0}>
              <Wrench size={15} />
              <span>Sửa mục đã chọn</span>
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div style={{ border: "1px solid #e6dfd3", borderRadius: "8px", padding: "10px 12px", background: "#fff" }}>
      <div style={{ color: "#8c8273", fontSize: "11px", marginBottom: "4px" }}>{label}</div>
      <div style={{ color: tone, fontWeight: 700, fontSize: "18px" }}>{value}</div>
    </div>
  );
}
