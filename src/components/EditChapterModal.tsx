import React, { useState, useEffect, useRef } from "react";
import {
  X,
  Save,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  List,
  ListOrdered,
  Eraser,
  FileCode,
  Eye,
  Sparkles
} from "lucide-react";

type Props = {
  open: boolean;
  bookId: string;
  chapterIndex: number;
  chapterTitle: string;
  chapterPath: string;
  onClose: () => void;
  onUpdateAnalysis: (newAnalysis: any) => void;
  onSetBusy: (busy: string) => void;
  onSetError: (error: string) => void;
  onSaveSuccess: () => void;
};

interface SplitHTML {
  header: string;     
  bodyContent: string; 
  footer: string;     
}


function highlightHTML(code: string): string {
  const tokenRegex = /(<!--[\s\S]*?-->)|(<\?xml[\s\S]*?\?>|<\![a-zA-Z]+[\s\S]*?>)|(<\/?[a-zA-Z0-9:-]+(?:\s+[a-zA-Z0-9:-]+(?:=(?:["'].*?["']|[^>\s]+))?)*\s*\/?>)/g;
  
  let lastIndex = 0;
  let result = "";
  let match;
  
  while ((match = tokenRegex.exec(code)) !== null) {
    // Process plain text before the match
    const plainText = code.substring(lastIndex, match.index);
    result += escapeHtml(plainText);
    
    // Process the matched token
    const comment = match[1];
    const prolog = match[2];
    const tag = match[3];
    
    if (comment) {
      result += `<span class="hl-comment">${escapeHtml(comment)}</span>`;
    } else if (prolog) {
      result += `<span class="hl-prolog">${escapeHtml(prolog)}</span>`;
    } else if (tag) {
      // Parse tag name and attributes
      const tagMatch = tag.match(/^(<\/?[a-zA-Z0-9:-]+)(\s[\s\S]*?)?(\/?\s*>)$/);
      if (tagMatch) {
        const start = tagMatch[1];
        let attrs = tagMatch[2] || "";
        const end = tagMatch[3];
        
        if (attrs) {
          // Highlight attributes: name="value"
          attrs = attrs.replace(/(\s[a-zA-Z0-9:-]+)(=)(['"].*?['"]|[^>\s]+)/g, (m, aName, aEq, aVal) => {
            return ` <span class="hl-attr-name">${escapeHtml(aName.trim())}</span><span class="hl-punctuation">${aEq}</span><span class="hl-attr-value">${escapeHtml(aVal)}</span>`;
          });
        }
        result += `<span class="hl-tag">${escapeHtml(start)}</span>${attrs}<span class="hl-tag">${escapeHtml(end)}</span>`;
      } else {
        result += `<span class="hl-tag">${escapeHtml(tag)}</span>`;
      }
    }
    
    lastIndex = tokenRegex.lastIndex;
  }
  
  result += escapeHtml(code.substring(lastIndex));
  return result;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}


function parseChapterHTML(html: string): SplitHTML {
  const bodyStartMatch = html.match(/<body[^>]*>/i);
  const bodyEndMatch = html.match(/<\/body>/i);

  if (bodyStartMatch && bodyEndMatch) {
    const bodyStartIdx = bodyStartMatch.index! + bodyStartMatch[0].length;
    const bodyEndIdx = bodyEndMatch.index!;

    return {
      header: html.substring(0, bodyStartIdx),
      bodyContent: html.substring(bodyStartIdx, bodyEndIdx),
      footer: html.substring(bodyEndIdx)
    };
  }

  return {
    header: "<?xml version='1.0' encoding='utf-8'?>\n<html xmlns=\"http://www.w3.org/1999/xhtml\">\n<head><title>Chapter</title></head>\n<body>",
    bodyContent: html,
    footer: "</body>\n</html>"
  };
}

function resolveZipHref(baseDir: string, href: string): string {
  if (/^(https?:)?\/\//i.test(href) || href.startsWith("data:") || href.startsWith("#")) {
    return href;
  }
  const parts = baseDir ? baseDir.split('/') : [];
  const hrefParts = href.split('/');
  for (const hp of hrefParts) {
    if (hp === "." || hp === "") {
      continue;
    }
    if (hp === "..") {
      if (parts.length > 0) {
        parts.pop();
      }
    } else {
      parts.push(hp);
    }
  }
  return parts.join('/');
}

function getRelativePath(baseDir: string, resolved: string): string {
  const baseParts = baseDir ? baseDir.split('/') : [];
  const resParts = resolved.split('/');
  
  let commonLen = 0;
  const maxLen = Math.min(baseParts.length, resParts.length);
  while (commonLen < maxLen && baseParts[commonLen] === resParts[commonLen]) {
    commonLen++;
  }
  
  const upCount = baseParts.length - commonLen;
  const relParts = [];
  for (let i = 0; i < upCount; i++) {
    relParts.push('..');
  }
  
  for (let i = commonLen; i < resParts.length; i++) {
    relParts.push(resParts[i]);
  }
  
  return relParts.join('/');
}

function rewriteHTMLAssetLinks(source: string, bookId: string, baseDir: string): string {
  const re = /\s(src|href|xlink:href)\s*=\s*(['"])([^'"]+)\2/gi;
  return source.replace(re, (match, attr, quote, val) => {
    if (/^(https?:)?\/\//i.test(val) || val.startsWith("data:") || val.startsWith("#")) {
      return match;
    }
    const resolved = resolveZipHref(baseDir, val);
    return ` ${attr}=${quote}/api/epubs/${encodeURIComponent(bookId)}/assets?path=${encodeURIComponent(resolved)}${quote}`;
  });
}

function restoreHTMLAssetLinks(source: string, bookId: string, baseDir: string): string {
  const re = /\s(src|href|xlink:href)\s*=\s*(['"])\/api\/epubs\/[^/]+\/assets\?path=([^'"]+)\2/gi;
  return source.replace(re, (match, attr, quote, encodedResolved) => {
    try {
      const resolved = decodeURIComponent(encodedResolved);
      const relative = getRelativePath(baseDir, resolved);
      return ` ${attr}=${quote}${relative}${quote}`;
    } catch (e) {
      return match;
    }
  });
}

export function EditChapterModal({
  open,
  bookId,
  chapterIndex,
  chapterTitle,
  chapterPath,
  onClose,
  onUpdateAnalysis,
  onSetBusy,
  onSetError,
  onSaveSuccess
}: Props) {
  if (!open) return null;

  const baseDir = chapterPath ? chapterPath.split('/').slice(0, -1).join('/') : "";

  const [activeTab, setActiveTab] = useState<"visual" | "raw">("visual");
  const [rawContent, setRawContent] = useState("");
  const [parsedParts, setParsedParts] = useState<SplitHTML | null>(null);
  const [styleBlocks, setStyleBlocks] = useState("");
  
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  // Auto cleaner states
  const [showCleanPanel, setShowCleanPanel] = useState(false);
  const [stripStyles, setStripStyles] = useState(true);
  const [removeEmpty, setRemoveEmpty] = useState(true);
  const [normalizeParas, setNormalizeParas] = useState(true);
  const [regexFilters, setRegexFilters] = useState("");
  const [cleanSuccess, setCleanSuccess] = useState("");

  const handleCleanContent = async () => {
    let currentRaw = rawContent;
    if (activeTab === "visual" && visualEditorRef.current && parsedParts) {
      const newBodyContent = visualEditorRef.current.innerHTML;
      const restoredBodyContent = restoreHTMLAssetLinks(newBodyContent, bookId, baseDir);
      const preservedBodyContent = styleBlocks + restoredBodyContent;
      currentRaw = parsedParts.header + preservedBodyContent + parsedParts.footer;
    }

    try {
      setLoading(true);
      setCleanSuccess("");
      const filterList = regexFilters
        .split("\n")
        .map((f) => f.trim())
        .filter((f) => f !== "");

      const res = await fetch(`/api/epubs/${encodeURIComponent(bookId)}/chapters/clean`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "clean",
          index: chapterIndex,
          content: currentRaw,
          stripInlineStyles: stripStyles,
          removeEmptyLines: removeEmpty,
          normalizeParagraphs: normalizeParas,
          regexFilters: filterList
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Lỗi khi tự động dọn dẹp chương");
      }

      const data = await res.json();
      const cleaned = data.content;

      setRawContent(cleaned);
      const parts = parseChapterHTML(cleaned);
      
      const styleRegex = /<style[^>]*>[\s\S]*?<\/style>/gi;
      const matches = parts.bodyContent.match(styleRegex) || [];
      const extractedStyles = matches.join("\n");
      const cleanBody = parts.bodyContent.replace(styleRegex, "");
      
      setStyleBlocks(extractedStyles);
      setParsedParts({
        ...parts,
        bodyContent: cleanBody
      });

      if (activeTab === "visual" && visualEditorRef.current) {
        visualEditorRef.current.innerHTML = rewriteHTMLAssetLinks(cleanBody, bookId, baseDir);
      }
      
      setCleanSuccess("Dọn dẹp thành công! Xem trước thay đổi ở khung bên.");
      setTimeout(() => setCleanSuccess(""), 4000);
    } catch (err: any) {
      alert("Lỗi dọn dẹp: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const visualEditorRef = useRef<HTMLDivElement>(null);

  // Sync scroll for the syntax highlighting editor
  const handleScroll = () => {
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  // Enable literal tab character insert instead of focus skip
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;

      const newValue = rawContent.substring(0, start) + "  " + rawContent.substring(end);
      setRawContent(newValue);

      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      }, 0);
    }
  };

  // Fetch chapter data
  useEffect(() => {
    if (open && bookId) {
      setActiveTab("visual");
      setLoading(true);
      setLoadError("");
      fetch(`/api/epubs/${encodeURIComponent(bookId)}/chapters/${chapterIndex}/html?raw=true`)
        .then((res) => {
          if (!res.ok) throw new Error("Không thể tải nội dung chương");
          return res.text();
        })
        .then((text) => {
          const parts = parseChapterHTML(text);
          // Extract style tags from bodyContent to prevent them from leaking into the visual canvas
          const styleRegex = /<style[^>]*>[\s\S]*?<\/style>/gi;
          const matches = parts.bodyContent.match(styleRegex) || [];
          const extractedStyles = matches.join("\n");
          const cleanBody = parts.bodyContent.replace(styleRegex, "");
          
          setStyleBlocks(extractedStyles);
          setParsedParts({
            ...parts,
            bodyContent: cleanBody
          });
          setRawContent(text);
        })
        .catch((err: any) => {
          setLoadError(err.message || "Lỗi tải nội dung");
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [open, bookId, chapterIndex]);

  // Set visual content from parsed body content whenever activeTab becomes visual
  useEffect(() => {
    if (activeTab === "visual" && visualEditorRef.current && parsedParts) {
      // Rewrite asset paths to API urls for the visual canvas
      const rewrittenContent = rewriteHTMLAssetLinks(parsedParts.bodyContent, bookId, baseDir);
      visualEditorRef.current.innerHTML = rewrittenContent;
    }
  }, [activeTab, parsedParts]);

  // Sync the Visual Editor innerHTML back into the main raw state
  const syncVisualToRaw = () => {
    if (visualEditorRef.current && parsedParts) {
      const newBodyContent = visualEditorRef.current.innerHTML;
      // Restore asset paths back to relative ones
      const restoredBodyContent = restoreHTMLAssetLinks(newBodyContent, bookId, baseDir);
      // Prepend style blocks back to maintain exact original EPUB compatibility
      const preservedBodyContent = styleBlocks + restoredBodyContent;
      const newRaw = parsedParts.header + preservedBodyContent + parsedParts.footer;
      setRawContent(newRaw);
      setParsedParts({
        ...parsedParts,
        bodyContent: restoredBodyContent
      });
    }
  };

  // Tab switching handler with two-way syncing
  const handleTabChange = (tab: "visual" | "raw") => {
    if (tab === activeTab) return;

    if (activeTab === "visual" && tab === "raw") {
      syncVisualToRaw();
    } else if (activeTab === "raw" && tab === "visual") {
      const parts = parseChapterHTML(rawContent);
      // Strip style tags during editing but store them
      const styleRegex = /<style[^>]*>[\s\S]*?<\/style>/gi;
      const matches = parts.bodyContent.match(styleRegex) || [];
      const extractedStyles = matches.join("\n");
      const cleanBody = parts.bodyContent.replace(styleRegex, "");

      setStyleBlocks(extractedStyles);
      setParsedParts({
        ...parts,
        bodyContent: cleanBody
      });
    }
    setActiveTab(tab);
  };

  // Execute formatting command in visual editor
  const execCmd = (command: string, value: string = "") => {
    document.execCommand(command, false, value);
    visualEditorRef.current?.focus();
  };

  // Handle saving
  const handleSave = async () => {
    try {
      onSetBusy("Đang lưu nội dung chương...");
      onSetError("");

      let finalContent = rawContent;
      if (activeTab === "visual" && visualEditorRef.current && parsedParts) {
        const newBodyContent = visualEditorRef.current.innerHTML;
        // Restore asset paths back to relative ones
        const restoredBodyContent = restoreHTMLAssetLinks(newBodyContent, bookId, baseDir);
        const preservedBodyContent = styleBlocks + restoredBodyContent;
        finalContent = parsedParts.header + preservedBodyContent + parsedParts.footer;
      }

      const res = await fetch(`/api/epubs/${encodeURIComponent(bookId)}/chapters/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_content",
          index: chapterIndex,
          content: finalContent
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Lỗi khi lưu nội dung chương");
      }

      const data = await res.json();
      onUpdateAnalysis(data);
      onSaveSuccess();
      onClose();
    } catch (err: any) {
      onSetError(err.message || "Lỗi khi lưu nội dung chương");
    } finally {
      onSetBusy("");
    }
  };

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="metadataModal editChapterModal"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: "min(960px, 95vw)",
          height: "min(780px, 92dvh)",
          display: "flex",
          flexDirection: "column"
        }}
      >
        <style>{`
          .editor-tabs {
            display: flex;
            border-bottom: 1px solid #e2dfd6;
            background: #f5f3ec;
            padding: 0 14px;
            gap: 4px;
          }
          
          .editor-tab-btn {
            padding: 12px 16px;
            background: transparent;
            border: none;
            border-bottom: 3px solid transparent;
            font-size: 13px;
            font-weight: 600;
            color: #687168;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.15s ease;
          }
          
          .editor-tab-btn:hover {
            color: #17201c;
            background: rgba(0, 0, 0, 0.02);
          }
          
          .editor-tab-btn.active {
            color: #2f7d69;
            border-bottom-color: #2f7d69;
            background: #ffffff;
          }
          
          .visual-editor-container {
            display: flex;
            flex-direction: column;
            flex: 1;
            width: 100%;
            min-height: 0;
            border: 1px solid #c9c6bd;
            border-radius: 6px;
            background: #faf9f6;
          }
          
          .editor-toolbar {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            align-items: center;
            padding: 8px 12px;
            background: #f5f3ec;
            border-bottom: 1px solid #c9c6bd;
          }
          
          .editor-toolbar-separator {
            width: 1px;
            height: 20px;
            background: #d8d5cc;
            margin: 0 6px;
          }
          
          .toolbar-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 30px;
            height: 30px;
            border-radius: 4px;
            border: 1px solid transparent;
            background: transparent;
            color: #4d574f;
            cursor: pointer;
            transition: all 0.1s ease;
            padding: 0;
          }
          
          .toolbar-btn:hover {
            background: #e5e2d9;
            color: #17201c;
          }
          
          .toolbar-btn.active {
            background: #e9f6f0;
            border-color: #2f7d69;
            color: #1f624d;
          }
          
          .toolbar-block-btn {
            padding: 0 8px;
            height: 30px;
            font-size: 11px;
            font-weight: 700;
            border-radius: 4px;
            border: 1px solid #c9c6bd;
            background: white;
            color: #4d574f;
            cursor: pointer;
            transition: all 0.1s ease;
          }
          
          .toolbar-block-btn:hover {
            border-color: #2f7d69;
            background: #e9f6f0;
            color: #2f7d69;
          }
          
          .visual-editor-scrollable {
            flex: 1;
            padding: 18px;
            background: #f6f4ef;
            overflow: auto;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            min-height: 0;
          }
          
          .visual-editor-paper {
            width: 100%;
            max-width: 780px;
            background: #ffffff;
            border: 1px solid #e2dfd6;
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(23, 32, 28, 0.05);
            display: flex;
            flex-direction: column;
            min-height: calc(100% - 4px);
            box-sizing: border-box;
          }
          
          .visual-editor-content {
            flex: 1;
            width: 100%;
            min-height: 100%;
            padding: 28px 36px;
            outline: none;
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
            font-size: 15px;
            line-height: 1.85;
            color: #17201c;
            box-sizing: border-box;
          }
          
          /* Reset potential layout-breaking inline or class styles from EPUB HTML */
          .visual-editor-content div,
          .visual-editor-content .title-top,
          .visual-editor-content .col,
          .visual-editor-content .title-item,
          .visual-editor-content .title-item1,
          .visual-editor-content .title-item2 {
            position: static !important;
            height: auto !important;
            min-height: 0 !important;
            max-height: none !important;
            width: auto !important;
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
            overflow: visible !important;
            margin: 0 !important;
            padding: 0 !important;
            inset: auto !important;
            transform: none !important;
          }
          
          .visual-editor-content p {
            margin: 0 0 14px 0 !important;
            line-height: 1.85 !important;
            text-indent: 0 !important;
          }
          
          .visual-editor-content h2 {
            font-size: 22px !important;
            font-weight: bold !important;
            margin: 1.6em 0 0.8em 0 !important;
            text-align: center !important;
            color: #1f624d !important;
            font-family: Inter, system-ui, -apple-system, sans-serif !important;
          }
          
          .visual-editor-content h4 {
            font-size: 16px !important;
            font-weight: bold !important;
            margin: 1.4em 0 0.6em 0 !important;
            color: #2f7d69 !important;
            font-family: Inter, system-ui, -apple-system, sans-serif !important;
            text-align: left !important;
          }
          
          .visual-editor-content ul, 
          .visual-editor-content ol {
            margin: 0 0 14px 24px !important;
            padding: 0 !important;
          }

          .visual-editor-content img {
            max-width: 100% !important;
            height: auto !important;
          }
          
          /* Highlighter Styles */
          .raw-editor-container {
            position: relative;
            flex: 1;
            width: 100%;
            height: 100%;
            min-height: 0;
            border: 1px solid #c9c6bd;
            border-radius: 6px;
            background: #faf9f6;
            overflow: hidden;
          }
          
          .raw-editor-textarea,
          .raw-editor-highlight {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            margin: 0;
            padding: 12px;
            border: none;
            font-family: "Fira Code", Consolas, Monaco, monospace !important;
            font-size: 13px !important;
            line-height: 1.6 !important;
            white-space: pre-wrap !important;
            word-wrap: break-word !important;
            overflow-y: auto !important;
            box-sizing: border-box !important;
          }
          
          .raw-editor-textarea {
            background: transparent !important;
            color: transparent !important;
            caret-color: #17201c !important;
            resize: none !important;
            outline: none !important;
            z-index: 2;
          }
          
          .raw-editor-highlight {
            color: #17201c;
            pointer-events: none;
            z-index: 1;
            background: transparent;
          }
          
          .hl-comment {
            color: #8c928e;
            font-style: italic;
          }
          
          .hl-prolog {
            color: #8e24aa;
            font-weight: 500;
          }
          
          .hl-tag {
            color: #02599c;
            font-weight: 600;
          }
          
          .hl-attr-name {
            color: #b07d05;
          }
          
          .hl-attr-value {
            color: #1b7a36;
          }
          
          .hl-punctuation {
            color: #4a5153;
          }

          /* Clean Sidebar Premium Styles */
          .clean-sidebar {
            width: 280px;
            background: #fcfbfa;
            border-left: 1px solid #c9c6bd;
            display: flex;
            flex-direction: column;
            padding: 16px;
            gap: 14px;
            overflow-y: auto;
            box-shadow: -4px 0 16px rgba(23, 32, 28, 0.03);
            animation: slideIn 0.2s ease;
            min-width: 280px;
          }

          @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }

          .clean-sidebar-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid #e2dfd6;
            padding-bottom: 10px;
            margin-bottom: 4px;
          }

          .clean-sidebar-header h4 {
            margin: 0;
            font-size: 14px;
            color: #1f624d;
            font-weight: 700;
            display: flex;
            align-items: center;
            gap: 6px;
          }

          .clean-option {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            cursor: pointer;
            user-select: none;
            font-size: 13px;
            color: #4d574f;
            margin-bottom: 4px;
          }

          .clean-option input {
            margin-top: 3px;
            cursor: pointer;
          }

          .clean-regex-label {
            font-size: 12px;
            font-weight: 650;
            color: #687168;
            margin-bottom: 4px;
            display: block;
          }

          .clean-regex-textarea {
            width: 100%;
            height: 100px;
            border: 1px solid #c9c6bd;
            border-radius: 6px;
            background: white;
            padding: 8px;
            font-size: 12px;
            font-family: monospace;
            resize: vertical;
            color: #17201c;
            outline: none;
          }

          .clean-regex-textarea:focus {
            border-color: #2f7d69;
          }

          .clean-apply-btn {
            background: #28705f;
            border: 1px solid #28705f;
            color: white;
            border-radius: 6px;
            padding: 8px 12px;
            font-weight: 650;
            font-size: 13px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            transition: all 0.15s ease;
            margin-top: 10px;
          }

          .clean-apply-btn:hover {
            background: #1f5447;
            border-color: #1f5447;
          }

          .clean-apply-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
          }
        `}</style>

        <header className="modalHeader">
          <div>
            <h3>Chỉnh sửa chương: {chapterTitle}</h3>
            <p>Sử dụng trình soạn thảo trực quan hoặc chỉnh sửa mã nguồn HTML của chương</p>
          </div>
          <button className="iconButton" onClick={onClose} title="Đóng">
            <X size={18} />
          </button>
        </header>

        <div className="editor-tabs">
          <button
            type="button"
            className={`editor-tab-btn ${activeTab === "visual" ? "active" : ""}`}
            onClick={() => handleTabChange("visual")}
          >
            <Eye size={15} />
            Giao diện trực quan (Visual)
          </button>
          <button
            type="button"
            className={`editor-tab-btn ${activeTab === "raw" ? "active" : ""}`}
            onClick={() => handleTabChange("raw")}
          >
            <FileCode size={15} />
            Mã nguồn HTML (Raw)
          </button>
        </div>

        <div
          className="editChapterBody"
          style={{
            flex: 1,
            padding: "14px",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            background: "#faf9f6"
          }}
        >
          {loading ? (
            <div
              style={{
                display: "flex",
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                color: "#687168"
              }}
            >
              Đang tải nội dung chương sách...
            </div>
          ) : loadError ? (
            <div className="error" style={{ margin: 0 }}>
              {loadError}
            </div>
          ) : (
            <div style={{ display: "flex", flex: 1, minHeight: 0, minWidth: 0, position: "relative", gap: showCleanPanel ? "14px" : "0" }}>
              {/* Editor Workspace */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 }}>
                {activeTab === "visual" ? (
                  <div className="visual-editor-container" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
                    <div className="editor-toolbar">
                      <button
                        type="button"
                        className="toolbar-btn"
                        onClick={() => execCmd("bold")}
                        title="Chữ đậm"
                      >
                        <Bold size={15} />
                      </button>
                      <button
                        type="button"
                        className="toolbar-btn"
                        onClick={() => execCmd("italic")}
                        title="Chữ nghiêng"
                      >
                        <Italic size={15} />
                      </button>
                      <button
                        type="button"
                        className="toolbar-btn"
                        onClick={() => execCmd("underline")}
                        title="Gạch chân"
                      >
                        <Underline size={15} />
                      </button>
                      <button
                        type="button"
                        className="toolbar-btn"
                        onClick={() => execCmd("strikeThrough")}
                        title="Gạch ngang chữ"
                      >
                        <Strikethrough size={15} />
                      </button>

                      <div className="editor-toolbar-separator" />

                      <button
                        type="button"
                        className="toolbar-block-btn"
                        onClick={() => execCmd("formatBlock", "h2")}
                        title="Tiêu đề chính (H2)"
                      >
                        Tiêu đề H2
                      </button>
                      <button
                        type="button"
                        className="toolbar-block-btn"
                        onClick={() => execCmd("formatBlock", "h4")}
                        title="Tiêu đề phụ (H4)"
                      >
                        Tiêu đề H4
                      </button>
                      <button
                        type="button"
                        className="toolbar-block-btn"
                        onClick={() => execCmd("formatBlock", "p")}
                        title="Đoạn văn thường (P)"
                      >
                        Đoạn P
                      </button>

                      <div className="editor-toolbar-separator" />

                      <button
                        type="button"
                        className="toolbar-btn"
                        onClick={() => execCmd("justifyLeft")}
                        title="Căn lề trái"
                      >
                        <AlignLeft size={15} />
                      </button>
                      <button
                        type="button"
                        className="toolbar-btn"
                        onClick={() => execCmd("justifyCenter")}
                        title="Căn giữa"
                      >
                        <AlignCenter size={15} />
                      </button>
                      <button
                        type="button"
                        className="toolbar-btn"
                        onClick={() => execCmd("justifyRight")}
                        title="Căn lề phải"
                      >
                        <AlignRight size={15} />
                      </button>

                      <div className="editor-toolbar-separator" />

                      <button
                        type="button"
                        className="toolbar-btn"
                        onClick={() => execCmd("insertUnorderedList")}
                        title="Danh sách không thứ tự"
                      >
                        <List size={15} />
                      </button>
                      <button
                        type="button"
                        className="toolbar-btn"
                        onClick={() => execCmd("insertOrderedList")}
                        title="Danh sách có thứ tự"
                      >
                        <ListOrdered size={15} />
                      </button>

                      <div className="editor-toolbar-separator" />

                      <button
                        type="button"
                        className="toolbar-btn"
                        onClick={() => execCmd("removeFormat")}
                        title="Xóa định dạng"
                      >
                        <Eraser size={15} />
                      </button>

                      <div className="editor-toolbar-separator" />

                      <button
                        type="button"
                        className={`toolbar-btn ${showCleanPanel ? "active" : ""}`}
                        onClick={() => setShowCleanPanel(!showCleanPanel)}
                        title="Bộ dọn dẹp & Định dạng chương"
                        style={{ width: "auto", padding: "0 8px", fontSize: "11px", fontWeight: "bold" }}
                      >
                        <Sparkles size={14} style={{ marginRight: "4px" }} />
                        <span>Dọn dẹp chương</span>
                      </button>
                    </div>

                    <div className="visual-editor-scrollable">
                      <div className="visual-editor-paper">
                        <div
                          ref={visualEditorRef}
                          className="visual-editor-content"
                          contentEditable={true}
                          suppressContentEditableWarning={true}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="raw-editor-container" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
                    <div className="editor-toolbar" style={{ borderBottom: "1px solid #c9c6bd", display: "flex", justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        className={`toolbar-btn ${showCleanPanel ? "active" : ""}`}
                        onClick={() => setShowCleanPanel(!showCleanPanel)}
                        title="Bộ dọn dẹp & Định dạng chương"
                        style={{ width: "auto", padding: "0 8px", fontSize: "11px", fontWeight: "bold" }}
                      >
                        <Sparkles size={14} style={{ marginRight: "4px" }} />
                        <span>Dọn dẹp chương</span>
                      </button>
                    </div>
                    <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
                      <textarea
                        ref={textareaRef}
                        className="raw-editor-textarea"
                        value={rawContent}
                        onChange={(e) => setRawContent(e.target.value)}
                        onScroll={handleScroll}
                        onKeyDown={handleKeyDown}
                        placeholder="Nhập mã HTML chương ở đây..."
                        spellCheck={false}
                      />
                      <pre ref={preRef} className="raw-editor-highlight">
                        <code
                          dangerouslySetInnerHTML={{
                            __html: highlightHTML(rawContent)
                          }}
                        />
                      </pre>
                    </div>
                  </div>
                )}
              </div>

              {/* Sliding Sidebar */}
              {showCleanPanel && (
                <div className="clean-sidebar">
                  <div className="clean-sidebar-header">
                    <h4>
                      <Sparkles size={15} />
                      <span>Dọn dẹp & Định dạng</span>
                    </h4>
                    <button
                      type="button"
                      className="chapterActionBtn danger"
                      onClick={() => setShowCleanPanel(false)}
                      title="Đóng bảng dọn dẹp"
                    >
                      <X size={12} />
                    </button>
                  </div>

                  <label className="clean-option">
                    <input
                      type="checkbox"
                      checked={stripStyles}
                      onChange={(e) => setStripStyles(e.target.checked)}
                    />
                    <div>
                      <strong>Xóa Style CSS Rác</strong>
                      <div style={{ fontSize: "11px", color: "#687168", marginTop: "2px" }}>
                        Loại bỏ CSS inline, thẻ &lt;style&gt;, font và span rườm rà.
                      </div>
                    </div>
                  </label>

                  <label className="clean-option">
                    <input
                      type="checkbox"
                      checked={removeEmpty}
                      onChange={(e) => setRemoveEmpty(e.target.checked)}
                    />
                    <div>
                      <strong>Bỏ Dòng Trống Thừa</strong>
                      <div style={{ fontSize: "11px", color: "#687168", marginTop: "2px" }}>
                        Xóa bỏ các đoạn văn rỗng hoặc chỉ chứa khoảng trắng.
                      </div>
                    </div>
                  </label>

                  <label className="clean-option">
                    <input
                      type="checkbox"
                      checked={normalizeParas}
                      onChange={(e) => setNormalizeParas(e.target.checked)}
                    />
                    <div>
                      <strong>Chuẩn Hóa Thụt Lề & Đoạn</strong>
                      <div style={{ fontSize: "11px", color: "#687168", marginTop: "2px" }}>
                        Xóa khoảng trắng dư thụt dòng, gộp thẻ &lt;br&gt;&lt;br&gt; thành đoạn.
                      </div>
                    </div>
                  </label>

                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <span className="clean-regex-label">Regex lọc quảng cáo / rác:</span>
                    <textarea
                      className="clean-regex-textarea"
                      value={regexFilters}
                      onChange={(e) => setRegexFilters(e.target.value)}
                      placeholder="Nhập mẫu Regex cần xóa, mỗi dòng một mẫu. Ví dụ:&#10;Xem thêm tại.*&#10;http://\S+&#10;truyện_cào_rác"
                    />
                  </div>

                  {cleanSuccess && (
                    <div style={{ color: "#1f624d", background: "#e9f6f0", padding: "8px", borderRadius: "6px", fontSize: "12px", border: "1px solid #94bfa7", lineHeight: "1.4" }}>
                      {cleanSuccess}
                    </div>
                  )}

                  <button
                    type="button"
                    className="clean-apply-btn"
                    onClick={handleCleanContent}
                    disabled={loading}
                  >
                    <Sparkles size={14} />
                    <span>Chạy dọn dẹp</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="modalFooter">
          <button type="button" className="smallButton" onClick={onClose}>
            Hủy
          </button>
          <button
            type="button"
            className="smallButton strong"
            onClick={handleSave}
            disabled={loading || Boolean(loadError)}
          >
            <Save size={15} />
            Lưu thay đổi
          </button>
        </footer>
      </section>
    </div>
  );
}
