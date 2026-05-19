import React, { useState } from "react";
import { X, Upload, Type, Sparkles } from "lucide-react";
import type { BookAnalysis } from "../lib/types";

type Props = {
  open: boolean;
  analysis: BookAnalysis;
  onClose: () => void;
  onUpdateAnalysis: (newAnalysis: BookAnalysis) => void;
  onSetBusy: (busy: string) => void;
  onSetError: (error: string) => void;
};

const PRESET_FONTS = [
  {
    name: "Be Vietnam Pro",
    kind: "Sans-serif",
    description: "Không chân, thiết kế bởi nhóm tác giả Việt Nam; xử lý dấu tiếng Việt rất chắc, hợp cho EPUB tiếng Việt hiện đại.",
    url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/bevietnampro/BeVietnamPro-Regular.ttf"
  },
  {
    name: "Noto Sans",
    kind: "Sans-serif",
    description: "Không chân, độ phủ ngôn ngữ rất rộng, có Latin mở rộng, Cyrillic, Greek, Devanagari và tiếng Việt.",
    url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosans/NotoSans%5Bwdth,wght%5D.ttf"
  },
  {
    name: "Source Sans 3",
    kind: "Sans-serif",
    description: "Không chân kiểu humanist, chữ thoáng và trung tính; hỗ trợ Latin mở rộng, Greek, Cyrillic và tiếng Việt.",
    url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/sourcesans3/SourceSans3%5Bwght%5D.ttf"
  },
  {
    name: "IBM Plex Sans",
    kind: "Sans-serif",
    description: "Không chân, nét rõ và hơi kỹ thuật; hỗ trợ Latin mở rộng, Greek, Cyrillic và tiếng Việt.",
    url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/ibmplexsans/IBMPlexSans%5Bwdth,wght%5D.ttf"
  },
  {
    name: "Roboto",
    kind: "Sans-serif",
    description: "Không chân, quen thuộc trên Android và đọc tốt ở nhiều kích thước; có subset tiếng Việt.",
    url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/roboto/Roboto%5Bwdth,wght%5D.ttf"
  },
  {
    name: "Nunito Sans",
    kind: "Sans-serif",
    description: "Không chân bo nhẹ, thân thiện và dễ đọc; phù hợp truyện nhẹ, slice-of-life, hoặc EPUB cần cảm giác mềm hơn.",
    url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/nunitosans/NunitoSans%5BYTLC,opsz,wdth,wght%5D.ttf"
  },
  {
    name: "Inter",
    kind: "Sans-serif",
    description: "Không chân, tối ưu cho màn hình và giao diện; có Latin mở rộng và tiếng Việt, hợp đọc trên thiết bị hiện đại.",
    url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/inter/Inter%5Bopsz,wght%5D.ttf"
  },
  {
    name: "Literata",
    kind: "Serif",
    description: "Serif hiện đại, tối ưu tối đa cho việc đọc sách truyện dài tập, cực kỳ trang nhã.",
    url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/literata/Literata%5Bopsz,wght%5D.ttf"
  },
  {
    name: "Lora",
    kind: "Serif",
    description: "Serif cổ điển, các nét chữ mềm mại, bay bướm và vô cùng dễ đọc.",
    url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/lora/Lora%5Bwght%5D.ttf"
  },
  {
    name: "Merriweather",
    kind: "Serif",
    description: "Serif hình khối dày dặn, được thiết kế đặc biệt để đọc trên màn hình điện tử.",
    url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/merriweather/Merriweather%5Bopsz,wdth,wght%5D.ttf"
  },
  {
    name: "Playfair Display",
    kind: "Serif",
    description: "Nét chữ thanh đậm nghệ thuật, mang hơi hướng hoài cổ và sang trọng.",
    url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf"
  }
];

export function EmbedFontModal({ open, analysis, onClose, onUpdateAnalysis, onSetBusy, onSetError }: Props) {
  const [customFontName, setCustomFontName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [loadingFont, setLoadingFont] = useState<string | null>(null);

  if (!open) return null;

  const handleUpload = async (file: File, fontName: string) => {
    if (!file) return;

    try {
      onSetBusy("Đang nhúng phông chữ vào EPUB...");
      onSetError("");
      
      const formData = new FormData();
      formData.append("fontName", fontName.trim() || file.name.split(".")[0]);
      formData.append("file", file);

      const res = await fetch(`/api/epubs/${encodeURIComponent(analysis.id)}/fonts`, {
        method: "POST",
        body: formData
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Lỗi khi nhúng font");
      }

      const data = await res.json();
      onUpdateAnalysis(data);
      onClose();
    } catch (err: any) {
      onSetError(err.message || "Lỗi khi nhúng font");
    } finally {
      onSetBusy("");
    }
  };

  const handleEmbedPreset = async (font: typeof PRESET_FONTS[0]) => {
    try {
      setLoadingFont(font.name);
      onSetBusy(`Đang tải phông chữ ${font.name} từ Google Fonts...`);
      onSetError("");

      const fontRes = await fetch(font.url);
      if (!fontRes.ok) {
        throw new Error("Không thể tải tệp font từ máy chủ Google");
      }
      const blob = await fontRes.blob();
      const file = new File([blob], `${font.name}.ttf`, { type: "font/ttf" });
      
      await handleUpload(file, font.name);
    } catch (err: any) {
      onSetError(err.message || `Lỗi tải/nhúng font ${font.name}`);
    } finally {
      setLoadingFont(null);
      onSetBusy("");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleUpload(file, customFontName || file.name.split(".")[0]);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleUpload(file, customFontName || file.name.split(".")[0]);
    }
  };

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="fontEmbedModal"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          background: "#fbf8f3",
          border: "1px solid #e6dfd3",
          borderRadius: "12px",
          width: "560px",
          maxWidth: "90%",
          display: "flex",
          flexDirection: "column",
          maxHeight: "85vh",
          boxShadow: "0 10px 30px rgba(0,0,0,0.1)",
          overflow: "hidden"
        }}
      >
        <header
          className="modalHeader"
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid #e6dfd3",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center"
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: "16px", color: "#1f624d", fontWeight: 600 }}>
              Nhúng Phông Chữ Tiếng Việt
            </h3>
            <p style={{ margin: "2px 0 0 0", fontSize: "12px", color: "#8c8273" }}>
              {analysis.fileName}
            </p>
          </div>
          <button
            className="iconButton"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#8c8273",
              padding: "4px",
              borderRadius: "4px",
              display: "flex"
            }}
          >
            <X size={18} />
          </button>
        </header>

        <div
          className="modalContent"
          style={{
            padding: "20px",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "20px"
          }}
        >
          {}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <h4 style={{ margin: 0, fontSize: "13px", color: "#2f7d69", display: "flex", alignItems: "center", gap: "6px" }}>
              <Type size={14} />
              <span>Hoặc tải lên Phông chữ tùy chỉnh của bạn</span>
            </h4>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontSize: "12px", color: "#6e6658", fontWeight: 500 }}>Tên phông chữ (Không bắt buộc)</span>
                <input
                  type="text"
                  placeholder="Ví dụ: Bookerly, Times New Roman..."
                  value={customFontName}
                  onChange={(e) => setCustomFontName(e.target.value)}
                  style={{
                    padding: "8px 12px",
                    border: "1px solid #e9e5dd",
                    borderRadius: "6px",
                    fontSize: "13px",
                    background: "#ffffff",
                    outline: "none"
                  }}
                />
              </label>

              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                style={{
                  border: dragOver ? "2px dashed #2f7d69" : "2px dashed #d1c9bd",
                  borderRadius: "8px",
                  background: dragOver ? "#e9f6f0" : "#ffffff",
                  padding: "24px",
                  textAlign: "center",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "8px",
                  transition: "all 0.2s"
                }}
                onClick={() => document.getElementById("custom-font-file")?.click()}
              >
                <Upload size={24} style={{ color: "#a69e90" }} />
                <div>
                  <span style={{ fontSize: "13px", color: "#1f624d", fontWeight: 600 }}>Kéo thả tệp Font</span>{" "}
                  <span style={{ fontSize: "13px", color: "#8c8273" }}>hoặc click để chọn tệp tin từ máy tính</span>
                </div>
                <span style={{ fontSize: "11px", color: "#a69e90" }}>Hỗ trợ các định dạng .ttf hoặc .otf (Tối đa 20MB)</span>
                <input
                  type="file"
                  id="custom-font-file"
                  accept=".ttf,.otf"
                  onChange={handleFileChange}
                  style={{ display: "none" }}
                />
              </div>
            </div>
          </div>

          <div style={{ borderTop: "1px solid #e6dfd3", margin: "5px 0" }}></div>

          {}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <h4 style={{ margin: 0, fontSize: "13px", color: "#2f7d69", display: "flex", alignItems: "center", gap: "6px" }}>
              <Sparkles size={14} />
              <span>Phông chữ đề xuất (Cài đặt chỉ với 1-Click)</span>
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {PRESET_FONTS.map((font) => (
                <div
                  key={font.name}
                  style={{
                    background: "#ffffff",
                    border: "1px solid #e9e5dd",
                    borderRadius: "8px",
                    padding: "12px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "12px",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.02)"
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
                      <span style={{ fontSize: "14px", fontWeight: 600, color: "#1f624d" }}>{font.name}</span>
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 700,
                          color: font.kind === "Sans-serif" ? "#1f624d" : "#7a5d2f",
                          background: font.kind === "Sans-serif" ? "#e9f6f0" : "#f8efe0",
                          border: font.kind === "Sans-serif" ? "1px solid #b8d9cd" : "1px solid #e5cfaa",
                          borderRadius: "999px",
                          padding: "2px 7px",
                          whiteSpace: "nowrap"
                        }}
                      >
                        {font.kind}
                      </span>
                    </div>
                    <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#6e6658", lineHeight: "1.4" }}>
                      {font.description}
                    </p>
                  </div>
                  <button
                    className="smallButton strong"
                    onClick={() => handleEmbedPreset(font)}
                    disabled={Boolean(loadingFont)}
                    style={{
                      whiteSpace: "nowrap",
                      padding: "6px 12px",
                      fontSize: "12px",
                      background: "#2f7d69",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontWeight: 500
                    }}
                  >
                    {loadingFont === font.name ? "Đang tải..." : "Nhúng ngay"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <footer
          className="modalFooter"
          style={{
            padding: "12px 20px",
            borderTop: "1px solid #e6dfd3",
            background: "#fbf8f3",
            display: "flex",
            justifyContent: "flex-end",
            gap: "10px"
          }}
        >
          <button
            className="smallButton"
            onClick={onClose}
            style={{
              padding: "6px 16px",
              border: "1px solid #d1c9bd",
              borderRadius: "6px",
              background: "#ffffff",
              cursor: "pointer",
              fontSize: "12px",
              color: "#6e6658"
            }}
          >
            Đóng
          </button>
        </footer>
      </section>
    </div>
  );
}
