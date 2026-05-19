import React, { useState } from "react";
import { X, FileText, Upload } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  onImportSuccess: (newFileName: string) => Promise<void>;
  onSetBusy: (busy: string) => void;
  onSetError: (error: string) => void;
};

const PATTERN_PRESETS = [
  {
    label: "Tiêu chuẩn (Chương/Quyển/Tập/Chapter/Tiết)",
    value: "(?i)^\\s*(Chương\\s+\\d+|Quyển\\s+\\d+|Tập\\s+\\d+|Chapter\\s+\\d+|Tiết\\s+\\d+)"
  },
  {
    label: "Chỉ nhận dạng Chương (Chương X)",
    value: "(?i)^\\s*(Chương\\s+\\d+)"
  },
  {
    label: "Chỉ nhận dạng Quyển/Tập (Quyển/Tập X)",
    value: "(?i)^\\s*(Quyển\\s+\\d+|Tập\\s+\\d+)"
  },
  {
    label: "Dạng số đơn thuần (1, 2, 3...)",
    value: "^\\s*\\d+\\s*$"
  }
];

export function ImportTxtModal({
  open,
  onClose,
  onImportSuccess,
  onSetBusy,
  onSetError
}: Props) {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [regexPattern, setRegexPattern] = useState(PATTERN_PRESETS[0].value);
  const [content, setContent] = useState("");
  const [fileNameUploaded, setFileNameUploaded] = useState("");

  if (!open) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileNameUploaded(file.name);
    
    
    const nameWithoutExt = file.name.replace(/\.txt$/i, "");
    
    if (nameWithoutExt.includes(" - ")) {
      const parts = nameWithoutExt.split(" - ");
      setTitle(parts[0].trim());
      setAuthor(parts[1].trim());
    } else {
      setTitle(nameWithoutExt.trim());
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result;
      if (typeof text === "string") {
        setContent(text);
      }
    };
    reader.readAsText(file, "UTF-8");
  };

  const handleImport = async () => {
    if (!title.trim()) {
      alert("Vui lòng nhập tiêu đề sách.");
      return;
    }
    if (!content.trim()) {
      alert("Nội dung truyện không được để trống.");
      return;
    }

    try {
      onSetBusy("Đang phân tích text và tạo sách EPUB...");
      onSetError("");
      const res = await fetch("/api/epubs/import-txt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          author: author.trim(),
          regexPattern: regexPattern.trim(),
          content: content
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Lỗi khi nhập truyện từ file thô");
      }

      const data = await res.json();
      onClose();
      
      setTitle("");
      setAuthor("");
      setContent("");
      setFileNameUploaded("");
      await onImportSuccess(data.fileName);
    } catch (err: any) {
      onSetError(err.message || "Lỗi khi nhập truyện từ file thô");
    } finally {
      onSetBusy("");
    }
  };

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="metadataModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-txt-title"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: "min(680px, 100%)", maxHeight: "90vh", display: "flex", flexDirection: "column" }}
      >
        <header className="modalHeader">
          <div>
            <h3 id="import-txt-title">Nhập truyện từ file Text thô (.txt)</h3>
            <p>Tự động phân chia chương bằng Regex, tạo mục lục chuẩn và đóng gói thành file EPUB</p>
          </div>
          <button className="iconButton" onClick={onClose} title="Đóng">
            <X size={18} />
          </button>
        </header>

        <div className="mergeBody" style={{ overflowY: "auto", flex: 1, padding: "16px", display: "flex", flexDirection: "column", gap: "14px" }}>
          {}
          <div 
            style={{ 
              border: "2px dashed #c9c6bd", 
              padding: "18px", 
              borderRadius: "8px", 
              textAlign: "center", 
              background: "#fcfbfa", 
              cursor: "pointer", 
              transition: "all 0.15s ease" 
            }}
            onClick={() => document.getElementById("txt-file-input")?.click()}
          >
            <input
              type="file"
              accept=".txt"
              id="txt-file-input"
              onChange={handleFileChange}
              style={{ display: "none" }}
            />
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
              <Upload size={24} style={{ color: "#28705f" }} />
              <span style={{ fontSize: "13px", fontWeight: "600", color: "#1f624d" }}>
                {fileNameUploaded ? `Đã chọn: ${fileNameUploaded}` : "Nhấn để tải lên file .txt truyện"}
              </span>
              <span style={{ fontSize: "11px", color: "#687168" }}>
                Hỗ trợ tệp text thô định dạng UTF-8
              </span>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div className="field">
              <span>Tiêu đề sách:</span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Nhập tiêu đề truyện..."
              />
            </div>
            <div className="field">
              <span>Tác giả:</span>
              <input
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="Tên tác giả..."
              />
            </div>
          </div>

          <div className="field">
            <span>Mẫu nhận diện chương (Regex):</span>
            <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
              <input
                type="text"
                value={regexPattern}
                onChange={(e) => setRegexPattern(e.target.value)}
                placeholder="Mẫu regex nhận dạng đầu chương..."
                style={{ flex: 1, margin: 0 }}
              />
              <select
                onChange={(e) => setRegexPattern(e.target.value)}
                value={regexPattern}
                style={{
                  height: "36px",
                  border: "1px solid #c9c6bd",
                  borderRadius: "6px",
                  background: "#fff",
                  padding: "0 8px",
                  fontSize: "12px",
                  color: "#17201c",
                  outline: "none"
                }}
              >
                <option value="" disabled>-- Mẫu gợi ý --</option>
                {PATTERN_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </div>
            <small style={{ fontSize: "11px", color: "#687168", display: "block", marginTop: "4px", lineHeight: "1.4" }}>
              Nhập biểu thức chính quy (Regex) để tự động quét và phân chia chương từ nội dung thô bên dưới. Mặc định nhận dạng các dòng bắt đầu bằng "Chương [Số]", "Quyển [Số]", v.v.
            </small>
          </div>

          <div className="field" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: "150px" }}>
            <span>Nội dung truyện thô:</span>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Nội dung file truyện thô sẽ được hiển thị ở đây sau khi bạn tải file .txt lên..."
              style={{
                width: "100%",
                flex: 1,
                border: "1px solid #c9c6bd",
                borderRadius: "6px",
                padding: "10px",
                fontSize: "12px",
                lineHeight: "1.5",
                fontFamily: "monospace",
                resize: "none",
                background: "white",
                color: "#17201c",
                outline: "none",
                marginTop: "4px"
              }}
            />
          </div>
        </div>

        <footer className="modalFooter" style={{ borderTop: "1px solid #e2dfd6", padding: "12px 16px" }}>
          <button type="button" className="smallButton" onClick={onClose}>
            Hủy
          </button>
          <button
            type="button"
            className="smallButton strong"
            onClick={handleImport}
            disabled={!title.trim() || !content.trim()}
          >
            <FileText size={14} />
            <span>Tạo sách EPUB</span>
          </button>
        </footer>
      </section>
    </div>
  );
}
