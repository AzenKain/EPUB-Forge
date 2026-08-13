import React, { useState, useRef, useEffect } from "react";
import { Eye, Edit2, Maximize2, X, Smartphone, Tablet, Monitor, BookOpen, ZoomIn, ZoomOut, AlignJustify, AlignLeft } from "lucide-react";
import type { Chapter } from "../lib/types";
import { EditChapterModal } from "./EditChapterModal";

type Props = {
  bookId: string;
  chapters: Chapter[];
  previewIndex: number;
  previewUrl: string;
  onUpdateAnalysis: (newAnalysis: any) => void;
  onSetBusy: (busy: string) => void;
  onSetError: (error: string) => void;
  onSaveSuccess: () => void;
};

type DeviceType = "free" | "kindle" | "mobile" | "tablet";
type ThemeType = "kem" | "dark" | "sepia";

export function PreviewPanel({
  bookId,
  chapters,
  previewIndex,
  previewUrl,
  onUpdateAnalysis,
  onSetBusy,
  onSetError,
  onSaveSuccess
}: Props) {
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isZoomOpen, setIsZoomOpen] = useState(false);
  
  
  const [device, setDevice] = useState<DeviceType>("free");
  const [theme, setTheme] = useState<ThemeType>("kem");
  const [fontSize, setFontSize] = useState<number>(115);
  const [lineHeight, setLineHeight] = useState<number>(1.7);
  const [textJustify, setTextJustify] = useState<boolean>(true);

  const currentChapter = chapters.find((chapter) => chapter.index === previewIndex);
  const activeTitle = currentChapter?.title || "Chương";

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const zoomIframeRef = useRef<HTMLIFrameElement>(null);

  const applyStylesToIframe = (iframe: HTMLIFrameElement | null) => {
    if (!iframe || !iframe.contentDocument) return;

    let styleEl = iframe.contentDocument.getElementById("epubforge-simulator-style");
    if (!styleEl) {
      styleEl = iframe.contentDocument.createElement("style");
      styleEl.id = "epubforge-simulator-style";
      iframe.contentDocument.head.appendChild(styleEl);
    }

    let bodyBg = "#fcfaf2";
    let bodyColor = "#2b2a27";
    if (theme === "dark") {
      bodyBg = "#1a1a1a";
      bodyColor = "#e0e0e0";
    } else if (theme === "sepia") {
      bodyBg = "#f7f1e3";
      bodyColor = "#4d3a2b";
    }

    const justifyStyle = textJustify ? "text-align: justify !important;" : "text-align: left !important;";

    styleEl.textContent = `
      body {
        background-color: ${bodyBg} !important;
        color: ${bodyColor} !important;
        font-size: ${fontSize}% !important;
        line-height: ${lineHeight} !important;
        padding: 24px 32px !important;
        font-family: inherit;
        transition: background-color 0.2s, color 0.2s;
      }
      body * {
        max-width: 100% !important;
        box-sizing: border-box !important;
      }
      img, svg, image {
        max-width: 100% !important;
        height: auto !important;
        object-fit: contain !important;
        display: block !important;
        margin: 8px auto !important;
      }
      p {
        ${justifyStyle}
      }
      /* Beautiful custom scrollbars inside iframe */
      ::-webkit-scrollbar {
        width: 6px;
        height: 6px;
      }
      ::-webkit-scrollbar-track {
        background: ${bodyBg};
      }
      ::-webkit-scrollbar-thumb {
        background: #c6beb0;
        border-radius: 3px;
      }
    `;
  };

  useEffect(() => {
    applyStylesToIframe(iframeRef.current);
  }, [theme, fontSize, lineHeight, textJustify, previewUrl, device]);

  useEffect(() => {
    if (isZoomOpen) {
      
      setTimeout(() => {
        applyStylesToIframe(zoomIframeRef.current);
      }, 100);
    }
  }, [isZoomOpen, theme, fontSize, lineHeight, textJustify, previewUrl, device]);

  const deviceButton = (target: DeviceType, label: string, icon: React.ReactNode, title: string) => (
    <button
      onClick={() => setDevice(target)}
      title={title}
      style={{
        padding: "4px 8px",
        background: device === target ? "#2f7d69" : "transparent",
        color: device === target ? "#ffffff" : "#6e6658",
        border: "none",
        borderRadius: "4px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: "4px",
        fontSize: "11px",
        fontWeight: 500
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  const renderSimulatorControls = () => (
    <div
      className="simulator-toolbar"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 12px",
        background: "#f3eedf",
        borderBottom: "1px solid #e6dfd3",
        gap: "8px",
        flexWrap: "wrap"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
        {deviceButton("free", "Tự do", <Monitor size={12} />, "Tự do")}
        {deviceButton("kindle", "Kindle", <BookOpen size={12} />, "Giả lập Kindle Paperwhite")}
        {deviceButton("mobile", "Mobile", <Smartphone size={12} />, "Giả lập Smartphone")}
        {deviceButton("tablet", "Tablet", <Tablet size={12} />, "Giả lập Tablet / iPad")}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <button
            onClick={() => setTheme("kem")}
            title="Chủ đề Sáng"
            style={{
              width: "18px",
              height: "18px",
              borderRadius: "50%",
              background: "#fcfaf2",
              border: theme === "kem" ? "2px solid #2f7d69" : "1px solid #c6beb0",
              cursor: "pointer"
            }}
          />
          <button
            onClick={() => setTheme("sepia")}
            title="Chủ đề Sepia Cổ điển"
            style={{
              width: "18px",
              height: "18px",
              borderRadius: "50%",
              background: "#f7f1e3",
              border: theme === "sepia" ? "2px solid #2f7d69" : "1px solid #c6beb0",
              cursor: "pointer"
            }}
          />
          <button
            onClick={() => setTheme("dark")}
            title="Chủ đề Tối"
            style={{
              width: "18px",
              height: "18px",
              borderRadius: "50%",
              background: "#1a1a1a",
              border: theme === "dark" ? "2px solid #2f7d69" : "1px solid #c6beb0",
              cursor: "pointer"
            }}
          />
        </div>

        <button
          onClick={() => setTextJustify(!textJustify)}
          title={textJustify ? "Căn đều 2 bên" : "Căn lề trái"}
          style={{
            padding: "4px",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "#6e6658",
            display: "flex"
          }}
        >
          {textJustify ? <AlignJustify size={14} /> : <AlignLeft size={14} />}
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: "2px", background: "#ffffff", borderRadius: "4px", border: "1px solid #e6dfd3", padding: "1px" }}>
          <button
            onClick={() => setFontSize(Math.max(80, fontSize - 5))}
            style={{ padding: "2px 4px", border: "none", background: "none", cursor: "pointer", display: "flex" }}
            title="Giảm cỡ chữ"
          >
            <ZoomOut size={11} />
          </button>
          <span style={{ fontSize: "10px", minWidth: "28px", textAlign: "center", color: "#6e6658", fontWeight: 500 }}>
            {fontSize}%
          </span>
          <button
            onClick={() => setFontSize(Math.min(200, fontSize + 5))}
            style={{ padding: "2px 4px", border: "none", background: "none", cursor: "pointer", display: "flex" }}
            title="Tăng cỡ chữ"
          >
            <ZoomIn size={11} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <section className="panel previewPanel" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {}
      <style dangerouslySetInnerHTML={{ __html: `
        .device-kindle {
          width: 320px;
          height: 440px;
          background: #2a2a2a;
          border-radius: 18px;
          padding: 24px 12px 36px 12px;
          box-shadow: 0 8px 30px rgba(0,0,0,0.12);
          display: flex;
          justify-content: center;
          align-items: center;
          position: relative;
          margin: 12px auto;
          border: 1px solid #3d3d3d;
        }
        .device-kindle::after {
          content: "Kindle";
          position: absolute;
          bottom: 10px;
          color: #777777;
          font-size: 8px;
          font-family: system-ui, sans-serif;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          font-weight: 600;
        }
        .device-kindle iframe {
          width: 100% !important;
          height: 100% !important;
          border: none !important;
          background: #fcfaf2;
          border-radius: 3px;
        }

        .device-mobile {
          width: 260px;
          height: 480px;
          background: #111111;
          border-radius: 30px;
          padding: 10px;
          box-shadow: 0 8px 30px rgba(0,0,0,0.12);
          display: flex;
          justify-content: center;
          align-items: center;
          position: relative;
          margin: 12px auto;
          border: 1px solid #222222;
        }
        .device-mobile::before {
          content: "";
          position: absolute;
          top: 4px;
          width: 60px;
          height: 12px;
          background: #111111;
          border-radius: 6px;
          z-index: 10;
        }
        .device-mobile iframe {
          width: 100% !important;
          height: 100% !important;
          border: none !important;
          border-radius: 22px;
          background: #fcfaf2;
        }

        .device-tablet {
          width: 440px;
          height: 460px;
          background: #1c1c1c;
          border-radius: 16px;
          padding: 16px;
          box-shadow: 0 8px 30px rgba(0,0,0,0.12);
          display: flex;
          justify-content: center;
          align-items: center;
          position: relative;
          margin: 12px auto;
          border: 1px solid #333333;
        }
        .device-tablet iframe {
          width: 100% !important;
          height: 100% !important;
          border: none !important;
          border-radius: 6px;
          background: #fcfaf2;
        }

        .device-free {
          width: 100%;
          height: 100%;
          flex: 1;
        }
        .device-free iframe {
          width: 100% !important;
          height: 100% !important;
          border: none !important;
        }
      `}} />

      <div className="panelHeader">
        <h3 style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Eye size={17} />
          <span>Preview</span>
          {currentChapter && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginLeft: "8px" }}>
              <button
                className="smallButton"
                onClick={() => setIsEditOpen(true)}
                title="Chỉnh sửa nội dung chương này"
                style={{ height: "24px", minHeight: "24px", padding: "0 8px", fontSize: "11px", gap: "4px" }}
              >
                <Edit2 size={10} />
                <span>Sửa chương</span>
              </button>
              <button
                className="smallButton strong"
                onClick={() => setIsZoomOpen(true)}
                title="Đọc toàn màn hình / Xem phóng to"
                style={{ height: "24px", minHeight: "24px", padding: "0 8px", fontSize: "11px", gap: "4px" }}
              >
                <Maximize2 size={10} />
                <span>Phóng to</span>
              </button>
            </div>
          )}
        </h3>
        <span>{currentChapter?.href || chapters[0]?.href || ""}</span>
      </div>

      {}
      <div
        className="simulator-toolbar"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          background: "#f3eedf",
          borderBottom: "1px solid #e6dfd3",
          gap: "8px",
          flexWrap: "wrap"
        }}
      >
        {}
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <button
            onClick={() => setDevice("free")}
            title="Tự do"
            style={{
              padding: "4px 8px",
              background: device === "free" ? "#2f7d69" : "transparent",
              color: device === "free" ? "#ffffff" : "#6e6658",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "11px",
              fontWeight: 500
            }}
          >
            <Monitor size={12} />
            <span>Tự do</span>
          </button>
          <button
            onClick={() => setDevice("kindle")}
            title="Giả lập Kindle Paperwhite"
            style={{
              padding: "4px 8px",
              background: device === "kindle" ? "#2f7d69" : "transparent",
              color: device === "kindle" ? "#ffffff" : "#6e6658",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "11px",
              fontWeight: 500
            }}
          >
            <BookOpen size={12} />
            <span>Kindle</span>
          </button>
          <button
            onClick={() => setDevice("mobile")}
            title="Giả lập Smartphone"
            style={{
              padding: "4px 8px",
              background: device === "mobile" ? "#2f7d69" : "transparent",
              color: device === "mobile" ? "#ffffff" : "#6e6658",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "11px",
              fontWeight: 500
            }}
          >
            <Smartphone size={12} />
            <span>Mobile</span>
          </button>
          <button
            onClick={() => setDevice("tablet")}
            title="Giả lập Tablet / iPad"
            style={{
              padding: "4px 8px",
              background: device === "tablet" ? "#2f7d69" : "transparent",
              color: device === "tablet" ? "#ffffff" : "#6e6658",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "11px",
              fontWeight: 500
            }}
          >
            <Tablet size={12} />
            <span>Tablet</span>
          </button>
        </div>

        {}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {}
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <button
              onClick={() => setTheme("kem")}
              title="Chủ đề Sáng"
              style={{
                width: "18px",
                height: "18px",
                borderRadius: "50%",
                background: "#fcfaf2",
                border: theme === "kem" ? "2px solid #2f7d69" : "1px solid #c6beb0",
                cursor: "pointer"
              }}
            />
            <button
              onClick={() => setTheme("sepia")}
              title="Chủ đề Sepia Cổ điển"
              style={{
                width: "18px",
                height: "18px",
                borderRadius: "50%",
                background: "#f7f1e3",
                border: theme === "sepia" ? "2px solid #2f7d69" : "1px solid #c6beb0",
                cursor: "pointer"
              }}
            />
            <button
              onClick={() => setTheme("dark")}
              title="Chủ đề Tối"
              style={{
                width: "18px",
                height: "18px",
                borderRadius: "50%",
                background: "#1a1a1a",
                border: theme === "dark" ? "2px solid #2f7d69" : "1px solid #c6beb0",
                cursor: "pointer"
              }}
            />
          </div>

          {}
          <button
            onClick={() => setTextJustify(!textJustify)}
            title={textJustify ? "Căn đều 2 bên" : "Căn lề trái"}
            style={{
              padding: "4px",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "#6e6658",
              display: "flex"
            }}
          >
            {textJustify ? <AlignJustify size={14} /> : <AlignLeft size={14} />}
          </button>

          {}
          <div style={{ display: "flex", alignItems: "center", gap: "2px", background: "#ffffff", borderRadius: "4px", border: "1px solid #e6dfd3", padding: "1px" }}>
            <button
              onClick={() => setFontSize(Math.max(80, fontSize - 5))}
              style={{ padding: "2px 4px", border: "none", background: "none", cursor: "pointer", display: "flex" }}
              title="Giảm cỡ chữ"
            >
              <ZoomOut size={11} />
            </button>
            <span style={{ fontSize: "10px", minWidth: "28px", textAlign: "center", color: "#6e6658", fontWeight: 500 }}>
              {fontSize}%
            </span>
            <button
              onClick={() => setFontSize(Math.min(200, fontSize + 5))}
              style={{ padding: "2px 4px", border: "none", background: "none", cursor: "pointer", display: "flex" }}
              title="Tăng cỡ chữ"
            >
              <ZoomIn size={11} />
            </button>
          </div>
        </div>
      </div>

      {}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          background: theme === "dark" ? "#121212" : theme === "sepia" ? "#efe8d4" : "#f5f2e9",
          padding: device === "free" ? 0 : "8px",
          display: "flex",
          flexDirection: "column",
          justifyContent: device === "free" ? "stretch" : "center",
          alignItems: "center"
        }}
      >
        <div className={`device-${device}`} style={{ display: "flex", flex: 1, width: device === "free" ? "100%" : undefined }}>
          <iframe
            ref={iframeRef}
            title="Chapter preview"
            src={previewUrl}
            sandbox="allow-same-origin allow-scripts"
            onLoad={() => applyStylesToIframe(iframeRef.current)}
            style={{ width: "100%", height: "100%", border: "none" }}
          />
        </div>
      </div>

      {currentChapter && (
        <EditChapterModal
          open={isEditOpen}
          bookId={bookId}
          chapterIndex={previewIndex}
          chapterTitle={activeTitle}
          chapterPath={currentChapter.path}
          onClose={() => setIsEditOpen(false)}
          onUpdateAnalysis={onUpdateAnalysis}
          onSetBusy={onSetBusy}
          onSetError={onSetError}
          onSaveSuccess={onSaveSuccess}
        />
      )}

      {isZoomOpen && (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => setIsZoomOpen(false)}>
          <section
            className="metadataModal"
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              width: "min(1360px, 96vw)",
              height: "95vh",
              display: "flex",
              flexDirection: "column",
              padding: 0,
              overflow: "hidden",
              background: "#fbf8f3",
              border: "1px solid #e6dfd3"
            }}
          >
            <header className="modalHeader" style={{ padding: "14px 20px", borderBottom: "1px solid #e6dfd3" }}>
              <div>
                <h3 style={{ margin: 0, color: "#1f624d" }}>Phóng to: {activeTitle}</h3>
                <p style={{ margin: "2px 0 0", color: "#8c8273" }}>Xem trước toàn màn hình nội dung chương truyện</p>
              </div>
              <button className="iconButton" onClick={() => setIsZoomOpen(false)} title="Đóng">
                <X size={18} />
              </button>
            </header>
            {renderSimulatorControls()}
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                background: theme === "dark" ? "#121212" : theme === "sepia" ? "#efe8d4" : "#f5f2e9",
                padding: device === "free" ? 0 : "14px",
                display: "flex",
                flexDirection: "column",
                justifyContent: device === "free" ? "stretch" : "center",
                alignItems: "center"
              }}
            >
              <div
                className={`device-${device}`}
                style={{
                  display: "flex",
                  flex: device === "free" ? 1 : "0 0 auto",
                  width: device === "free" ? "100%" : undefined,
                  maxWidth: "100%",
                  maxHeight: device === "free" ? undefined : "100%"
                }}
              >
                <iframe
                  ref={zoomIframeRef}
                  title="Enlarged Chapter Preview"
                  src={previewUrl}
                  sandbox="allow-same-origin allow-scripts"
                  onLoad={() => applyStylesToIframe(zoomIframeRef.current)}
                  style={{ width: "100%", height: "100%", border: "none" }}
                />
              </div>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
