import React, { useMemo, useState } from "react";
import { X, Combine, HelpCircle } from "lucide-react";
import type { Chapter } from "../lib/types";

type Props = {
  open: boolean;
  bookId: string;
  chapters: Chapter[];
  onClose: () => void;
  onUpdateAnalysis: (newAnalysis: any) => void;
  onSetBusy: (busy: string) => void;
  onSetError: (error: string) => void;
};

type Indicator = number | string | null;

interface ChapterWithIndicator extends Chapter {
  indicator: Indicator;
}

interface MergeGroup {
  key: string;
  chapters: ChapterWithIndicator[];
  suggestedTitle: string;
}

type TocNode = {
  title: string;
  href: string;
};

const romanValues: Record<string, number> = {
  i: 1,
  ii: 2,
  iii: 3,
  iv: 4,
  v: 5,
  vi: 6,
  vii: 7,
  viii: 8,
  ix: 9,
  x: 10,
  xi: 11,
  xii: 12,
  xiii: 13,
  xiv: 14,
  xv: 15,
  xvi: 16
};

const wordRanks: Record<string, number> = {
  thuong: 1,
  dau: 1,
  tren: 1,
  a: 1,
  trung: 2,
  giua: 2,
  b: 2,
  ha: 3,
  cuoi: 3,
  het: 3,
  end: 3,
  c: 3,
  tiep: 4,
  "tiep theo": 4,
  d: 4
};

const leadingNoise = /^(?:mới|moi|new|hot|update|raw|dịch|dich|edit)\s+/i;
const bracketNoise = /^[[(](?:mới|moi|new|hot|update|raw|dịch|dich|edit)[\])]\s*/i;
const prefixPattern =
  "(?:chương|chuong|ch|chapter|ngoại\\s*truyện|ngoai\\s*truyen|phiên\\s*ngoại|phien\\s*ngoai|pn|vĩ\\s*thanh|vi\\s*thanh|tiền\\s*truyện|tien\\s*truyen|hậu\\s*truyện|hau\\s*truyen)";
const prefixCapture = `(${prefixPattern})`;
const volumePattern = "(?:(?:quyển|quyen|tập|tap|vol|volume)\\s*\\d+\\s+)?";
const indicatorPattern =
  "(?:\\d+\\/\\d+|\\d+|i{1,3}|iv|v|vi{1,3}|ix|x|xi{1,3}|xiv|xv|xvi{1,3}|thượng|thuong|trung|hạ|ha|tiếp\\s*theo|tiep\\s*theo|tiếp|tiep|đầu|dau|cuối|cuoi|hết|het|end|[a-d])";

function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripNoise(value: string): string {
  let text = normalizeSpaces(value);
  let changed = true;
  while (changed) {
    const next = text.replace(leadingNoise, "").replace(bracketNoise, "").trim();
    changed = next !== text;
    text = next;
  }
  return text;
}

function normalizePrefixText(prefix: string): string {
  const p = foldText(prefix).trim();
  if (p.startsWith("ch") || p.startsWith("chapter")) return "Chương";
  if (p.startsWith("ngoai")) return "Ngoại truyện";
  if (p.startsWith("phien") || p === "pn") return "Phiên ngoại";
  if (p.startsWith("vi")) return "Vĩ thanh";
  if (p.startsWith("tien")) return "Tiền truyện";
  if (p.startsWith("hau")) return "Hậu truyện";
  return prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

function normalizeVolumePrefix(value: string): string {
  const text = normalizeSpaces(value);
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function getIndicatorRank(indicator: Indicator): number {
  if (typeof indicator === "number") return indicator;
  if (typeof indicator !== "string") return 999;

  const ind = foldText(indicator.trim());
  if (ind.includes("/")) {
    const [numRaw, denRaw] = ind.split("/");
    const num = Number.parseInt(numRaw, 10);
    const den = Number.parseInt(denRaw, 10);
    if (!Number.isNaN(num) && !Number.isNaN(den) && den !== 0) {
      return num / den;
    }
  }

  const numeric = Number.parseInt(ind, 10);
  if (!Number.isNaN(numeric)) return numeric;
  if (romanValues[ind]) return romanValues[ind];
  if (wordRanks[ind]) return wordRanks[ind];
  if (ind.length === 1 && ind >= "a" && ind <= "z") {
    return ind.charCodeAt(0) - 96;
  }
  return 999;
}

function cleanRest(rest: string): string {
  return normalizeSpaces(rest.replace(/^[:\-–—\s.,]+/, "").replace(/[:\-–—\s.,]+$/, ""));
}

function removeTrailingIndicator(rest: string): string {
  const bracket = new RegExp(
    `\\s*[\\(\\[（<]\\s*(?:phần|phan|part|tập|tap|cột|cot|trận|tran|chap)?\\s*(${indicatorPattern})\\s*[\\)\\]）>]\\s*$`,
    "i"
  );
  const suffix = new RegExp(
    `\\s*[-:–—\\s,.]+\\s*(?:phần|phan|part|tập|tap|cột|cot|trận|tran|chap|quyển|quyen)?\\s*(${indicatorPattern})\\s*$`,
    "i"
  );
  return cleanRest(rest.replace(bracket, "").replace(suffix, ""));
}

function buildBaseTitle(volumePrefix: string, prefix: string, chapterNumber: string, rest: string): string {
  const normalizedPrefix = normalizePrefixText(prefix);
  const normalizedVolume = normalizeVolumePrefix(volumePrefix);
  const leading = `${normalizedVolume}${normalizedPrefix} ${chapterNumber}`;
  const clean = removeTrailingIndicator(rest);
  return clean ? `${leading}: ${clean}` : leading;
}

function parseIndicator(value: string): Indicator {
  const clean = foldText(value.trim());
  if (clean.includes("/")) return clean;
  const number = Number.parseInt(clean, 10);
  return Number.isNaN(number) ? clean : number;
}

function parseTitle(title: string): { key: string; baseTitle: string; indicator: Indicator } {
  const original = stripNoise(title);
  const text = foldText(original);

  const decimalRegex = new RegExp(`^(${volumePattern})${prefixCapture}\\s*(\\d+)[.,](\\d+)(.*)$`, "i");
  const decimalMatch = text.match(decimalRegex);
  if (decimalMatch) {
    const volumePrefix = decimalMatch[1] || "";
    const prefix = decimalMatch[2] || "";
    const chapterNumber = decimalMatch[3];
    const indicator = Number.parseInt(decimalMatch[4], 10);
    const restStart = decimalMatch[0].length - decimalMatch[5].length;
    const originalRest = original.slice(restStart);
    const baseTitle = buildBaseTitle(original.slice(0, volumePrefix.length), prefix, chapterNumber, originalRest);
    const key = `${foldText(volumePrefix)}${foldText(normalizePrefixText(prefix))} ${chapterNumber}`;
    return { key, baseTitle, indicator };
  }

  const attachedRegex = new RegExp(`^(${volumePattern})${prefixCapture}\\s*(\\d+)\\.?([a-d])(?=\\s|[:\\-–—.,()[\\]<>（]|$)(.*)$`, "i");
  const attachedMatch = text.match(attachedRegex);
  if (attachedMatch) {
    const volumePrefix = attachedMatch[1] || "";
    const prefix = attachedMatch[2] || "";
    const chapterNumber = attachedMatch[3];
    const indicator = attachedMatch[4];
    const restStart = attachedMatch[0].length - attachedMatch[5].length;
    const originalRest = original.slice(restStart);
    const baseTitle = buildBaseTitle(original.slice(0, volumePrefix.length), prefix, chapterNumber, originalRest);
    const key = `${foldText(volumePrefix)}${foldText(normalizePrefixText(prefix))} ${chapterNumber}`;
    return { key, baseTitle, indicator };
  }

  const trailingBracket = new RegExp(
    `\\s*[\\(\\[（<]\\s*(?:phần|phan|part|tập|tap|cột|cot|trận|tran|chap)?\\s*(${indicatorPattern})\\s*[\\)\\]）>]\\s*$`,
    "i"
  );
  const trailingSuffix = new RegExp(
    `\\s*[-:–—\\s,.]+\\s*(?:phần|phan|part|tập|tap|cột|cot|trận|tran|chap|quyển|quyen)?\\s*(${indicatorPattern})\\s*$`,
    "i"
  );
  const trailingMatch = text.match(trailingBracket) || text.match(trailingSuffix);
  if (trailingMatch) {
    const baseFolded = cleanRest(text.slice(0, text.length - trailingMatch[0].length));
    const baseOriginal = cleanRest(original.slice(0, baseFolded.length));
    const chapterRegex = new RegExp(`^(${volumePattern})${prefixCapture}\\s*(\\d+)(.*)$`, "i");
    const chapterMatch = baseFolded.match(chapterRegex);

    if (chapterMatch) {
      const volumePrefix = chapterMatch[1] || "";
      const prefix = chapterMatch[2] || "";
      const chapterNumber = chapterMatch[3];
      const restStart = chapterMatch[0].length - chapterMatch[4].length;
      const originalRest = baseOriginal.slice(restStart);
      const baseTitle = buildBaseTitle(baseOriginal.slice(0, volumePrefix.length), prefix, chapterNumber, originalRest);
      const key = `${foldText(volumePrefix)}${foldText(normalizePrefixText(prefix))} ${chapterNumber}`;
      return { key, baseTitle, indicator: parseIndicator(trailingMatch[1]) };
    }

    return { key: baseFolded, baseTitle: baseOriginal, indicator: parseIndicator(trailingMatch[1]) };
  }

  return { key: "", baseTitle: original, indicator: null };
}

function titleQualityScore(title: string): number {
  const rest = title.split(":").slice(1).join(":");
  const suspiciousLowerL = (rest.match(/(^|[\s,;:])l(?=\s|$)/g) || []).length;
  const uppercaseI = (rest.match(/(^|[\s,;:])I(?=\s|$)/g) || []).length;
  return uppercaseI * 2 - suspiciousLowerL * 3;
}

function chooseGroupTitle(current: string | undefined, next: string): string {
  if (!current) return next;
  const currentScore = titleQualityScore(current);
  const nextScore = titleQualityScore(next);
  if (nextScore !== currentScore) return nextScore > currentScore ? next : current;
  if (next.length > current.length) return next;
  return current;
}

export function AutoMergeModal({
  open,
  bookId,
  chapters,
  onClose,
  onUpdateAnalysis,
  onSetBusy,
  onSetError
}: Props) {
  const detectedGroups = useMemo(() => {
    const groups: Record<string, ChapterWithIndicator[]> = {};
    const groupTitles: Record<string, string> = {};

    chapters.forEach((chapter) => {
      const parsed = parseTitle(chapter.title);
      if (!parsed.key || parsed.indicator === null) return;

      const item: ChapterWithIndicator = {
        ...chapter,
        indicator: parsed.indicator
      };

      if (!groups[parsed.key]) groups[parsed.key] = [];
      groups[parsed.key].push(item);
      groupTitles[parsed.key] = chooseGroupTitle(groupTitles[parsed.key], parsed.baseTitle);
    });

    const result: MergeGroup[] = [];
    for (const key of Object.keys(groups)) {
      if (groups[key].length < 2) continue;
      const sorted = [...groups[key]].sort((a, b) => {
        const rankA = getIndicatorRank(a.indicator);
        const rankB = getIndicatorRank(b.indicator);
        if (rankA !== rankB) return rankA - rankB;
        return a.index - b.index;
      });
      result.push({
        key,
        chapters: sorted,
        suggestedTitle: groupTitles[key]
      });
    }

    return result.sort((a, b) => a.chapters[0].index - b.chapters[0].index);
  }, [chapters]);

  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [customTitles, setCustomTitles] = useState<Record<string, string>>({});
  const [stripTitles, setStripTitles] = useState<Record<string, boolean>>({});
  const [excludedIndices, setExcludedIndices] = useState<Record<string, number[]>>({});

  React.useEffect(() => {
    setSelectedKeys(detectedGroups.map((group) => group.key));

    const titles: Record<string, string> = {};
    const strips: Record<string, boolean> = {};
    const excludes: Record<string, number[]> = {};

    detectedGroups.forEach((group) => {
      titles[group.key] = group.suggestedTitle;
      strips[group.key] = true;
      excludes[group.key] = [];
    });

    setCustomTitles(titles);
    setStripTitles(strips);
    setExcludedIndices(excludes);
  }, [detectedGroups]);

  if (!open) return null;

  const toggleGroupSelection = (key: string) => {
    setSelectedKeys((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  };

  const toggleStripTitle = (key: string) => {
    setStripTitles((current) => ({ ...current, [key]: !current[key] }));
  };

  const toggleExcludeChapter = (key: string, index: number) => {
    setExcludedIndices((current) => {
      const excluded = current[key] || [];
      return {
        ...current,
        [key]: excluded.includes(index) ? excluded.filter((item) => item !== index) : [...excluded, index]
      };
    });
  };

  const handleRunMerge = async () => {
    const groupsToMerge = detectedGroups.filter((group) => selectedKeys.includes(group.key));
    if (groupsToMerge.length === 0) return;

    const sortedGroups = [...groupsToMerge].sort((a, b) => b.chapters[0].index - a.chapters[0].index);
    const removedFromTOC = new Set<number>();
    const titleOverrides = new Map<number, string>();

    onSetBusy("Đang chuẩn bị gộp...");
    onSetError("");

    let currentAnalysis: any = null;
    let didMerge = false;

    try {
      for (let i = 0; i < sortedGroups.length; i++) {
        const group = sortedGroups[i];
        const title = customTitles[group.key]?.trim() || group.suggestedTitle;
        const strip = stripTitles[group.key] ?? true;
        const excluded = excludedIndices[group.key] || [];

        const mergeIndices = group.chapters.map((chapter) => chapter.index).filter((index) => !excluded.includes(index));
        if (mergeIndices.length < 2) continue;

        titleOverrides.set(mergeIndices[0], title);
        mergeIndices.slice(1).forEach((index) => removedFromTOC.add(index));

        onSetBusy(`Đang gộp nhóm: "${title}" (${i + 1}/${sortedGroups.length})...`);

        const res = await fetch(`/api/epubs/${encodeURIComponent(bookId)}/chapters/edit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "merge",
            mergeIndices,
            newTitle: title,
            stripMergedTitles: strip
          })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Lỗi khi gộp nhóm "${title}"`);
        }

        currentAnalysis = await res.json();
        didMerge = true;
      }

      if (didMerge) {
        onSetBusy("Đang cập nhật mục lục...");
        const tocNodes: TocNode[] = chapters
          .filter((chapter) => !removedFromTOC.has(chapter.index))
          .map((chapter) => ({
            title: titleOverrides.get(chapter.index) || chapter.title,
            href: chapter.href
          }));

        const tocRes = await fetch(`/api/epubs/${encodeURIComponent(bookId)}/toc`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(tocNodes)
        });

        if (!tocRes.ok) {
          const errData = await tocRes.json().catch(() => ({}));
          throw new Error(errData.error || "Lỗi khi cập nhật mục lục sau khi gộp");
        }

        currentAnalysis = await tocRes.json();
      }

      if (currentAnalysis) onUpdateAnalysis(currentAnalysis);
      onClose();
    } catch (err: any) {
      onSetError(err.message || "Lỗi trong quá trình tự động gộp");
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
        onMouseDown={(event) => event.stopPropagation()}
        style={{ width: "min(880px, 95vw)", height: "min(680px, 90dvh)", display: "flex", flexDirection: "column" }}
      >
        <header className="modalHeader">
          <div>
            <h3>Quét & gộp chương tự động</h3>
            <p>Tự động phát hiện các chương bị chia cắt như 1.1, 1.2, 10a, 10b hoặc phần 1, phần 2.</p>
          </div>
          <button className="iconButton" onClick={onClose} title="Đóng">
            <X size={18} />
          </button>
        </header>

        <div className="mergeBody" style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
          {detectedGroups.length === 0 ? (
            <div style={{ padding: "40px 0", textAlign: "center", color: "#8c8980" }}>
              <HelpCircle size={32} style={{ margin: "0 auto 8px", opacity: 0.5 }} />
              <p style={{ fontSize: "13px", fontWeight: "600" }}>Không phát hiện được chương phân mảnh nào.</p>
              <p style={{ fontSize: "11px", color: "#8c928e", marginTop: "4px" }}>
                Hệ thống quét tiêu đề dạng số thập phân, hậu tố chữ và các nhãn phần ở cuối tiêu đề.
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "12px", color: "#68655c", fontWeight: "600" }}>
                  Phát hiện {detectedGroups.length} nhóm chương có thể gộp:
                </span>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    className="smallButton"
                    onClick={() => setSelectedKeys(detectedGroups.map((group) => group.key))}
                    style={{ fontSize: "11px", height: "26px", padding: "0 10px" }}
                  >
                    Chọn tất cả
                  </button>
                  <button
                    type="button"
                    className="smallButton"
                    onClick={() => setSelectedKeys([])}
                    style={{ fontSize: "11px", height: "26px", padding: "0 10px" }}
                  >
                    Bỏ chọn tất cả
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                {detectedGroups.map((group) => {
                  const isSelected = selectedKeys.includes(group.key);
                  const title = customTitles[group.key] ?? group.suggestedTitle;
                  const strip = stripTitles[group.key] ?? true;
                  const excluded = excludedIndices[group.key] || [];

                  return (
                    <div
                      key={group.key}
                      style={{
                        border: isSelected ? "1px solid #2f7d69" : "1px solid #e5e2d9",
                        borderRadius: "8px",
                        background: isSelected ? "#f4faf7" : "#fffdf8",
                        padding: "16px",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
                        transition: "all 0.15s ease-in-out"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "12px" }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleGroupSelection(group.key)}
                          style={{ width: "16px", height: "16px", cursor: "pointer" }}
                        />
                        <span style={{ fontSize: "14px", fontWeight: "600", color: isSelected ? "#1f624d" : "#17201c" }}>
                          {group.suggestedTitle}
                        </span>
                        <span style={{ fontSize: "11px", color: "#687168", background: "#ebe8df", padding: "2px 8px", borderRadius: "12px", fontWeight: "500" }}>
                          {group.chapters.length} chương phân mảnh
                        </span>

                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginLeft: "auto" }}>
                          <span style={{ fontSize: "12px", fontWeight: "500", color: "#4d574f" }}>Tên chương sau gộp:</span>
                          <input
                            type="text"
                            value={title}
                            onChange={(event) => setCustomTitles((current) => ({ ...current, [group.key]: event.target.value }))}
                            disabled={!isSelected}
                            style={{
                              width: "260px",
                              height: "30px",
                              fontSize: "12px",
                              padding: "0 10px",
                              border: "1px solid #c9c6bd",
                              borderRadius: "6px",
                              background: isSelected ? "#fff" : "#f0ede4",
                              outline: "none",
                              color: "#17201c",
                              boxShadow: "inset 0 1px 2px rgba(0,0,0,0.05)"
                            }}
                          />
                        </div>
                      </div>

                      <div
                        style={{
                          background: "#fff",
                          border: "1px solid #e5e2d9",
                          borderRadius: "6px",
                          padding: "8px 12px",
                          fontSize: "12px",
                          maxHeight: "140px",
                          overflowY: "auto",
                          display: "flex",
                          flexDirection: "column",
                          gap: "6px",
                          boxShadow: "inset 0 1px 3px rgba(0,0,0,0.02)"
                        }}
                      >
                        {group.chapters.map((chapter) => {
                          const isExcluded = excluded.includes(chapter.index);
                          return (
                            <div
                              key={chapter.index}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                                textDecoration: isExcluded ? "line-through" : "none",
                                opacity: isExcluded ? 0.4 : 1
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={!isExcluded}
                                disabled={!isSelected}
                                onChange={() => toggleExcludeChapter(group.key, chapter.index)}
                                style={{ width: "14px", height: "14px", cursor: "pointer" }}
                              />
                              <span style={{ color: "#687168", width: "28px", fontWeight: "500" }}>#{chapter.index}</span>
                              <span style={{ fontWeight: 500, color: "#17201c" }}>{chapter.title}</span>
                              <span style={{ color: "#8c928e", marginLeft: "auto", fontSize: "11px" }}>{chapter.path}</span>
                            </div>
                          );
                        })}
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "10px" }}>
                        <input
                          type="checkbox"
                          id={`strip-${group.key}`}
                          checked={strip}
                          disabled={!isSelected}
                          onChange={() => toggleStripTitle(group.key)}
                          style={{ width: "14px", height: "14px", cursor: "pointer" }}
                        />
                        <label
                          htmlFor={`strip-${group.key}`}
                          style={{ fontSize: "12px", color: isSelected ? "#17201c" : "#8c928e", cursor: "pointer", userSelect: "none" }}
                        >
                          Tự động xoá tiêu đề chương phụ trong nội dung khi gộp
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
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
            onClick={handleRunMerge}
            disabled={selectedKeys.length === 0}
            style={{ gap: "6px" }}
          >
            <Combine size={14} />
            <span>Tiến hành gộp ({selectedKeys.length} nhóm)</span>
          </button>
        </footer>
      </section>
    </div>
  );
}
