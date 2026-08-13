import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Bold,
  BookOpen,
  Code2,
  Eraser,
  FileText,
  Image as ImageIcon,
  Italic,
  List,
  ListOrdered,
  Pencil,
  Settings,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Strikethrough,
  Trash2,
  Underline,
  Upload,
  X
} from "lucide-react";
import { emptyMetadata, type BookMetadata } from "../lib/types";

type Props = {
  open: boolean;
  onClose: () => void;
  onImportSuccess: (newFileName: string) => Promise<void>;
  onSetBusy: (busy: string) => void;
  onSetError: (error: string) => void;
};

type ChapterMode = "normal" | "manga";
type EditorMode = "visual" | "raw";
type AlignState = "left" | "center" | "right" | "justify" | "";

type SelectedImageFile = {
  id: string;
  file: File;
  previewUrl: string;
  name: string;
  size: number;
};

type ChapterDraft = {
  id: string;
  title: string;
  mode: ChapterMode;
  editorMode: EditorMode;
  textContent: string;
  htmlContent: string;
  mangaDirection: "rtl" | "ltr";
  images: SelectedImageFile[];
};

type ImportMode = "split" | "file" | "merge";

type ImportSource = {
  id: string;
  fileName: string;
  baseName: string;
  kind: "text" | "html";
  textContent: string;
  htmlContent: string;
};

type PendingImport = {
  sources: ImportSource[];
  fileNames: string;
};

const PATTERN_PRESETS = [
  {
    label: "Tiêu chuẩn",
    value: "(?i)^\\s*(Chương\\s+\\d+|Quyển\\s+\\d+|Tập\\s+\\d+|Chapter\\s+\\d+|Tiết\\s+\\d+)"
  },
  {
    label: "Chương X",
    value: "(?i)^\\s*(Chương\\s+\\d+)"
  },
  {
    label: "Quyển/Tập X",
    value: "(?i)^\\s*(Quyển\\s+\\d+|Tập\\s+\\d+)"
  },
  {
    label: "Số đơn",
    value: "^\\s*\\d+\\s*$"
  }
];

function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function createChapter(index: number, patch: Partial<ChapterDraft> = {}): ChapterDraft {
  return {
    id: newId(),
    title: `Chương ${index}`,
    mode: "normal",
    editorMode: "visual",
    textContent: "",
    htmlContent: "",
    mangaDirection: "rtl",
    images: [],
    ...patch
  };
}

function escapeHTML(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textToHTML(title: string, text: string) {
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHTML(line)}</p>`)
    .join("\n");
  return `<h2>${escapeHTML(title)}</h2>\n${paragraphs}`;
}

function htmlToText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function prettyHTML(source: string): string {
  const tokens = source
    .replace(/>\s+</g, "><")
    .replace(/(<[^>]+>)/g, "\n$1\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const inlineTags = new Set(["a", "abbr", "b", "br", "cite", "code", "em", "i", "span", "strong", "sub", "sup", "time", "u"]);
  const lines: string[] = [];
  let indent = 0;

  for (const token of tokens) {
    const closeMatch = token.match(/^<\/([a-zA-Z0-9:-]+)>/);
    const openMatch = token.match(/^<([a-zA-Z0-9:-]+)(?:\s|>|\/)/);
    const isClosing = Boolean(closeMatch);
    const isComment = token.startsWith("<!--");
    const isDoctype = /^<!/i.test(token) && !isComment;
    const isProcessing = token.startsWith("<?");
    const isSelfClosing = /\/>$/.test(token) || isDoctype || isProcessing || isComment;
    const tagName = (closeMatch?.[1] || openMatch?.[1] || "").toLowerCase();
    const isInline = inlineTags.has(tagName);

    if (isClosing && !isInline) {
      indent = Math.max(0, indent - 1);
    }

    lines.push(`${"  ".repeat(indent)}${token}`);

    if (openMatch && !isClosing && !isSelfClosing && !isInline) {
      indent += 1;
    }
  }

  return lines.join("\n");
}

function regexFromPreset(pattern: string) {
  let source = pattern.trim();
  let flags = "gm";
  if (source.startsWith("(?i)")) {
    source = source.slice(4);
    flags += "i";
  }
  return new RegExp(source, flags);
}

function splitTextIntoChapters(content: string, pattern: string): ChapterDraft[] {
  const normalized = content.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "");
  let re: RegExp;
  try {
    re = regexFromPreset(pattern);
  } catch {
    return [createChapter(1, { textContent: normalized })];
  }

  const matches: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(normalized)) !== null) {
    if (match[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    matches.push(match.index);
  }

  const chapters: ChapterDraft[] = [];
  if (matches.length === 0) {
    return [createChapter(1, { textContent: normalized })];
  }

  const preamble = normalized.slice(0, matches[0]).trim();
  if (preamble) {
    chapters.push(createChapter(chapters.length + 1, { title: "Mở đầu", textContent: preamble }));
  }

  matches.forEach((start, idx) => {
    const end = idx + 1 < matches.length ? matches[idx + 1] : normalized.length;
    const raw = normalized.slice(start, end).trim();
    const lineEnd = raw.indexOf("\n");
    const title = (lineEnd >= 0 ? raw.slice(0, lineEnd) : raw).trim() || `Chương ${chapters.length + 1}`;
    const body = lineEnd >= 0 ? raw.slice(lineEnd + 1).trim() : "";
    chapters.push(createChapter(chapters.length + 1, { title, textContent: body }));
  });

  return chapters;
}

function splitHTMLIntoChapters(html: string, fallbackTitle: string): ChapterDraft[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div id="epubforge-docx-root">${html}</div>`, "text/html");
  const root = doc.getElementById("epubforge-docx-root");
  if (!root) {
    return [createChapter(1, { title: fallbackTitle, editorMode: "visual", htmlContent: html, textContent: htmlToText(html) })];
  }

  const headingTags = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);
  const sections: Array<{ title: string; nodes: Node[] }> = [];
  let current: { title: string; nodes: Node[] } | null = null;
  let preamble: Node[] = [];

  Array.from(root.childNodes).forEach((node) => {
    if (node instanceof HTMLElement && headingTags.has(node.tagName)) {
      if (current) {
        sections.push(current);
      } else if (preamble.length > 0) {
        sections.push({ title: "Mở đầu", nodes: preamble });
        preamble = [];
      }
      current = {
        title: (node.textContent || "").replace(/\s+/g, " ").trim() || fallbackTitle,
        nodes: [node]
      };
      return;
    }

    if (current) {
      current.nodes.push(node);
    } else {
      preamble.push(node);
    }
  });

  if (current) {
    sections.push(current);
  }

  if (sections.length === 0) {
    const body = root.innerHTML.trim();
    return [createChapter(1, { title: fallbackTitle, editorMode: "visual", htmlContent: body, textContent: htmlToText(body) })];
  }

  return sections.map((section, index) => {
    const container = document.createElement("div");
    section.nodes.forEach((node) => container.appendChild(node.cloneNode(true)));
    const body = container.innerHTML.trim();
    return createChapter(index + 1, {
      title: section.title || `${fallbackTitle} ${index + 1}`,
      editorMode: "visual",
      htmlContent: body,
      textContent: htmlToText(body)
    });
  });
}

function fileBaseName(file: File) {
  return file.name.replace(/\.(txt|docx|doc)$/i, "").trim() || "Chương mới";
}

function fileExt(file: File) {
  return file.name.split(".").pop()?.toLowerCase() || "";
}

function readTextFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result;
      if (typeof text === "string") {
        resolve(text);
      } else {
        reject(new Error(`Không thể đọc nội dung ${file.name}`));
      }
    };
    reader.onerror = () => reject(new Error(`Không thể đọc file ${file.name}`));
    reader.readAsText(file, "UTF-8");
  });
}

async function readDocumentFile(file: File): Promise<ImportSource> {
  const ext = fileExt(file);
  const baseName = fileBaseName(file);

  if (ext === "txt") {
    const text = await readTextFile(file);
    return {
      id: newId(),
      fileName: file.name,
      baseName,
      kind: "text",
      textContent: text,
      htmlContent: ""
    };
  }

  if (ext === "docx") {
    const arrayBuffer = await file.arrayBuffer();
    const mammothModule = await import("mammoth");
    const mammoth = mammothModule.default || mammothModule;
    const result = await mammoth.convertToHtml(
      { arrayBuffer },
      {
        styleMap: [
          "p[style-name='Title'] => h1:fresh",
          "p[style-name='Heading 1'] => h1:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "p[style-name='Subtitle'] => h2:fresh"
        ],
        includeDefaultStyleMap: true
      }
    );
    return {
      id: newId(),
      fileName: file.name,
      baseName,
      kind: "html",
      textContent: htmlToText(result.value),
      htmlContent: result.value
    };
  }

  if (ext === "doc") {
    throw new Error(`${file.name}: định dạng .doc cũ chưa thể đọc trực tiếp. Hãy mở Word/LibreOffice và Save As .docx rồi nhập lại.`);
  }

  throw new Error(`${file.name}: định dạng chưa hỗ trợ.`);
}

function sourceToChapter(source: ImportSource, index: number): ChapterDraft {
  if (source.kind === "html") {
    return createChapter(index, {
      title: source.baseName,
      editorMode: "visual",
      htmlContent: source.htmlContent,
      textContent: source.textContent
    });
  }

  return createChapter(index, {
    title: source.baseName,
    textContent: source.textContent
  });
}

function buildImportChapters(sources: ImportSource[], mode: ImportMode, pattern: string): ChapterDraft[] {
  if (mode === "file") {
    return sources.map((source, index) => sourceToChapter(source, index + 1));
  }

  if (mode === "merge") {
    const mergedHTML = sources
      .map((source) => (source.kind === "html" ? `<h2>${escapeHTML(source.baseName)}</h2>\n${source.htmlContent}` : textToHTML(source.baseName, source.textContent)))
      .join("\n\n");
    return [
      createChapter(1, {
        title: sources.length === 1 ? sources[0].baseName : `Gộp ${sources.length} file`,
        editorMode: "visual",
        htmlContent: mergedHTML,
        textContent: htmlToText(mergedHTML)
      })
    ];
  }

  return sources.flatMap((source) => {
    if (source.kind === "html") {
      return splitHTMLIntoChapters(source.htmlContent, source.baseName);
    }

    return splitTextIntoChapters(source.textContent, pattern).map((chapter, index) => ({
      ...chapter,
      title: chapter.title || `${source.baseName} ${index + 1}`
    }));
  });
}

function formatSize(bytes: number) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function normalizeTextAlign(value: string): AlignState {
  if (value === "start") return "left";
  if (value === "end") return "right";
  if (value === "left" || value === "center" || value === "right" || value === "justify") return value;
  return "";
}

function detectEditorAlignment(root: HTMLElement | null): AlignState {
  if (!root) return "";
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.anchorNode || !root.contains(selection.anchorNode)) {
    return normalizeTextAlign(window.getComputedStyle(root).textAlign);
  }

  let current: Node | null = selection.anchorNode.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode.parentElement;
  while (current && current instanceof HTMLElement && current !== root) {
    const tag = current.tagName.toLowerCase();
    const display = window.getComputedStyle(current).display;
    if (/^h[1-6]$/.test(tag) || ["p", "div", "li", "td", "th", "blockquote"].includes(tag) || display === "block" || display === "list-item") {
      return normalizeTextAlign(window.getComputedStyle(current).textAlign);
    }
    current = current.parentElement;
  }

  return normalizeTextAlign(window.getComputedStyle(root).textAlign);
}

export function CreateEpubModal({ open, onClose, onImportSuccess, onSetBusy, onSetError }: Props) {
  const [metadata, setMetadata] = useState<BookMetadata>({ ...emptyMetadata, language: "vi" });
  const [chapters, setChapters] = useState<ChapterDraft[]>([createChapter(1)]);
  const [activeId, setActiveId] = useState(chapters[0].id);
  const [regexPattern, setRegexPattern] = useState(PATTERN_PRESETS[0].value);
  const [txtFileName, setTxtFileName] = useState("");
  const [modalError, setModalError] = useState("");
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>("split");
  const [importPattern, setImportPattern] = useState(PATTERN_PRESETS[0].value);
  const [showCleanPanel, setShowCleanPanel] = useState(false);
  const [activeAlign, setActiveAlign] = useState<AlignState>("");
  const txtInputRef = useRef<HTMLInputElement>(null);
  const mangaInputRef = useRef<HTMLInputElement>(null);
  const visualEditorRef = useRef<HTMLDivElement>(null);
  const rawTextareaRef = useRef<HTMLTextAreaElement>(null);
  const rawHighlightRef = useRef<HTMLPreElement>(null);

  const activeIndex = Math.max(0, chapters.findIndex((chapter) => chapter.id === activeId));
  const activeChapter = chapters[activeIndex] || chapters[0];
  const mangaChapterCount = useMemo(() => chapters.filter((chapter) => chapter.mode === "manga").length, [chapters]);
  const importPreview = useMemo(
    () => (pendingImport ? buildImportChapters(pendingImport.sources, importMode, importPattern) : []),
    [pendingImport, importMode, importPattern]
  );

  const patchChapter = (id: string, patch: Partial<ChapterDraft>) => {
    setChapters((current) => current.map((chapter) => (chapter.id === id ? { ...chapter, ...patch } : chapter)));
  };

  useEffect(() => {
    if (!open || !activeChapter || activeChapter.mode !== "normal" || activeChapter.editorMode !== "visual" || !visualEditorRef.current) {
      return;
    }
    const nextHTML = activeChapter.htmlContent || textToHTML(activeChapter.title, activeChapter.textContent);
    if (visualEditorRef.current.innerHTML !== nextHTML) {
      visualEditorRef.current.innerHTML = nextHTML;
    }
  }, [open, activeChapter?.id, activeChapter?.mode, activeChapter?.editorMode]);

  useEffect(() => {
    if (!open || activeChapter?.mode !== "normal" || activeChapter?.editorMode !== "visual") return;
    const updateAlign = () => setActiveAlign(detectEditorAlignment(visualEditorRef.current));
    document.addEventListener("selectionchange", updateAlign);
    updateAlign();
    return () => document.removeEventListener("selectionchange", updateAlign);
  }, [open, activeChapter?.id, activeChapter?.mode, activeChapter?.editorMode]);

  if (!open) return null;

  const resetDraft = () => {
    chapters.forEach((chapter) => chapter.images.forEach((img) => URL.revokeObjectURL(img.previewUrl)));
    const first = createChapter(1);
    setMetadata({ ...emptyMetadata, language: "vi" });
    setChapters([first]);
    setActiveId(first.id);
    setTxtFileName("");
    setModalError("");
    setMetadataOpen(false);
    setPendingImport(null);
    setImportMode("split");
    setImportPattern(PATTERN_PRESETS[0].value);
    setShowCleanPanel(false);
  };

  const updateMetadata = (patch: Partial<BookMetadata>) => {
    setMetadata((current) => ({ ...current, ...patch }));
  };

  const isEmptyInitialChapter = (items: ChapterDraft[]) =>
    items.length === 1 &&
    items[0].mode === "normal" &&
    !items[0].textContent.trim() &&
    !items[0].htmlContent.trim() &&
    items[0].images.length === 0;

  const closeModal = () => {
    resetDraft();
    onClose();
  };

  const addChapter = (mode: ChapterMode = "normal") => {
    const next = createChapter(chapters.length + 1, { mode, title: mode === "manga" ? `Manga ${chapters.length + 1}` : `Chương ${chapters.length + 1}` });
    setChapters((current) => [...current, next]);
    setActiveId(next.id);
  };

  const removeChapter = (id: string) => {
    if (chapters.length === 1) return;
    const target = chapters.find((chapter) => chapter.id === id);
    target?.images.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    const remaining = chapters.filter((chapter) => chapter.id !== id);
    setChapters(remaining);
    if (activeId === id) {
      setActiveId(remaining[Math.max(0, activeIndex - 1)]?.id || remaining[0].id);
    }
  };

  const moveChapter = (index: number, offset: -1 | 1) => {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= chapters.length) return;
    const next = [...chapters];
    const temp = next[index];
    next[index] = next[targetIndex];
    next[targetIndex] = temp;
    setChapters(next);
  };

  const handleTxtFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length === 0) return;

    const fileNames = files.map((file) => file.name).join(", ");
    setTxtFileName(fileNames);
    setModalError("");

    const firstName = fileBaseName(files[0]);
    if (!metadata.title.trim()) {
      if (firstName.includes(" - ")) {
        const [bookTitle, bookAuthor] = firstName.split(" - ");
        updateMetadata({
          title: bookTitle.trim(),
          creator: metadata.creator || bookAuthor.trim()
        });
      } else {
        updateMetadata({ title: firstName });
      }
    }

    try {
      const sources = await Promise.all(files.map((file) => readDocumentFile(file)));
      setImportPattern(regexPattern);
      setImportMode("split");
      setPendingImport({ sources, fileNames });
    } catch (err: any) {
      setModalError(err.message || "Không thể nhập file.");
    }
  };

  const cancelPendingImport = () => {
    setPendingImport(null);
  };

  const applyPendingImport = () => {
    if (!pendingImport) return;
    const imported = buildImportChapters(pendingImport.sources, importMode, importPattern);
    if (imported.length === 0) {
      setPendingImport(null);
      return;
    }

    setRegexPattern(importPattern);
    setChapters((current) => (isEmptyInitialChapter(current) ? imported : [...current, ...imported]));
    setActiveId(imported[0].id);
    setPendingImport(null);
  };

  const addMangaFiles = (files: File[]) => {
    if (!activeChapter || activeChapter.mode !== "manga") return;
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    const nextImages = imageFiles.map((file) => ({
      id: newId(),
      file,
      previewUrl: URL.createObjectURL(file),
      name: file.name,
      size: file.size
    }));
    patchChapter(activeChapter.id, {
      images: [...activeChapter.images, ...nextImages].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }))
    });
  };

  const removeMangaImage = (imageId: string) => {
    const image = activeChapter.images.find((img) => img.id === imageId);
    if (image) URL.revokeObjectURL(image.previewUrl);
    patchChapter(activeChapter.id, { images: activeChapter.images.filter((img) => img.id !== imageId) });
  };

  const moveMangaImage = (index: number, offset: -1 | 1) => {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= activeChapter.images.length) return;
    const next = [...activeChapter.images];
    const temp = next[index];
    next[index] = next[targetIndex];
    next[targetIndex] = temp;
    patchChapter(activeChapter.id, { images: next });
  };

  const clearMangaImages = () => {
    activeChapter.images.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    patchChapter(activeChapter.id, { images: [] });
  };

  const handleCoverUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        updateMetadata({ coverImage: reader.result });
      }
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const setEditorMode = (mode: EditorMode) => {
    if (mode === activeChapter.editorMode) return;
    if (mode === "raw") {
      const visualHTML = visualEditorRef.current?.innerHTML || activeChapter.htmlContent || textToHTML(activeChapter.title, activeChapter.textContent);
      patchChapter(activeChapter.id, {
        editorMode: "raw",
        htmlContent: prettyHTML(visualHTML),
        textContent: htmlToText(visualHTML)
      });
    } else {
      patchChapter(activeChapter.id, {
        editorMode: "visual",
        textContent: activeChapter.textContent || htmlToText(activeChapter.htmlContent),
        htmlContent: activeChapter.htmlContent || textToHTML(activeChapter.title, activeChapter.textContent)
      });
    }
  };

  const execCmd = (command: string, value = "") => {
    document.execCommand(command, false, value);
    if (visualEditorRef.current) {
      const html = visualEditorRef.current.innerHTML;
      patchChapter(activeChapter.id, { htmlContent: html, textContent: htmlToText(html) });
      visualEditorRef.current.focus();
      window.setTimeout(() => setActiveAlign(detectEditorAlignment(visualEditorRef.current)), 0);
    }
  };

  const handleVisualInput = () => {
    if (!visualEditorRef.current) return;
    const html = visualEditorRef.current.innerHTML;
    patchChapter(activeChapter.id, { htmlContent: html, textContent: htmlToText(html) });
    setActiveAlign(detectEditorAlignment(visualEditorRef.current));
  };

  const handleRawScroll = () => {
    if (!rawTextareaRef.current || !rawHighlightRef.current) return;
    rawHighlightRef.current.scrollTop = rawTextareaRef.current.scrollTop;
    rawHighlightRef.current.scrollLeft = rawTextareaRef.current.scrollLeft;
  };

  const handleRawKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const textarea = rawTextareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = activeChapter.htmlContent.slice(0, start) + "  " + activeChapter.htmlContent.slice(end);
    patchChapter(activeChapter.id, {
      htmlContent: next,
      textContent: htmlToText(next)
    });

    window.setTimeout(() => {
      textarea.selectionStart = textarea.selectionEnd = start + 2;
    }, 0);
  };

  const highlightHTML = (code: string): string => {
    const tokenRegex = /(<!--[\s\S]*?-->)|(<\?xml[\s\S]*?\?>|<\![a-zA-Z]+[\s\S]*?>)|(<\/?[a-zA-Z0-9:-]+(?:\s+[a-zA-Z0-9:-]+(?:=(?:["'].*?["']|[^>\s]+))?)*\s*\/?>)/g;
    let lastIndex = 0;
    let result = "";
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(code)) !== null) {
      result += escapeHTML(code.substring(lastIndex, match.index));
      const comment = match[1];
      const prolog = match[2];
      const tag = match[3];

      if (comment) {
        result += `<span class="hl-comment">${escapeHTML(comment)}</span>`;
      } else if (prolog) {
        result += `<span class="hl-prolog">${escapeHTML(prolog)}</span>`;
      } else if (tag) {
        const tagMatch = tag.match(/^(<\/?[a-zA-Z0-9:-]+)(\s[\s\S]*?)?(\/?\s*>)$/);
        if (tagMatch) {
          const start = tagMatch[1];
          let attrs = tagMatch[2] || "";
          const end = tagMatch[3];
          attrs = attrs.replace(/(\s[a-zA-Z0-9:-]+)(=)(['"].*?['"]|[^>\s]+)/g, (_m, attrName, attrEq, attrValue) => {
            return ` <span class="hl-attr-name">${escapeHTML(attrName.trim())}</span><span class="hl-punctuation">${attrEq}</span><span class="hl-attr-value">${escapeHTML(attrValue)}</span>`;
          });
          result += `<span class="hl-tag">${escapeHTML(start)}</span>${attrs}<span class="hl-tag">${escapeHTML(end)}</span>`;
        } else {
          result += `<span class="hl-tag">${escapeHTML(tag)}</span>`;
        }
      }

      lastIndex = tokenRegex.lastIndex;
    }

    result += escapeHTML(code.substring(lastIndex));
    return result || " ";
  };

  const cleanHTMLDraft = (html: string) => {
    let next = html;
    next = next.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
    next = next.replace(/\sstyle=(["'])[\s\S]*?\1/gi, "");
    next = next.replace(/\sclass=(["'])[\s\S]*?\1/gi, "");
    next = next.replace(/<\/?font[^>]*>/gi, "");
    next = next.replace(/<span[^>]*>/gi, "");
    next = next.replace(/<\/span>/gi, "");
    next = next.replace(/<p[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, "");
    next = next.replace(/(?:<br\s*\/?>\s*){3,}/gi, "<br /><br />");
    next = next.replace(/[ \t]{2,}/g, " ");
    next = next.replace(/\s+([,.!?;:])/g, "$1");
    next = next.replace(/([,.!?;:])(?=\S)/g, "$1 ");
    return next.trim();
  };

  const cleanActiveChapter = () => {
    const source =
      activeChapter.editorMode === "visual"
        ? visualEditorRef.current?.innerHTML || activeChapter.htmlContent || textToHTML(activeChapter.title, activeChapter.textContent)
        : activeChapter.htmlContent;
    const cleaned = cleanHTMLDraft(source);
    patchChapter(activeChapter.id, {
      htmlContent: cleaned,
      textContent: htmlToText(cleaned)
    });
    if (activeChapter.editorMode === "visual" && visualEditorRef.current) {
      visualEditorRef.current.innerHTML = cleaned;
      visualEditorRef.current.focus();
    }
  };

  const submit = async () => {
    if (!metadata.title.trim()) {
      setModalError("Vui lòng nhập tiêu đề sách.");
      return;
    }

    const invalidChapter = chapters.find((chapter) => {
      if (!chapter.title.trim()) return true;
      if (chapter.mode === "manga") return chapter.images.length === 0;
      return chapter.editorMode === "raw" ? !chapter.htmlContent.trim() : !chapter.textContent.trim();
    });

    if (invalidChapter) {
      setModalError(`Chương "${invalidChapter.title || "chưa đặt tên"}" chưa có nội dung hợp lệ.`);
      setActiveId(invalidChapter.id);
      return;
    }

    setModalError("");
    onSetBusy("Đang tạo EPUB...");
    onSetError("");

    try {
      const direction = chapters.find((chapter) => chapter.mode === "manga")?.mangaDirection || "ltr";
      const payload = {
        title: metadata.title.trim(),
        author: metadata.creator.trim(),
        metadata: {
          ...metadata,
          title: metadata.title.trim(),
          creator: metadata.creator.trim()
        },
        direction,
        chapters: chapters.map((chapter) => ({
          id: chapter.id,
          title: chapter.title.trim(),
          mode: chapter.mode,
          text:
            chapter.mode === "normal"
              ? chapter.htmlContent || textToHTML(chapter.title, chapter.textContent)
              : chapter.textContent,
          rawHtml: chapter.mode === "normal",
          mangaDirection: chapter.mangaDirection,
          imageFileNames: chapter.images.map((img) => img.name)
        }))
      };
      const formData = new FormData();
      formData.append("payload", JSON.stringify(payload));
      chapters.forEach((chapter) => {
        chapter.images.forEach((img) => formData.append(`images_${chapter.id}`, img.file, img.name));
      });

      const res = await fetch("/api/epubs/create", {
        method: "POST",
        body: formData
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Không thể tạo EPUB.");
      }

      const data = await res.json();
      resetDraft();
      onClose();
      await onImportSuccess(data.fileName);
    } catch (err: any) {
      onSetError(err.message || "Không thể tạo EPUB.");
    } finally {
      onSetBusy("");
    }
  };

  return (
    <div className="modalBackdrop createEpubBackdrop" role="presentation" onMouseDown={closeModal}>
      <section className="metadataModal createEpubModal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modalHeader createEpubHeader">
          <div className="createEpubTitle">
            <BookOpen size={19} />
            <div>
              <h3>Tạo EPUB</h3>
              <p>{chapters.length} chương · {mangaChapterCount} chương manga</p>
            </div>
          </div>
          <button className="iconButton" onClick={closeModal} title="Đóng">
            <X size={18} />
          </button>
        </header>

        <div className="createEpubLayout">
          <aside className="createChapterSidebar">
            <div className="createSidebarTools">
              <button className="smallButton strong" type="button" onClick={() => addChapter("normal")}>
                <Plus size={14} />
                <span>Chương</span>
              </button>
              <button className="smallButton" type="button" onClick={() => addChapter("manga")}>
                <ImageIcon size={14} />
                <span>Manga</span>
              </button>
            </div>

            <div className="createImportBox">
              <input ref={txtInputRef} type="file" accept=".txt,.docx,.doc" multiple onChange={handleTxtFile} style={{ display: "none" }} />
              <button className="smallButton" type="button" onClick={() => txtInputRef.current?.click()}>
                <Upload size={14} />
                <span>Nhập file</span>
              </button>
              <select value={regexPattern} onChange={(event) => setRegexPattern(event.target.value)}>
                {PATTERN_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {preset.label}
                  </option>
                ))}
              </select>
              {txtFileName ? <small>{txtFileName}</small> : null}
            </div>

            <div className="createChapterList">
              {chapters.map((chapter, index) => (
                <div
                  key={chapter.id}
                  className={chapter.id === activeChapter.id ? "createChapterItem active" : "createChapterItem"}
                  onClick={() => setActiveId(chapter.id)}
                >
                  <span className="createChapterIndex">{index + 1}</span>
                  <label className="createChapterTitleField" onClick={(event) => event.stopPropagation()}>
                    <span>
                      <Pencil size={11} />
                      Tên chương
                    </span>
                    <input
                      value={chapter.title}
                      onFocus={() => setActiveId(chapter.id)}
                      onChange={(event) => patchChapter(chapter.id, { title: event.target.value })}
                      title="Sửa tên chương"
                      aria-label={`Sửa tên chương ${index + 1}`}
                    />
                  </label>
                  <span className={chapter.mode === "manga" ? "createModeBadge manga" : "createModeBadge"}>
                    {chapter.mode === "manga" ? "Manga" : "Text"}
                  </span>
                  <span className="createChapterActions">
                    <button type="button" onClick={(event) => { event.stopPropagation(); moveChapter(index, -1); }} disabled={index === 0} title="Lên">
                      <ArrowUp size={13} />
                    </button>
                    <button type="button" onClick={(event) => { event.stopPropagation(); moveChapter(index, 1); }} disabled={index === chapters.length - 1} title="Xuống">
                      <ArrowDown size={13} />
                    </button>
                    <button type="button" onClick={(event) => { event.stopPropagation(); removeChapter(chapter.id); }} disabled={chapters.length === 1} title="Xóa">
                      <Trash2 size={13} />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </aside>

          <section className="createEditorPane">
            <section className="createMetadataSummary" aria-label="Metadata sách">
              <div className="createSummaryCover">
                {metadata.coverImage ? (
                  <img src={metadata.coverImage} alt="Ảnh bìa" />
                ) : (
                  <BookOpen size={18} />
                )}
              </div>
              <div className="createSummaryText">
                <strong>{metadata.title.trim() || "Chưa đặt tên sách"}</strong>
                <span>
                  {metadata.creator.trim() || "Chưa có tác giả"}
                  {metadata.publisher.trim() ? ` · ${metadata.publisher.trim()}` : ""}
                  {metadata.series?.trim() ? ` · ${metadata.series.trim()}${metadata.seriesIndex?.trim() ? ` #${metadata.seriesIndex.trim()}` : ""}` : ""}
                </span>
              </div>
              <button type="button" className="smallButton" onClick={() => setMetadataOpen(true)}>
                <Settings size={14} />
                <span>Metadata</span>
              </button>
            </section>

            <div className="createEditorToolbar">
              <div className="segmentedControl">
                <button className={activeChapter.mode === "normal" ? "active" : ""} type="button" onClick={() => patchChapter(activeChapter.id, { mode: "normal" })}>
                  <FileText size={14} />
                  <span>Normal</span>
                </button>
                <button className={activeChapter.mode === "manga" ? "active" : ""} type="button" onClick={() => patchChapter(activeChapter.id, { mode: "manga" })}>
                  <ImageIcon size={14} />
                  <span>Manga</span>
                </button>
              </div>

              {activeChapter.mode === "normal" ? (
                <div className="segmentedControl">
                  <button className={activeChapter.editorMode === "visual" ? "active" : ""} type="button" onClick={() => setEditorMode("visual")}>
                    <FileText size={14} />
                    <span>Editor</span>
                  </button>
                  <button className={activeChapter.editorMode === "raw" ? "active" : ""} type="button" onClick={() => setEditorMode("raw")}>
                    <Code2 size={14} />
                    <span>HTML raw</span>
                  </button>
                </div>
              ) : (
                <select value={activeChapter.mangaDirection} onChange={(event) => patchChapter(activeChapter.id, { mangaDirection: event.target.value as "rtl" | "ltr" })}>
                  <option value="rtl">RTL - Manga Nhật</option>
                  <option value="ltr">LTR - Comic/Webtoon</option>
                </select>
              )}
            </div>

            {modalError ? <div className="createModalError">{modalError}</div> : null}

            {activeChapter.mode === "normal" ? (
              <div className="createWriterShell">
                {activeChapter.editorMode === "visual" ? (
                  <div className="createWriterMain">
                    <div className="createFormatToolbar" onMouseDown={(event) => event.preventDefault()}>
                      <button type="button" onClick={() => execCmd("bold")} title="Chữ đậm">
                        <Bold size={15} />
                      </button>
                      <button type="button" onClick={() => execCmd("italic")} title="Chữ nghiêng">
                        <Italic size={15} />
                      </button>
                      <button type="button" onClick={() => execCmd("underline")} title="Gạch chân">
                        <Underline size={15} />
                      </button>
                      <button type="button" onClick={() => execCmd("strikeThrough")} title="Gạch ngang">
                        <Strikethrough size={15} />
                      </button>
                      <span />
                      <button type="button" className="wide" onClick={() => execCmd("formatBlock", "h2")} title="Tiêu đề H2">H2</button>
                      <button type="button" className="wide" onClick={() => execCmd("formatBlock", "h4")} title="Tiêu đề H4">H4</button>
                      <button type="button" className="wide" onClick={() => execCmd("formatBlock", "p")} title="Đoạn văn">P</button>
                      <span />
                      <button type="button" className={activeAlign === "left" ? "active" : ""} onClick={() => execCmd("justifyLeft")} title="Căn trái">
                        <AlignLeft size={15} />
                      </button>
                      <button type="button" className={activeAlign === "center" ? "active" : ""} onClick={() => execCmd("justifyCenter")} title="Căn giữa">
                        <AlignCenter size={15} />
                      </button>
                      <button type="button" className={activeAlign === "right" ? "active" : ""} onClick={() => execCmd("justifyRight")} title="Căn phải">
                        <AlignRight size={15} />
                      </button>
                      <span />
                      <button type="button" onClick={() => execCmd("insertUnorderedList")} title="Danh sách">
                        <List size={15} />
                      </button>
                      <button type="button" onClick={() => execCmd("insertOrderedList")} title="Danh sách số">
                        <ListOrdered size={15} />
                      </button>
                      <button type="button" onClick={() => execCmd("removeFormat")} title="Xóa định dạng">
                        <Eraser size={15} />
                      </button>
                      <button type="button" className={showCleanPanel ? "wide active" : "wide"} onClick={() => setShowCleanPanel((current) => !current)} title="Dọn dẹp chương">
                        <Sparkles size={14} />
                        Dọn
                      </button>
                    </div>
                    <div className="createVisualCanvas">
                      <div
                        ref={visualEditorRef}
                        className="createVisualEditor"
                        contentEditable
                        suppressContentEditableWarning
                        onInput={handleVisualInput}
                        onKeyUp={() => setActiveAlign(detectEditorAlignment(visualEditorRef.current))}
                        onMouseUp={() => setActiveAlign(detectEditorAlignment(visualEditorRef.current))}
                        data-placeholder="Viết hoặc dán nội dung chương ở đây..."
                      />
                    </div>
                  </div>
                ) : (
                  <div className="createWriterMain">
                    <div className="createFormatToolbar compact">
                      <button type="button" className={showCleanPanel ? "wide active" : "wide"} onClick={() => setShowCleanPanel((current) => !current)} title="Dọn dẹp chương">
                        <Sparkles size={14} />
                        Dọn dẹp
                      </button>
                      <button
                        type="button"
                        className="wide"
                        onClick={() =>
                          patchChapter(activeChapter.id, {
                            htmlContent: prettyHTML(activeChapter.htmlContent),
                            textContent: htmlToText(activeChapter.htmlContent)
                          })
                        }
                        title="Format lại HTML"
                      >
                        <Code2 size={14} />
                        Format HTML
                      </button>
                    </div>
                    <div className="createRawEditorWrap">
                      <textarea
                        ref={rawTextareaRef}
                        className="createRawEditor"
                        value={activeChapter.htmlContent}
                        onChange={(event) =>
                          patchChapter(activeChapter.id, { htmlContent: event.target.value, textContent: htmlToText(event.target.value) })
                        }
                        onScroll={handleRawScroll}
                        onKeyDown={handleRawKeyDown}
                        placeholder="<h2>Chương 1</h2>&#10;<p>Nội dung XHTML...</p>"
                        spellCheck={false}
                      />
                      <pre ref={rawHighlightRef} className="createRawHighlight">
                        <code dangerouslySetInnerHTML={{ __html: highlightHTML(activeChapter.htmlContent) }} />
                      </pre>
                    </div>
                  </div>
                )}
                {showCleanPanel ? (
                  <aside className="createCleanPanel">
                    <div>
                      <strong>
                        <Sparkles size={14} />
                        Dọn dẹp chương
                      </strong>
                      <button type="button" onClick={() => setShowCleanPanel(false)} title="Đóng">
                        <X size={13} />
                      </button>
                    </div>
                    <p>Xóa style rác, span/font dư, đoạn rỗng và chuẩn hóa khoảng cách dấu câu cho bản nháp hiện tại.</p>
                    <button type="button" className="smallButton strong" onClick={cleanActiveChapter}>
                      <Sparkles size={14} />
                      <span>Chạy dọn dẹp</span>
                    </button>
                  </aside>
                ) : null}
              </div>
            ) : (
              <div className="createMangaEditor">
                <input
                  ref={mangaInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(event) => {
                    addMangaFiles(Array.from(event.target.files || []));
                    event.target.value = "";
                  }}
                  style={{ display: "none" }}
                />
                <div className="createMangaDrop" onClick={() => mangaInputRef.current?.click()}>
                  <Upload size={24} />
                  <span>Chọn ảnh cho chương manga</span>
                  <small>JPG, PNG, GIF, WebP. File mới được sắp xếp A-Z tự nhiên.</small>
                </div>
                <div className="createMangaListHeader">
                  <strong>{activeChapter.images.length} trang</strong>
                  <div>
                    <button type="button" onClick={() => patchChapter(activeChapter.id, { images: [...activeChapter.images].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })) })}>
                      <RefreshCw size={13} />
                      <span>A-Z</span>
                    </button>
                    <button type="button" onClick={clearMangaImages} disabled={activeChapter.images.length === 0}>
                      <Trash2 size={13} />
                      <span>Xóa hết</span>
                    </button>
                  </div>
                </div>
                <div className="createMangaGrid">
                  {activeChapter.images.map((img, index) => (
                    <div className="createMangaCard" key={img.id}>
                      <img src={img.previewUrl} alt={img.name} />
                      <div>
                        <strong title={img.name}>{img.name}</strong>
                        <small>Trang {index + 1} · {formatSize(img.size)}</small>
                      </div>
                      <span>
                        <button type="button" onClick={() => moveMangaImage(index, -1)} disabled={index === 0} title="Lên">
                          <ArrowUp size={13} />
                        </button>
                        <button type="button" onClick={() => moveMangaImage(index, 1)} disabled={index === activeChapter.images.length - 1} title="Xuống">
                          <ArrowDown size={13} />
                        </button>
                        <button type="button" onClick={() => removeMangaImage(img.id)} title="Xóa">
                          <Trash2 size={13} />
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>

        <footer className="modalFooter createEpubFooter">
          <button type="button" className="smallButton" onClick={closeModal}>
            Hủy
          </button>
          <button type="button" className="smallButton strong" onClick={submit}>
            <Save size={14} />
            <span>Tạo EPUB</span>
          </button>
        </footer>

        {pendingImport && (
          <div className="createMetadataOverlay" role="presentation" onMouseDown={cancelPendingImport}>
            <section className="metadataModal createImportDialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
              <header className="modalHeader">
                <div>
                  <h3>Cách nhập chương</h3>
                  <p>{pendingImport.fileNames}</p>
                </div>
                <button className="iconButton" type="button" onClick={cancelPendingImport} title="Đóng">
                  <X size={18} />
                </button>
              </header>

              <div className="createImportDialogBody">
                <div className="createImportModes" role="radiogroup" aria-label="Cách chia chương khi nhập">
                  <label className={importMode === "split" ? "createImportMode active" : "createImportMode"}>
                    <input type="radio" checked={importMode === "split"} onChange={() => setImportMode("split")} />
                    <strong>Tự tách chương</strong>
                    <span>TXT dùng regex. DOCX dùng heading H1/H2 nếu có.</span>
                  </label>
                  <label className={importMode === "file" ? "createImportMode active" : "createImportMode"}>
                    <input type="radio" checked={importMode === "file"} onChange={() => setImportMode("file")} />
                    <strong>Mỗi file là một chương</strong>
                    <span>Giữ nguyên nội dung từng file, tên chương lấy từ tên file.</span>
                  </label>
                  <label className={importMode === "merge" ? "createImportMode active" : "createImportMode"}>
                    <input type="radio" checked={importMode === "merge"} onChange={() => setImportMode("merge")} />
                    <strong>Gộp tất cả vào một chương</strong>
                    <span>Hợp nhiều file thành một chương để tự sửa tiếp.</span>
                  </label>
                </div>

                {importMode === "split" ? (
                  <div className="createImportPattern">
                    <label className="field">
                      <span>Mẫu tách chương</span>
                      <select
                        value={PATTERN_PRESETS.some((preset) => preset.value === importPattern) ? importPattern : ""}
                        onChange={(event) => event.target.value && setImportPattern(event.target.value)}
                      >
                        <option value="">Tùy chỉnh</option>
                        {PATTERN_PRESETS.map((preset) => (
                          <option key={preset.value} value={preset.value}>
                            {preset.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Regex</span>
                      <input value={importPattern} onChange={(event) => setImportPattern(event.target.value)} />
                    </label>
                  </div>
                ) : null}

                <div className="createImportPreview">
                  <div>
                    <strong>Sẽ tạo {importPreview.length} chương</strong>
                    <span>{pendingImport.sources.length} file đã đọc</span>
                  </div>
                  <ol>
                    {importPreview.slice(0, 80).map((chapter, index) => (
                      <li key={`${chapter.id}-${index}`}>
                        <span>{index + 1}</span>
                        <strong>{chapter.title || `Chương ${index + 1}`}</strong>
                      </li>
                    ))}
                  </ol>
                  {importPreview.length > 80 ? <small>Còn {importPreview.length - 80} chương khác...</small> : null}
                </div>
              </div>

              <footer className="modalFooter">
                <button type="button" className="smallButton" onClick={cancelPendingImport}>
                  Hủy
                </button>
                <button type="button" className="smallButton strong" onClick={applyPendingImport}>
                  <Upload size={14} />
                  <span>Áp dụng nhập</span>
                </button>
              </footer>
            </section>
          </div>
        )}

        {metadataOpen && (
          <div className="createMetadataOverlay" role="presentation" onMouseDown={() => setMetadataOpen(false)}>
            <section className="metadataModal createMetadataDialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
              <header className="modalHeader">
                <div>
                  <h3>Metadata</h3>
                  <p>Thông tin sẽ được ghi vào EPUB mới</p>
                </div>
                <button className="iconButton" type="button" onClick={() => setMetadataOpen(false)} title="Đóng">
                  <X size={18} />
                </button>
              </header>

              <div className="createMetadataDialogBody">
                <div className="createCoverBox">
                  {metadata.coverImage ? (
                    <img src={metadata.coverImage} alt="Ảnh bìa" />
                  ) : (
                    <BookOpen size={26} />
                  )}
                  <label className="smallButton">
                    <Upload size={13} />
                    <span>Chọn bìa</span>
                    <input type="file" accept="image/png, image/jpeg, image/jpg, image/gif, image/webp" onChange={handleCoverUpload} />
                  </label>
                  {metadata.coverImage ? (
                    <button type="button" className="smallButton" onClick={() => updateMetadata({ coverImage: "" })}>
                      <Trash2 size={13} />
                      <span>Xóa bìa</span>
                    </button>
                  ) : null}
                </div>

                <div className="createMetadataFields">
                  <label className="field">
                    <span>Title</span>
                    <input value={metadata.title} onChange={(event) => updateMetadata({ title: event.target.value })} placeholder="Tên sách" />
                  </label>
                  <label className="field">
                    <span>Author</span>
                    <input value={metadata.creator} onChange={(event) => updateMetadata({ creator: event.target.value })} placeholder="Tác giả" />
                  </label>
                  <label className="field">
                    <span>Language</span>
                    <input value={metadata.language} onChange={(event) => updateMetadata({ language: event.target.value })} placeholder="vi" />
                  </label>
                  <label className="field">
                    <span>Publisher</span>
                    <input value={metadata.publisher} onChange={(event) => updateMetadata({ publisher: event.target.value })} />
                  </label>
                  <label className="field">
                    <span>Subject / Tags</span>
                    <input value={metadata.subject} onChange={(event) => updateMetadata({ subject: event.target.value })} />
                  </label>
                  <label className="field">
                    <span>Series</span>
                    <input value={metadata.series || ""} onChange={(event) => updateMetadata({ series: event.target.value })} />
                  </label>
                  <label className="field">
                    <span>Series Index</span>
                    <input value={metadata.seriesIndex || ""} onChange={(event) => updateMetadata({ seriesIndex: event.target.value })} />
                  </label>
                  <label className="field createDescriptionField">
                    <span>Description</span>
                    <textarea value={metadata.description} onChange={(event) => updateMetadata({ description: event.target.value })} />
                  </label>
                </div>
              </div>

              <footer className="modalFooter">
                <button type="button" className="smallButton strong" onClick={() => setMetadataOpen(false)}>
                  Xong
                </button>
              </footer>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}
