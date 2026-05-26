// ==========================================
// Hako / DocLN EPUB Downloader Extension
// ==========================================

function register() {
  return {
    id: "hako2epub",
    name: "Hako Downloader",
    description: "Tải truyện chữ từ DocLN/Hako (docln.net, docln.sbs, ln.hako.vn) sau khi đăng nhập và đóng gói thành EPUB.",
    inputs: [
      {
        id: "url",
        type: "text",
        label: "Đường dẫn truyện",
        placeholder: "https://docln.net/truyen/24641-ten-truyen",
        required: true
      },
      {
        id: "username",
        type: "text",
        label: "Email / Tên đăng nhập",
        placeholder: "Nhập email hoặc username DocLN",
        required: true
      },
      {
        id: "password",
        type: "password",
        label: "Mật khẩu",
        placeholder: "Nhập mật khẩu",
        required: true
      },
      {
        id: "downloadMode",
        type: "select",
        label: "Chế độ tải",
        defaultValue: "all_volumes",
        options: [
          { value: "all_volumes", label: "1. Tải tất cả volume" },
          { value: "choose_volumes", label: "2. Chọn volume để tải" },
          { value: "single_chapter", label: "3. Tải 1 chương bằng link" },
          { value: "chapter_range", label: "4. Tải từ link A đến link B" }
        ],
        required: false
      },
      {
        id: "startChapterUrl",
        type: "text",
        label: "Link chương",
        placeholder: "Dán link chương cần tải.",
        visibleWhen: { downloadMode: ["single_chapter", "chapter_range"] },
        required: false
      },
      {
        id: "endChapterUrl",
        type: "text",
        label: "Link chương kết thúc",
        placeholder: "Chỉ hiện khi tải từ link A đến link B.",
        visibleWhen: { downloadMode: "chapter_range" },
        required: false
      }
    ]
  };
}

const HAKO_DEFAULT_BASE_URL = "https://docln.net";
const HAKO_SUPPORTED_HOSTS = {
  "docln.net": true,
  "docln.sbs": true,
  "ln.hako.vn": true
};

function htmlToText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, function(_, n) { return String.fromCharCode(parseInt(n, 10)); })
    .replace(/&#x([0-9a-f]+);/gi, function(_, n) { return String.fromCharCode(parseInt(n, 16)); });
}

function stripWWW(host) {
  return String(host || "").toLowerCase().replace(/^www\./, "");
}

function isSupportedHakoHost(host) {
  return !!HAKO_SUPPORTED_HOSTS[stripWWW(host)];
}

function normalizeHakoInputURL(input) {
  let value = decodeEntities(String(input || "").trim());
  if (value.indexOf("//") === 0) return "https:" + value;
  if (/^https?:\/\//i.test(value)) return value;

  const hostMatch = value.match(/^([^\/?#]+)(?:[\/?#]|$)/);
  if (hostMatch && isSupportedHakoHost(hostMatch[1])) {
    return "https://" + value;
  }
  return value;
}

function parseAbsoluteURL(url) {
  const match = String(url || "").match(/^(https?):\/\/([^\/?#]+)([\s\S]*)$/i);
  if (!match) return null;
  return {
    scheme: match[1].toLowerCase(),
    host: stripWWW(match[2]),
    rest: match[3] || ""
  };
}

function hakoOriginFromURL(input) {
  const normalized = normalizeHakoInputURL(input);
  const parts = parseAbsoluteURL(normalized);
  if (parts && isSupportedHakoHost(parts.host)) {
    return "https://" + parts.host;
  }
  return HAKO_DEFAULT_BASE_URL;
}

function rewriteHakoURLToBase(url, baseUrl) {
  const parts = parseAbsoluteURL(url);
  if (!parts || !isSupportedHakoHost(parts.host)) return url;
  return hakoOriginFromURL(baseUrl) + parts.rest;
}

function hakoPathFromURL(url) {
  const parts = parseAbsoluteURL(url);
  if (!parts) return "";
  return (parts.rest || "").split("#")[0].split("?")[0];
}

function hakoStoryRootFromURL(url) {
  const path = hakoPathFromURL(url);
  const match = path.match(/^\/([^\/?#]+)\/([^\/?#]+)/);
  if (!match) return "";
  return "/" + match[1] + "/" + match[2];
}

function isSameHakoStoryURL(url, pageUrl) {
  const parts = parseAbsoluteURL(url);
  if (!parts || !isSupportedHakoHost(parts.host)) return false;

  const root = hakoStoryRootFromURL(pageUrl);
  const path = hakoPathFromURL(url);
  if (!root) return /\/c\d+(?:[-\/]|$)|(?:^|\/)(?:chuong|chapter)(?:[-\/]|$)/i.test(path);
  return path === root || path.indexOf(root + "/") === 0;
}

function normalizeHakoContentHref(rawHref, pageUrl) {
  let value = decodeEntities(String(rawHref || "").trim());
  const root = hakoStoryRootFromURL(pageUrl);
  if (root && /^\/c\d+(?:[-\/]|$)/i.test(value)) {
    return hakoOriginFromURL(pageUrl) + root + value;
  }
  if (root && /^(?:\.\/)?c\d+(?:[-\/]|$)/i.test(value)) {
    return hakoOriginFromURL(pageUrl) + root + "/" + value.replace(/^\.\//, "");
  }
  return absolutize(value, pageUrl);
}

function isHakoChapterURL(url, pageUrl) {
  if (!isSameHakoStoryURL(url, pageUrl)) return false;
  const path = hakoPathFromURL(url);
  return /\/c\d+(?:[-\/]|$)|(?:^|\/)(?:chuong|chapter)(?:[-\/]|$)/i.test(path);
}

function attrValue(tag, name) {
  const re = new RegExp("\\b" + name + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1", "i");
  const match = String(tag || "").match(re);
  return match ? match[2] : "";
}

function extractInputValue(html, inputName) {
  const inputRegex = /<input\b[^>]*>/gi;
  let match;
  while ((match = inputRegex.exec(String(html || ""))) !== null) {
    const tag = match[0];
    if (attrValue(tag, "name") === inputName) {
      return attrValue(tag, "value");
    }
  }
  return "";
}

function absolutize(url, baseUrl) {
  if (!url) return "";
  let value = decodeEntities(String(url).trim());
  if (value.indexOf("//") === 0) value = "https:" + value;
  if (/^https?:\/\//i.test(value)) return rewriteHakoURLToBase(value, baseUrl || HAKO_DEFAULT_BASE_URL);
  const base = baseUrl || HAKO_DEFAULT_BASE_URL;
  const originMatch = base.match(/^(https?:\/\/[^\/]+)/i);
  const origin = originMatch ? hakoOriginFromURL(originMatch[1]) : HAKO_DEFAULT_BASE_URL;
  if (value.charAt(0) === "/") return origin + value;
  const cleanBase = base.replace(/[#?].*$/, "");
  const dir = /^https?:\/\/[^\/]+$/i.test(cleanBase) ? origin + "/" : cleanBase.replace(/\/[^\/]*$/, "/");
  return dir + value;
}

function isLoginPage(html) {
  const body = String(html || "");
  return /<form[^>]+action=["'][^"']*\/login["']/i.test(body) &&
    /name=["']password["']/i.test(body);
}

function isAuthenticatedPage(html) {
  const body = String(html || "");
  return /href=["'][^"']*\/logout/i.test(body) ||
    /action=["'][^"']*\/logout/i.test(body) ||
    /(?:Đăng xuất|Dang xuat|Logout)/i.test(body);
}

function extractLoginError(html) {
  const body = String(html || "");
  const known = body.match(/<div[^>]*class=["'][^"']*(?:red|danger|alert|error)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (known) {
    const message = htmlToText(known[1]);
    if (message) return message;
  }
  if (/thông tin đăng nhập|credentials|password|mật khẩu|không chính xác/i.test(body)) {
    const compact = htmlToText(body);
    const msg = compact.match(/([^.!?]*(?:thông tin đăng nhập|credentials|password|mật khẩu|không chính xác)[^.!?]*[.!?]?)/i);
    if (msg) return msg[1].trim();
  }
  return "";
}

function firstMatch(html, regex) {
  const match = String(html || "").match(regex);
  return match ? match[1] : "";
}

function extractStyleURL(style) {
  const match = String(style || "").match(/url\((['"]?)(.*?)\1\)/i);
  return match ? match[2] : "";
}

function extractMeta(html, propertyName) {
  const re = new RegExp("<meta\\b[^>]*(?:property|name)=['\"]" + propertyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "['\"][^>]*>", "i");
  const tag = String(html || "").match(re);
  return tag ? attrValue(tag[0], "content") : "";
}

function sanitizeHTML(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<p\b[^>]*style=["'][^"']*display\s*:\s*none[^"']*["'][^>]*>[\s\S]*?<\/p>/gi, "")
    .replace(/\s(?:onclick|onload|onerror|style|class|id|data-[a-z0-9_-]+)=(".*?"|'.*?'|[^\s>]+)/gi, "")
    .replace(/<a\b[^>]*href=["']#note[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeProtectedBytesBase64(text) {
  return utils.base64ToBytes(String(text || ""));
}

function decodeProtectedUTF8(bytes) {
  return utils.bytesToString(bytes);
}

function decodeProtectedChunk(chunk, strategy, key) {
  let payload = String(chunk || "").substring(4);
  if (strategy === "base64_reverse") {
    payload = payload.split("").reverse().join("");
  }
  const bytes = decodeProtectedBytesBase64(payload);
  if (strategy === "xor_shuffle") {
    const out = new Uint8Array(bytes.length);
    const xorKey = String(key || "");
    if (!xorKey) return "";
    for (let i = 0; i < bytes.length; i++) {
      out[i] = bytes[i] ^ xorKey.charCodeAt(i % xorKey.length);
    }
    return decodeProtectedUTF8(out);
  }
  return decodeProtectedUTF8(bytes);
}

function decodeProtectedChapterContent(html) {
  let source = String(html || "");
  const protectedTag = source.match(/<div\b[^>]*\bid=["']chapter-c-protected["'][^>]*>/i);
  if (!protectedTag) return source;

  const tag = protectedTag[0];
  const strategy = attrValue(tag, "data-s") || "none";
  const key = attrValue(tag, "data-k") || "";
  const rawChunks = decodeEntities(attrValue(tag, "data-c") || "[]");
  let chunks = [];
  try {
    chunks = JSON.parse(rawChunks);
  } catch (e) {
    return source;
  }
  if (!chunks || !chunks.length) return source;

  chunks.sort(function(a, b) {
    return parseInt(String(a).substring(0, 4), 10) - parseInt(String(b).substring(0, 4), 10);
  });

  let decoded = "";
  for (let i = 0; i < chunks.length; i++) {
    decoded += decodeProtectedChunk(chunks[i], strategy, key);
  }
  decoded = decoded.replace(/\[note(\d+)\]/gi, '<span id="anchor-note$1" class="note-icon">[note]</span>');

  const start = protectedTag.index;
  const openEnd = start + tag.length;
  const closeIdx = source.indexOf("</div>", openEnd);
  if (closeIdx < 0) {
    return source.slice(0, start) + decoded + source.slice(openEnd);
  }
  return source.slice(0, start) + decoded + source.slice(closeIdx + 6);
}

function innerById(html, id) {
  const lower = String(html || "").toLowerCase();
  const marker = 'id="' + id.toLowerCase() + '"';
  let idx = lower.indexOf(marker);
  if (idx < 0) {
    idx = lower.indexOf("id='" + id.toLowerCase() + "'");
  }
  if (idx < 0) return "";

  const startTagStart = lower.lastIndexOf("<", idx);
  const startTagEnd = lower.indexOf(">", idx);
  if (startTagStart < 0 || startTagEnd < 0) return "";

  const tagMatch = lower.slice(startTagStart, startTagEnd + 1).match(/^<([a-z0-9]+)/i);
  const tagName = tagMatch ? tagMatch[1] : "div";
  const openRe = new RegExp("<" + tagName + "\\b", "ig");
  const closeRe = new RegExp("</" + tagName + "\\s*>", "ig");
  openRe.lastIndex = startTagEnd + 1;
  closeRe.lastIndex = startTagEnd + 1;

  let depth = 1;
  while (depth > 0) {
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    if (!nextClose) return html.slice(startTagEnd + 1);
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      closeRe.lastIndex = openRe.lastIndex;
    } else {
      depth--;
      if (depth === 0) {
        return html.slice(startTagEnd + 1, nextClose.index);
      }
      openRe.lastIndex = closeRe.lastIndex;
    }
  }
  return "";
}

function extractTitle(html) {
  let title = firstMatch(html, /<span[^>]*class=["'][^"']*series-name[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
  if (!title) title = extractMeta(html, "og:title");
  if (!title) title = firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!title) title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  title = htmlToText(title).replace(/\s+-\s+Hako.*$/i, "").replace(/\s+-\s+DocLN.*$/i, "");
  return title || "Hako Novel";
}

function extractAuthor(html) {
  const infoMatch = String(html || "").match(/<div[^>]*class=["'][^"']*series-information[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
  const info = infoMatch ? infoMatch[1] : html;
  const authorByLabel = String(info || "").match(/(?:Tác giả|Author)[\s\S]{0,300}?<a\b[^>]*>([\s\S]*?)<\/a>/i);
  if (authorByLabel) return htmlToText(authorByLabel[1]) || "Unknown";
  const item = String(info || "").match(/<div[^>]*class=["'][^"']*info-item[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i);
  return item ? htmlToText(item[1]) : "Unknown";
}

function extractCoverURL(html, baseUrl) {
  const styleTags = String(html || "").match(/<div[^>]*class=["'][^"']*(?:series-cover|volume-cover|img-in-ratio)[^"']*["'][^>]*>/gi) || [];
  for (let i = 0; i < styleTags.length; i++) {
    const styleURL = extractStyleURL(attrValue(styleTags[i], "style"));
    if (styleURL) return absolutize(styleURL, baseUrl);
  }
  const ogImage = extractMeta(html, "og:image");
  if (ogImage) return absolutize(ogImage, baseUrl);
  const image = firstMatch(html, /<img\b[^>]*src=["']([^"']+)["'][^>]*>/i);
  return image ? absolutize(image, baseUrl) : "";
}

function collectChaptersFromHTML(html, pageUrl) {
  const chapters = [];
  const seen = {};

  function addChapter(rawHref, rawTitle) {
    if (!rawHref) return;
    const fullUrl = normalizeHakoContentHref(rawHref, pageUrl).replace(/#.*$/, "");
    if (seen[fullUrl]) return;
    if (!isHakoChapterURL(fullUrl, pageUrl)) return;

    let title = htmlToText(rawTitle);
    if (!title) title = "Chương " + (chapters.length + 1);
    const lowerTitle = title.toLowerCase();
    if (lowerTitle.indexOf("đọc tiếp") !== -1 || lowerTitle.indexOf("đọc từ đầu") !== -1) return;

    seen[fullUrl] = true;
    chapters.push({ title: title, url: fullUrl });
  }

  const listRegex = /<ul\b[^>]*class=["'][^"']*list-chapters[^"']*["'][^>]*>([\s\S]*?)<\/ul>/gi;
  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let listMatch;
  while ((listMatch = listRegex.exec(String(html || ""))) !== null) {
    const listHTML = listMatch[1];
    let anchorMatch;
    while ((anchorMatch = anchorRegex.exec(listHTML)) !== null) {
      addChapter(anchorMatch[1], anchorMatch[2]);
    }
  }

  if (chapters.length === 0) {
    let anchorMatch;
    while ((anchorMatch = anchorRegex.exec(String(html || ""))) !== null) {
      addChapter(anchorMatch[1], anchorMatch[2]);
    }
  }

  return chapters;
}

function collectVolumesFromHTML(html, pageUrl) {
  const volumes = [];
  const sectionRegex = /<section\b[^>]*class=["'][^"']*volume-list[^"']*["'][^>]*>([\s\S]*?)<\/section>/gi;
  let sectionMatch;
  while ((sectionMatch = sectionRegex.exec(String(html || ""))) !== null) {
    const sectionHTML = sectionMatch[1];
    const title = htmlToText(firstMatch(sectionHTML, /<span[^>]*class=["'][^"']*sect-title[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)) ||
      "Vol " + (volumes.length + 1);
    const cover = extractCoverURL(sectionHTML, pageUrl);
    const chapters = collectChaptersFromHTML(sectionHTML, pageUrl);
    if (chapters.length > 0) {
      volumes.push({
        index: volumes.length + 1,
        title: title,
        coverURL: cover,
        chapters: chapters
      });
    }
  }
  return volumes;
}

function collectVolumeLinks(html, pageUrl) {
  const links = [];
  const seen = {};
  const sectionRegex = /<section\b[^>]*class=["'][^"']*volume-list[^"']*["'][^>]*>([\s\S]*?)<\/section>/gi;
  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let sectionMatch;
  while ((sectionMatch = sectionRegex.exec(String(html || ""))) !== null) {
    const sectionHTML = sectionMatch[1];
    const sectionTitle = htmlToText(firstMatch(sectionHTML, /<span[^>]*class=["'][^"']*sect-title[^"']*["'][^>]*>([\s\S]*?)<\/span>/i));
    let anchorMatch;
    while ((anchorMatch = anchorRegex.exec(sectionHTML)) !== null) {
      const fullUrl = normalizeHakoContentHref(anchorMatch[1], pageUrl).replace(/#.*$/, "");
      if (seen[fullUrl]) continue;
      if (!isSameHakoStoryURL(fullUrl, pageUrl)) continue;
      if (isHakoChapterURL(fullUrl, pageUrl)) continue;
      seen[fullUrl] = true;
      links.push({ title: sectionTitle || htmlToText(anchorMatch[2]) || "Tập", url: fullUrl });
      break;
    }
  }
  return links;
}

function parseVolumeSelectionSpec(spec, volumeCount) {
  const text = String(spec || "").trim().toLowerCase();
  if (!text) return null;
  if (text === "all" || text === "*" || text === "tat ca" || text === "tất cả") {
    const all = [];
    for (let i = 1; i <= volumeCount; i++) all.push(String(i));
    return all;
  }

  const selected = {};
  const parts = text.split(/[,\s]+/);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].replace(/^vol(?:ume)?/i, "");
    if (!part) continue;
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      let start = parseInt(range[1], 10);
      let end = parseInt(range[2], 10);
      if (start > end) {
        const tmp = start;
        start = end;
        end = tmp;
      }
      for (let n = start; n <= end; n++) {
        if (n >= 1 && n <= volumeCount) selected[String(n)] = true;
      }
      continue;
    }
    const n = parseInt(part, 10);
    if (!isNaN(n) && n >= 1 && n <= volumeCount) {
      selected[String(n)] = true;
    }
  }

  const result = Object.keys(selected).sort(function(a, b) {
    return parseInt(a, 10) - parseInt(b, 10);
  });
  if (result.length === 0) {
    throw new Error("Không hiểu lựa chọn volume: " + spec);
  }
  return result;
}

function normalizeDownloadMode(params) {
  const mode = String(params.downloadMode || "").trim().toLowerCase();
  if (mode === "choose_volumes" || mode === "single_chapter" || mode === "chapter_range") {
    return mode;
  }
  return "all_volumes";
}

function chapterSortKey(url) {
  const cMatch = String(url || "").match(/\/c(\d+)/i);
  if (cMatch) return parseInt(cMatch[1], 10);
  const allNums = String(url || "").match(/\d+/g);
  return allNums && allNums.length ? parseInt(allNums[allNums.length - 1], 10) : 0;
}

function normalizeChapterURLForMatch(rawUrl, baseUrl) {
  const text = String(rawUrl || "").trim();
  if (!text) return "";
  return normalizeHakoContentHref(text, baseUrl)
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function findChapterIndexByURL(chapters, rawUrl, baseUrl) {
  const target = normalizeChapterURLForMatch(rawUrl, baseUrl);
  if (!target) return -1;
  for (let i = 0; i < chapters.length; i++) {
    if (normalizeChapterURLForMatch(chapters[i].url, baseUrl) === target) {
      return i;
    }
  }
  return -1;
}

function chapterURLRangeParams(params) {
  const mode = normalizeDownloadMode(params);
  let startUrl = String(params.startChapterUrl || "").trim();
  let endUrl = String(params.endChapterUrl || "").trim();
  if (mode === "all_volumes" || mode === "choose_volumes") {
    return { startUrl: "", endUrl: "" };
  }
  if (mode === "single_chapter") {
    if (!startUrl) throw new Error("Mode 3 can link chuong can tai.");
    endUrl = startUrl;
  }
  if (mode === "chapter_range" && (!startUrl || !endUrl)) {
    throw new Error("Mode 4 can ca link chuong bat dau va link chuong ket thuc.");
  }
  const normalizedStart = /^https?:\/\//i.test(startUrl) || startUrl.indexOf("/") === 0 ? startUrl : "";
  const normalizedEnd = /^https?:\/\//i.test(endUrl) || endUrl.indexOf("/") === 0 ? endUrl : "";
  if ((mode === "single_chapter" || mode === "chapter_range") && (!normalizedStart || !normalizedEnd)) {
    throw new Error("Link chuong khong hop le. Hay dan link day du cua Hako/DocLN.");
  }
  return {
    startUrl: normalizedStart,
    endUrl: normalizedEnd
  };
}

function applyChapterURLRangeToChapters(chapters, params, baseUrl, label) {
  const range = chapterURLRangeParams(params);
  if (!range.startUrl && !range.endUrl) return chapters;

  let startIdx = range.startUrl ? findChapterIndexByURL(chapters, range.startUrl, baseUrl) : 0;
  let endIdx = range.endUrl ? findChapterIndexByURL(chapters, range.endUrl, baseUrl) : chapters.length - 1;
  if (startIdx < 0) throw new Error("Khong tim thay link chuong bat dau trong " + label + ": " + range.startUrl);
  if (endIdx < 0) throw new Error("Khong tim thay link chuong ket thuc trong " + label + ": " + range.endUrl);
  if (startIdx > endIdx) {
    const tmp = startIdx;
    startIdx = endIdx;
    endIdx = tmp;
  }

  const selected = chapters.slice(startIdx, endIdx + 1);
  console.log("[*] " + label + ": da chon tai tu #" + (startIdx + 1) + " den #" + (endIdx + 1) + " (" + selected.length + " chuong).");
  return selected;
}

function applyChapterURLRangeToVolumes(volumes, params, baseUrl) {
  const range = chapterURLRangeParams(params);
  if (!range.startUrl && !range.endUrl) return volumes;

  const flat = [];
  for (let v = 0; v < volumes.length; v++) {
    const chapters = volumes[v].chapters || [];
    for (let c = 0; c < chapters.length; c++) {
      flat.push({ volumeIndex: v, chapterIndex: c, chapter: chapters[c] });
    }
  }
  if (flat.length === 0) return volumes;

  let startFlat = 0;
  let endFlat = flat.length - 1;
  if (range.startUrl) {
    startFlat = -1;
    for (let i = 0; i < flat.length; i++) {
      if (normalizeChapterURLForMatch(flat[i].chapter.url, baseUrl) === normalizeChapterURLForMatch(range.startUrl, baseUrl)) {
        startFlat = i;
        break;
      }
    }
    if (startFlat < 0) throw new Error("Khong tim thay link chuong bat dau trong cac volume da chon: " + range.startUrl);
  }
  if (range.endUrl) {
    endFlat = -1;
    for (let i = 0; i < flat.length; i++) {
      if (normalizeChapterURLForMatch(flat[i].chapter.url, baseUrl) === normalizeChapterURLForMatch(range.endUrl, baseUrl)) {
        endFlat = i;
        break;
      }
    }
    if (endFlat < 0) throw new Error("Khong tim thay link chuong ket thuc trong cac volume da chon: " + range.endUrl);
  }
  if (startFlat > endFlat) {
    const tmp = startFlat;
    startFlat = endFlat;
    endFlat = tmp;
  }

  const byVolume = {};
  for (let i = startFlat; i <= endFlat; i++) {
    const item = flat[i];
    const key = String(item.volumeIndex);
    if (!byVolume[key]) byVolume[key] = [];
    byVolume[key].push(item.chapter);
  }

  const selectedVolumes = [];
  for (let v = 0; v < volumes.length; v++) {
    const selectedChapters = byVolume[String(v)] || [];
    if (selectedChapters.length === 0) continue;
    const clone = {};
    for (const key in volumes[v]) clone[key] = volumes[v][key];
    clone.chapters = selectedChapters;
    selectedVolumes.push(clone);
  }
  console.log("[*] Da chon tai tu chapter link #" + (startFlat + 1) + " den #" + (endFlat + 1) + " tren cac volume da chon (" + (endFlat - startFlat + 1) + " chuong).");
  return selectedVolumes;
}

function getExtFromURL(url) {
  const clean = String(url || "").split("?")[0].split("#")[0];
  const ext = clean.split(".").pop().toLowerCase();
  if (ext === "jpg" || ext === "jpeg" || ext === "png" || ext === "gif" || ext === "webp") return ext;
  return "jpg";
}

function mimeFromExt(ext) {
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

function responseHeader(resp, name) {
  const headers = resp && resp.Headers ? resp.Headers : (resp && resp.headers ? resp.headers : null);
  if (!headers) return "";
  const target = String(name || "").toLowerCase();
  for (const key in headers) {
    if (String(key).toLowerCase() === target) {
      return String(headers[key]);
    }
  }
  return "";
}

function rateLimitWaitMs(resp, fallbackMs) {
  const remainingText = responseHeader(resp, "x-ratelimit-remaining");
  if (!remainingText) return fallbackMs;

  const remaining = parseInt(remainingText, 10);
  if (isNaN(remaining)) return fallbackMs;
  if (remaining <= 0) {
    const retryAfter = parseInt(responseHeader(resp, "retry-after"), 10);
    if (!isNaN(retryAfter) && retryAfter > 0) {
      return Math.min(retryAfter * 1000, 60000);
    }

    const reset = parseInt(responseHeader(resp, "x-ratelimit-reset"), 10);
    if (!isNaN(reset) && reset > 0) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const resetDelay = reset > nowSeconds ? (reset - nowSeconds) * 1000 : reset * 1000;
      return Math.min(Math.max(resetDelay, 5000), 60000);
    }
    return 10000;
  }
  if (remaining <= 2) return 5000;
  if (remaining <= 5) return 2500;
  if (remaining <= 10) return 1200;
  return fallbackMs;
}

function waitAfterHakoResponse(resp, fallbackMs) {
  const waitMs = rateLimitWaitMs(resp, fallbackMs);
  if (waitMs > fallbackMs) {
    const remaining = responseHeader(resp, "x-ratelimit-remaining");
    console.log("[*] Hako rate-limit remaining=" + remaining + ", doi " + Math.round(waitMs / 1000) + "s truoc request tiep theo.");
  }
  utils.sleep(waitMs);
}

function run(params) {
  const baseUrl = hakoOriginFromURL(params.url);
  const session = http.newSession();
  const storyUrl = absolutize(normalizeHakoInputURL(params.url), baseUrl);

  console.log("[*] Hako domain: " + baseUrl);
  console.log("[*] Đang mở trang đăng nhập Hako...");
  const loginUrl = baseUrl + "/login";
  const loginPage = session.Get(loginUrl, {});
  if (!loginPage || loginPage.Status !== 200) {
    throw new Error("Không thể tải trang đăng nhập. HTTP Status: " + (loginPage ? loginPage.Status : "không có phản hồi"));
  }

  if (isAuthenticatedPage(loginPage.Body)) {
    console.log("[*] Existing Hako login session detected; skipping login POST.");
  } else {
    const csrfToken = extractInputValue(loginPage.Body, "_token");
    if (!csrfToken) {
      throw new Error("Không tìm thấy CSRF _token trên trang đăng nhập.");
    }

    const loginResp = session.Post(loginUrl, {
      _token: csrfToken,
      name: params.username,
      password: params.password,
      remember: "on"
    }, {
      "Referer": loginUrl,
      "Content-Type": "application/x-www-form-urlencoded"
    });

    if (!loginResp) {
      throw new Error("Đăng nhập thất bại: không nhận được phản hồi từ máy chủ.");
    }
    if (loginResp.Status >= 400) {
      throw new Error("Đăng nhập thất bại. HTTP Status: " + loginResp.Status);
    }
    const loginError = extractLoginError(loginResp.Body);
    if (loginError || isLoginPage(loginResp.Body)) {
      throw new Error(loginError ? "Đăng nhập thất bại: " + loginError : "Đăng nhập thất bại. Tài khoản hoặc mật khẩu không đúng, hoặc phiên đăng nhập đã hết hạn.");
    }
  }
  console.log("[+] Đăng nhập Hako thành công!");

  console.log("[*] Đang tải trang truyện: " + storyUrl);
  const seriesResp = session.Get(storyUrl, {});
  if (!seriesResp || seriesResp.Status !== 200) {
    throw new Error("Không thể tải trang truyện. HTTP Status: " + (seriesResp ? seriesResp.Status : "không có phản hồi"));
  }
  if (isLoginPage(seriesResp.Body)) {
    throw new Error("Đăng nhập thất bại hoặc phiên đăng nhập không còn hợp lệ.");
  }

  const title = extractTitle(seriesResp.Body);
  const author = extractAuthor(seriesResp.Body);
  const coverURL = extractCoverURL(seriesResp.Body, storyUrl);
  console.log("[*] Tên truyện: " + title);
  console.log("[*] Tác giả: " + author);

  const volumes = collectVolumesFromHTML(seriesResp.Body, storyUrl);

  function buildVolumeEbook(volume) {
    let volumeChapters = volume.chapters || [];
    const unique = [];
    const seenURLs = {};
    for (let i = 0; i < volumeChapters.length; i++) {
      if (!seenURLs[volumeChapters[i].url]) {
        unique.push(volumeChapters[i]);
        seenURLs[volumeChapters[i].url] = true;
      }
    }
    volumeChapters = unique;
    volumeChapters.sort(function(a, b) {
      return chapterSortKey(a.url) - chapterSortKey(b.url);
    });

    console.log("[+] Volume " + volume.title + " có " + volumeChapters.length + " chương.");
    if (volumeChapters.length === 0) {
      throw new Error("Không tìm thấy chương truyện nào trong volume: " + volume.title);
    }

    const volumeTitle = volume.title || ("Vol " + volume.index);
    const effectiveCoverURL = volume.coverURL || coverURL;
    let coverImage = "";
    if (effectiveCoverURL) {
      try {
        const ext = getExtFromURL(effectiveCoverURL);
        const coverBase64 = session.GetBinaryBase64(effectiveCoverURL, { "Referer": storyUrl });
        if (coverBase64) {
          coverImage = "data:" + mimeFromExt(ext) + ";base64," + coverBase64;
          console.log("[+] Đã tải ảnh bìa cho " + volumeTitle + ".");
        }
      } catch (e) {
        console.log("[-] Không tải được ảnh bìa cho " + volumeTitle + ": " + e.message);
      }
    }

    const resultChapters = [];
    const resultImages = {};
    let imageCounter = 1;

    for (let i = 0; i < volumeChapters.length; i++) {
      const chap = volumeChapters[i];
      console.log("  -> " + volumeTitle + " [" + (i + 1) + "/" + volumeChapters.length + "]: " + chap.title);
      const chapResp = session.Get(chap.url, {});
      if (!chapResp || chapResp.Status !== 200) {
        throw new Error("Không thể tải chương: " + chap.title + ". HTTP Status: " + (chapResp ? chapResp.Status : "không phản hồi"));
      }
      if (isLoginPage(chapResp.Body)) {
        throw new Error("Phiên đăng nhập hết hạn khi tải chương: " + chap.title);
      }

      const pageTitle = htmlToText(firstMatch(chapResp.Body, /<div[^>]*class=["'][^"']*title-top[^"']*["'][^>]*>[\s\S]*?<h4[^>]*>([\s\S]*?)<\/h4>/i)) ||
        htmlToText(firstMatch(chapResp.Body, /<h1[^>]*>([\s\S]*?)<\/h1>/i)) ||
        chap.title;

      let content = innerById(chapResp.Body, "chapter-content");
      content = decodeProtectedChapterContent(content);
      if (!content || (!/<img\b/i.test(content) && htmlToText(content).length < 20)) {
        content = firstMatch(chapResp.Body, /<div[^>]*id=["']chapter-c-protected["'][^>]*>([\s\S]*?)<\/div>/i);
        content = decodeProtectedChapterContent(content);
      }
      if (!content || (!/<img\b/i.test(content) && htmlToText(content).length < 5)) {
        throw new Error("Không tìm thấy nội dung chương hoặc nội dung bị khóa: " + pageTitle);
      }

      content = sanitizeHTML(content);
      const imgRegex = /<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi;
      const imageSources = [];
      let imgMatch;
      while ((imgMatch = imgRegex.exec(content)) !== null) {
        const src = imgMatch[1];
        if (src && src.indexOf("chapter-banners") === -1 && imageSources.indexOf(src) === -1) {
          imageSources.push(src);
        }
      }

      const downloaded = {};
      const failed = {};
      for (let img = 0; img < imageSources.length; img++) {
        const src = imageSources[img];
        const fullImgURL = absolutize(src, chap.url);
        try {
          const base64 = session.GetBinaryBase64(fullImgURL, { "Referer": chap.url });
          if (base64) {
            const ext = getExtFromURL(fullImgURL);
            const internalPath = "images/hako_v" + volume.index + "_" + imageCounter + "." + ext;
            resultImages[internalPath] = base64;
            downloaded[src] = internalPath;
            imageCounter++;
          }
        } catch (e) {
          failed[src] = true;
          console.log("  [*] Bỏ qua ảnh không tải được: " + fullImgURL + " (" + e.message + ")");
        }
      }

      content = content.replace(imgRegex, function(tag, src) {
        if (downloaded[src]) {
          return tag.replace(src, downloaded[src]);
        }
        if (failed[src] || String(src).indexOf("chapter-banners") !== -1) {
          return "";
        }
        return tag;
      });

      if (!/<(p|div|br|img|h[1-6])\b/i.test(content)) {
        content = "<p>" + htmlToText(content) + "</p>";
      }

      resultChapters.push({
        id: "vol_" + volume.index + "_chap_" + (resultChapters.length + 1),
        title: pageTitle,
        text: content,
        rawHtml: true
      });
      waitAfterHakoResponse(chapResp, 700);
    }

    if (resultChapters.length === 0) {
      throw new Error("Không tải được chương nào trong volume: " + volumeTitle);
    }

    console.log("[+] Đã tải thành công " + resultChapters.length + " chương cho " + volumeTitle + ".");
    return {
      title: volumeTitle,
      author: author,
      metadata: {
        title: volumeTitle,
        creator: author,
        language: "vi",
        publisher: "Hako / DocLN",
        description: htmlToText(firstMatch(seriesResp.Body, /<div[^>]*class=["'][^"']*summary-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)),
        series: title,
        seriesIndex: String(volume.index || ""),
        coverImage: coverImage
      },
      chapters: resultChapters,
      images: resultImages
    };
  }

  if (volumes.length > 0) {
    console.log("[+] Đã tìm thấy " + volumes.length + " volume.");
    for (let v = 0; v < volumes.length; v++) {
      console.log("  [" + volumes[v].index + "] " + volumes[v].title + " (" + volumes[v].chapters.length + " chương)");
    }

    const downloadMode = normalizeDownloadMode(params);
    let selectedVolumeIDs = parseVolumeSelectionSpec(downloadMode === "choose_volumes" ? "" : "all", volumes.length);
    if (downloadMode === "choose_volumes") {
      const options = [];
      for (let v = 0; v < volumes.length; v++) {
        options.push({
          id: String(volumes[v].index),
          label: "[" + volumes[v].index + "] " + volumes[v].title,
          description: volumes[v].chapters.length + " chương"
        });
      }
      selectedVolumeIDs = utils.choose("Chọn volume Hako muốn tải", options, true);
    }

    const selectedMap = {};
    for (let i = 0; i < selectedVolumeIDs.length; i++) {
      selectedMap[String(selectedVolumeIDs[i])] = true;
    }

    let selectedVolumes = [];
    for (let v = 0; v < volumes.length; v++) {
      if (selectedMap[String(volumes[v].index)]) {
        selectedVolumes.push(volumes[v]);
      }
    }
    if (selectedVolumes.length === 0) {
      throw new Error("Không có volume hợp lệ nào được chọn.");
    }

    selectedVolumes = applyChapterURLRangeToVolumes(selectedVolumes, params, storyUrl);
    if (selectedVolumes.length === 0) {
      throw new Error("Khong co chuong nao nam trong khoang link da chon.");
    }

    console.log("[*] Sẽ tải " + selectedVolumes.length + " volume thành các EPUB riêng.");
    const ebooks = [];
    for (let v = 0; v < selectedVolumes.length; v++) {
      ebooks.push(buildVolumeEbook(selectedVolumes[v]));
    }
    return { ebooks: ebooks };
  }

  let chapters = collectChaptersFromHTML(seriesResp.Body, storyUrl);

  const unique = [];
  const seenURLs = {};
  for (let i = 0; i < chapters.length; i++) {
    if (!seenURLs[chapters[i].url]) {
      unique.push(chapters[i]);
      seenURLs[chapters[i].url] = true;
    }
  }
  chapters = unique;
  chapters.sort(function(a, b) {
    return chapterSortKey(a.url) - chapterSortKey(b.url);
  });

  console.log("[+] Đã tìm thấy tổng cộng " + chapters.length + " chương.");
  if (chapters.length === 0) {
    throw new Error("Không tìm thấy chương truyện nào để tải.");
  }

  chapters = applyChapterURLRangeToChapters(chapters, params, storyUrl, "truyen");

  const effectiveCoverURL = coverURL;
  let coverImage = "";
  if (effectiveCoverURL) {
    try {
      const ext = getExtFromURL(effectiveCoverURL);
      const coverBase64 = session.GetBinaryBase64(effectiveCoverURL, { "Referer": storyUrl });
      if (coverBase64) {
        coverImage = "data:" + mimeFromExt(ext) + ";base64," + coverBase64;
        console.log("[+] Đã tải ảnh bìa thành công.");
      }
    } catch (e) {
      console.log("[-] Không tải được ảnh bìa: " + e.message);
    }
  }

  const resultChapters = [];
  const resultImages = {};
  let imageCounter = 1;

  for (let i = 0; i < chapters.length; i++) {
    const chap = chapters[i];
    console.log("  -> Đang tải [" + (i + 1) + "/" + chapters.length + "]: " + chap.title);
    const chapResp = session.Get(chap.url, {});
    if (!chapResp || chapResp.Status !== 200) {
      throw new Error("Không thể tải chương: " + chap.title + ". HTTP Status: " + (chapResp ? chapResp.Status : "không phản hồi"));
    }
    if (isLoginPage(chapResp.Body)) {
      throw new Error("Phiên đăng nhập hết hạn khi tải chương: " + chap.title);
    }

    const pageTitle = htmlToText(firstMatch(chapResp.Body, /<div[^>]*class=["'][^"']*title-top[^"']*["'][^>]*>[\s\S]*?<h4[^>]*>([\s\S]*?)<\/h4>/i)) ||
      htmlToText(firstMatch(chapResp.Body, /<h1[^>]*>([\s\S]*?)<\/h1>/i)) ||
      chap.title;

    let content = innerById(chapResp.Body, "chapter-content");
    content = decodeProtectedChapterContent(content);
    if (!content || (!/<img\b/i.test(content) && htmlToText(content).length < 20)) {
      content = firstMatch(chapResp.Body, /<div[^>]*id=["']chapter-c-protected["'][^>]*>([\s\S]*?)<\/div>/i);
      content = decodeProtectedChapterContent(content);
    }
    if (!content || (!/<img\b/i.test(content) && htmlToText(content).length < 5)) {
      throw new Error("Không tìm thấy nội dung chương hoặc nội dung bị khóa: " + pageTitle);
    }

    content = sanitizeHTML(content);
    const imgRegex = /<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi;
    const imageSources = [];
    let imgMatch;
    while ((imgMatch = imgRegex.exec(content)) !== null) {
      const src = imgMatch[1];
      if (src && src.indexOf("chapter-banners") === -1 && imageSources.indexOf(src) === -1) {
        imageSources.push(src);
      }
    }

    const downloaded = {};
    const failed = {};
    for (let img = 0; img < imageSources.length; img++) {
      const src = imageSources[img];
      const fullImgURL = absolutize(src, chap.url);
      try {
        const base64 = session.GetBinaryBase64(fullImgURL, { "Referer": chap.url });
        if (base64) {
          const ext = getExtFromURL(fullImgURL);
          const internalPath = "images/hako_" + imageCounter + "." + ext;
          resultImages[internalPath] = base64;
          downloaded[src] = internalPath;
          imageCounter++;
        }
      } catch (e) {
        failed[src] = true;
        console.log("  [*] Bỏ qua ảnh không tải được: " + fullImgURL + " (" + e.message + ")");
      }
    }

    content = content.replace(imgRegex, function(tag, src) {
      if (downloaded[src]) {
        return tag.replace(src, downloaded[src]);
      }
      if (failed[src] || String(src).indexOf("chapter-banners") !== -1) {
        return "";
      }
      return tag;
    });

    if (!/<(p|div|br|img|h[1-6])\b/i.test(content)) {
      content = "<p>" + htmlToText(content) + "</p>";
    }

    resultChapters.push({
      id: "chap_" + (resultChapters.length + 1),
      title: pageTitle,
      text: content,
      rawHtml: true
    });
    waitAfterHakoResponse(chapResp, 700);
  }

  if (resultChapters.length === 0) {
    throw new Error("Không tải được chương nào.");
  }

  console.log("[+] Đã tải thành công " + resultChapters.length + " chương.");
  return {
    title: title,
    author: author,
    metadata: {
      title: title,
      creator: author,
      language: "vi",
      publisher: "Hako / DocLN",
      description: htmlToText(firstMatch(seriesResp.Body, /<div[^>]*class=["'][^"']*summary-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)),
      coverImage: coverImage
    },
    chapters: resultChapters,
    images: resultImages
  };
}
