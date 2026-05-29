// ==========================================
// Valvrareteam EPUB Downloader Extension
// ==========================================

function register() {
  return {
    id: "valvrareteam2epub",
    name: "Valvrareteam Downloader",
    description: "Tải truyện chữ từ valvrareteam.net và đóng gói thành EPUB riêng cho từng tập.",
    inputs: [
      {
        id: "url",
        type: "text",
        label: "Đường dẫn truyện",
        placeholder: "https://valvrareteam.net/truyen/no-game-no-life-cd23c8d9",
        required: true
      },
      {
        id: "username",
        type: "text",
        label: "Tài khoản Valvrareteam",
        placeholder: "Email hoặc tên đăng nhập, bỏ trống nếu chỉ tải chương công khai.",
        required: false
      },
      {
        id: "password",
        type: "password",
        label: "Mật khẩu Valvrareteam",
        placeholder: "Nhập mật khẩu để mở chương bảo mật.",
        required: false
      },
      {
        id: "downloadMode",
        type: "select",
        label: "Chế độ tải",
        defaultValue: "all_volumes",
        options: [
          { value: "all_volumes", label: "1. Tải tất cả tập" },
          { value: "choose_volumes", label: "2. Chọn tập để tải" },
          { value: "single_chapter", label: "3. Tải 1 chương bằng link" },
          { value: "chapter_range", label: "4. Tải từ link A đến link B" }
        ],
        required: false
      },
      {
        id: "volumeSelection",
        type: "text",
        label: "Chọn tập",
        placeholder: "VD: all, 1, 1-3, 1,3. Bỏ trống để chọn trên UI.",
        visibleWhen: { downloadMode: "choose_volumes" },
        required: false
      },
      {
        id: "startChapterUrl",
        type: "text",
        label: "Link chương bắt đầu",
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

const VALVRARE_BASE_URL = "https://valvrareteam.net";
const VALVRARE_HOST = "valvrareteam.net";
const VALVRARE_DIRECT_API_BASE_URL = "https://val-ssr-2kzit.ondigitalocean.app";

function htmlToText(html) {
  return decodeEntities(String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " "))
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
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, function(_, n) { return String.fromCharCode(parseInt(n, 10)); })
    .replace(/&#x([0-9a-f]+);/gi, function(_, n) { return String.fromCharCode(parseInt(n, 16)); });
}

function stripWWW(host) {
  return String(host || "").toLowerCase().replace(/^www\./, "");
}

function normalizeValvrareInputURL(input) {
  let value = decodeEntities(String(input || "").trim());
  if (value.indexOf("//") === 0) return "https:" + value;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^(?:www\.)?valvrareteam\.net(?:[\/?#]|$)/i.test(value)) return "https://" + value;
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

function valvrareOriginFromURL(url) {
  const parts = parseAbsoluteURL(normalizeValvrareInputURL(url));
  if (parts && parts.host === VALVRARE_HOST) return parts.scheme + "://" + parts.host;
  return VALVRARE_BASE_URL;
}

function absolutize(url, baseUrl) {
  if (!url) return "";
  let value = decodeEntities(String(url).trim());
  if (value.indexOf("//") === 0) value = "https:" + value;
  if (/^https?:\/\//i.test(value)) return value;

  const base = baseUrl || VALVRARE_BASE_URL;
  const originMatch = base.match(/^(https?:\/\/[^\/]+)/i);
  const origin = originMatch ? originMatch[1] : VALVRARE_BASE_URL;
  if (value.charAt(0) === "/") return origin + value;

  const cleanBase = base.replace(/[?#].*$/, "");
  const dir = /^https?:\/\/[^\/]+$/i.test(cleanBase) ? origin + "/" : cleanBase.replace(/\/[^\/]*$/, "/");
  return dir + value;
}

function attrValue(tag, name) {
  const re = new RegExp("\\b" + name + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1", "i");
  const match = String(tag || "").match(re);
  return match ? decodeEntities(match[2]) : "";
}

function firstMatch(html, regex) {
  const match = String(html || "").match(regex);
  return match ? match[1] : "";
}

function extractMeta(html, propertyName) {
  const escaped = propertyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("<meta\\b[^>]*(?:property|name)=['\"]" + escaped + "['\"][^>]*>", "i");
  const tag = String(html || "").match(re);
  return tag ? attrValue(tag[0], "content") : "";
}

function hasClassToken(tag, className) {
  const cls = attrValue(tag, "class");
  if (!cls) return false;
  const parts = cls.split(/\s+/);
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === className) return true;
  }
  return false;
}

function innerFromTagAt(html, startTagStart, startTagEnd, tagName) {
  const source = String(html || "");
  const lowerTag = String(tagName || "div").toLowerCase();
  const openCloseRe = new RegExp("</?" + lowerTag + "\\b[^>]*>", "ig");
  openCloseRe.lastIndex = startTagEnd;

  let depth = 1;
  let match;
  while ((match = openCloseRe.exec(source)) !== null) {
    const tag = match[0];
    if (/^<\//.test(tag)) {
      depth--;
      if (depth === 0) {
        return source.slice(startTagEnd, match.index);
      }
    } else if (!/\/>$/.test(tag)) {
      depth++;
    }
  }
  return source.slice(startTagEnd);
}

function innerByClass(html, className) {
  const source = String(html || "");
  const tagRe = /<([a-z0-9]+)\b[^>]*>/ig;
  let match;
  while ((match = tagRe.exec(source)) !== null) {
    if (!hasClassToken(match[0], className)) continue;
    return innerFromTagAt(source, match.index, tagRe.lastIndex, match[1]);
  }
  return "";
}

function extractJSONLD(html) {
  const scripts = [];
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(String(html || ""))) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;
    try {
      scripts.push(JSON.parse(raw));
    } catch (e) {
    }
  }
  return scripts;
}

function findBookJSONLD(html) {
  const scripts = extractJSONLD(html);
  for (let i = 0; i < scripts.length; i++) {
    const data = scripts[i];
    if (!data) continue;
    if (data["@type"] === "Book") return data;
    if (Array.isArray(data["@graph"])) {
      for (let j = 0; j < data["@graph"].length; j++) {
        if (data["@graph"][j] && data["@graph"][j]["@type"] === "Book") return data["@graph"][j];
      }
    }
  }
  return null;
}

function decodeNextFlightEscapes(html) {
  return String(html || "")
    .replace(/\\u003c/g, "<")
    .replace(/\\u003e/g, ">")
    .replace(/\\u0026/g, "&")
    .replace(/\\u0022/g, '"')
    .replace(/\\u0027/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t");
}

function extractBalanced(source, startIndex, openChar, closeChar) {
  const text = String(source || "");
  let start = text.indexOf(openChar, startIndex);
  if (start < 0) return "";

  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text.charAt(i);
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        quote = "";
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === openChar) {
      depth++;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return "";
}

function extractModulesFromHTML(html) {
  const decoded = decodeNextFlightEscapes(html);
  const markerIndex = decoded.indexOf('"modules":');
  if (markerIndex < 0) return [];

  const raw = extractBalanced(decoded, markerIndex, "[", "]");
  if (!raw) return [];
  try {
    const modules = JSON.parse(raw);
    return Array.isArray(modules) ? modules : [];
  } catch (e) {
    console.log("[-] Khong parse duoc module JSON cua Valvrareteam: " + e.message);
    return [];
  }
}

function removeVietnameseMarks(text) {
  let s = String(text || "");
  const map = {
    a: "àáạảãâầấậẩẫăằắặẳẵ",
    A: "ÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴ",
    e: "èéẹẻẽêềếệểễ",
    E: "ÈÉẸẺẼÊỀẾỆỂỄ",
    i: "ìíịỉĩ",
    I: "ÌÍỊỈĨ",
    o: "òóọỏõôồốộổỗơờớợởỡ",
    O: "ÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠ",
    u: "ùúụủũưừứựửữ",
    U: "ÙÚỤỦŨƯỪỨỰỬỮ",
    y: "ỳýỵỷỹ",
    Y: "ỲÝỴỶỸ",
    d: "đ",
    D: "Đ"
  };
  for (const ascii in map) {
    const chars = map[ascii];
    for (let i = 0; i < chars.length; i++) {
      s = s.split(chars.charAt(i)).join(ascii);
    }
  }
  return s;
}

function slugifyTitle(title) {
  let value = htmlToText(title).trim();
  try {
    value = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (e) {
    value = removeVietnameseMarks(value);
  }
  value = removeVietnameseMarks(value);
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-") || "chuong";
}

function storyURLFromInput(rawUrl) {
  const normalized = normalizeValvrareInputURL(rawUrl);
  const parts = parseAbsoluteURL(normalized);
  if (!parts) return normalized;

  const path = (parts.rest || "").split("#")[0].split("?")[0];
  const match = path.match(/^(\/truyen\/[^\/?#]+)/i);
  if (!match) return normalized;
  return parts.scheme + "://" + parts.host + match[1];
}

function novelSlugFromURL(storyUrl) {
  const parts = parseAbsoluteURL(storyUrl);
  const path = parts ? (parts.rest || "") : String(storyUrl || "");
  const match = path.match(/\/truyen\/([^\/?#]+)/i);
  return match ? match[1] : "";
}

function chapterSuffixFromID(id) {
  const value = String(id || "");
  if (value.length <= 8) return value;
  return value.slice(value.length - 8);
}

function chapterSuffixFromURL(url) {
  const clean = String(url || "").split("#")[0].split("?")[0];
  const match = clean.match(/-([0-9a-f]{8})(?:\/)?$/i);
  return match ? match[1].toLowerCase() : "";
}

function collectChapterLinkMap(html, storyUrl) {
  const map = {};
  const seenURLs = {};
  const storySlug = novelSlugFromURL(storyUrl);
  const re = /<a\b[^>]*href=["']([^"']*\/truyen\/[^"']+\/chuong\/[^"']+)["'][^>]*>/gi;
  let match;
  while ((match = re.exec(String(html || ""))) !== null) {
    const fullURL = absolutize(match[1], storyUrl).replace(/#.*$/, "");
    if (seenURLs[fullURL]) continue;
    seenURLs[fullURL] = true;
    if (storySlug && fullURL.indexOf("/truyen/" + storySlug + "/chuong/") === -1) continue;

    const suffix = chapterSuffixFromURL(fullURL);
    if (suffix && !map[suffix]) map[suffix] = fullURL;
  }
  return map;
}

function buildChapterURL(storyUrl, chapter) {
  const suffix = chapterSuffixFromID(chapter && chapter._id);
  const slug = slugifyTitle(chapter && chapter.title);
  return storyUrl.replace(/\/+$/, "") + "/chuong/" + slug + "-" + suffix;
}

function compareByOrder(a, b) {
  const ao = typeof a.order === "number" ? a.order : parseInt(a.order || "0", 10);
  const bo = typeof b.order === "number" ? b.order : parseInt(b.order || "0", 10);
  if (ao !== bo) return ao - bo;
  return String(a.title || "").localeCompare(String(b.title || ""));
}

function collectVolumesFromSeriesHTML(html, storyUrl) {
  const modules = extractModulesFromHTML(html).slice();
  const linkMap = collectChapterLinkMap(html, storyUrl);
  const volumes = [];

  modules.sort(compareByOrder);
  for (let i = 0; i < modules.length; i++) {
    const mod = modules[i] || {};
    const rawChapters = Array.isArray(mod.chapters) ? mod.chapters.slice() : [];
    rawChapters.sort(compareByOrder);
    if (rawChapters.length === 0) continue;

    const chapters = [];
    for (let c = 0; c < rawChapters.length; c++) {
      const source = rawChapters[c] || {};
      const suffix = chapterSuffixFromID(source._id).toLowerCase();
      chapters.push({
        id: source._id || ("chapter_" + (c + 1)),
        title: htmlToText(source.title) || ("Chuong " + (c + 1)),
        order: source.order || c,
        mode: source.mode || "published",
        chapterBalance: source.chapterBalance || 0,
        url: linkMap[suffix] || buildChapterURL(storyUrl, source)
      });
    }

    volumes.push({
      index: volumes.length + 1,
      sourceOrder: typeof mod.order === "number" ? mod.order : i,
      id: mod._id || ("volume_" + (i + 1)),
      title: htmlToText(mod.title) || ("Tap " + (volumes.length + 1)),
      coverURL: mod.illustration ? absolutize(mod.illustration, storyUrl) : "",
      chapters: chapters
    });
  }
  return volumes;
}

function extractSeriesInfo(html, storyUrl) {
  const book = findBookJSONLD(html) || {};
  let title = book.name || "";
  if (!title) {
    let rawTitle = firstMatch(html, /<h1\b[^>]*class=["'][^"']*rd-novel-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i);
    if (rawTitle) {
      rawTitle = rawTitle.replace(/<button\b[\s\S]*?<\/button>/gi, "");
      rawTitle = rawTitle.replace(/<span\b[\s\S]*?<\/span>/gi, "");
      title = htmlToText(rawTitle);
    }
  }
  if (!title) title = htmlToText(extractMeta(html, "og:title"));
  if (!title) title = htmlToText(firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i));
  title = title.replace(/\s*\|\s*Valvrareteam.*$/i, "").trim() || "Valvrareteam Novel";

  let author = "";
  if (book.author) {
    author = typeof book.author === "object" ? (book.author.name || "") : String(book.author);
  }
  if (!author) author = htmlToText(firstMatch(html, /<span\b[^>]*class=["'][^"']*rd-author-name[^"']*["'][^>]*>([\s\S]*?)<\/span>/i));
  if (!author) author = "Unknown";

  let coverURL = book.image || extractMeta(html, "og:image");
  if (!coverURL) {
    const coverTag = String(html || "").match(/<img\b[^>]*class=["'][^"']*rd-cover-image[^"']*["'][^>]*>/i);
    if (coverTag) coverURL = attrValue(coverTag[0], "src");
  }
  coverURL = coverURL ? absolutize(coverURL, storyUrl) : "";

  let descriptionHTML = innerByClass(html, "rd-description-content");
  let description = htmlToText(descriptionHTML);
  if (!description && book.description) description = htmlToText(book.description);

  let subject = "";
  if (book.genre) {
    subject = Array.isArray(book.genre) ? book.genre.join(", ") : String(book.genre);
  }
  if (!subject) {
    const tags = [];
    const tagRe = /<span\b[^>]*class=["'][^"']*rd-genre-tag[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi;
    let tagMatch;
    while ((tagMatch = tagRe.exec(String(html || ""))) !== null) {
      const tagText = htmlToText(tagMatch[1]);
      if (tagText) tags.push(tagText);
    }
    subject = tags.join(", ");
  }

  return {
    title: title,
    author: author,
    coverURL: coverURL,
    description: description,
    subject: subject
  };
}

function normalizeDownloadMode(params) {
  const mode = String(params.downloadMode || "").trim().toLowerCase();
  if (mode === "choose_volumes" || mode === "single_chapter" || mode === "chapter_range") return mode;
  return "all_volumes";
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
    const part = parts[i].replace(/^tap/i, "").replace(/^vol(?:ume)?/i, "");
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
    if (!isNaN(n) && n >= 1 && n <= volumeCount) selected[String(n)] = true;
  }

  const result = Object.keys(selected).sort(function(a, b) {
    return parseInt(a, 10) - parseInt(b, 10);
  });
  if (result.length === 0) throw new Error("Khong hieu lua chon tap: " + spec);
  return result;
}

function normalizeChapterURLForMatch(rawUrl, baseUrl) {
  const text = String(rawUrl || "").trim();
  if (!text) return "";
  return absolutize(text, baseUrl)
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function isSameChapterURL(a, b, baseUrl) {
  const suffixA = chapterSuffixFromURL(a);
  const suffixB = chapterSuffixFromURL(b);
  if (suffixA && suffixB && suffixA === suffixB) return true;
  return normalizeChapterURLForMatch(a, baseUrl) === normalizeChapterURLForMatch(b, baseUrl);
}

function applyChapterURLRangeToVolumes(volumes, params, baseUrl) {
  const mode = normalizeDownloadMode(params);
  if (mode !== "single_chapter" && mode !== "chapter_range") return volumes;

  const startUrl = String(params.startChapterUrl || params.url || "").trim();
  const endUrl = mode === "chapter_range" ? String(params.endChapterUrl || "").trim() : startUrl;
  if (!startUrl) throw new Error("Can nhap link chuong bat dau.");
  if (mode === "chapter_range" && !endUrl) throw new Error("Can nhap link chuong ket thuc.");

  const flat = [];
  for (let v = 0; v < volumes.length; v++) {
    const chapters = volumes[v].chapters || [];
    for (let c = 0; c < chapters.length; c++) {
      flat.push({ volumeIndex: v, chapter: chapters[c] });
    }
  }
  if (flat.length === 0) return [];

  let startFlat = -1;
  let endFlat = -1;
  for (let i = 0; i < flat.length; i++) {
    if (startFlat < 0 && isSameChapterURL(flat[i].chapter.url, startUrl, baseUrl)) startFlat = i;
    if (endFlat < 0 && isSameChapterURL(flat[i].chapter.url, endUrl, baseUrl)) endFlat = i;
  }
  if (startFlat < 0) throw new Error("Khong tim thay link chuong bat dau trong danh sach: " + startUrl);
  if (endFlat < 0) throw new Error("Khong tim thay link chuong ket thuc trong danh sach: " + endUrl);
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

  const selected = [];
  for (let v = 0; v < volumes.length; v++) {
    const chapters = byVolume[String(v)] || [];
    if (chapters.length === 0) continue;
    const clone = {};
    for (const key in volumes[v]) clone[key] = volumes[v][key];
    clone.chapters = chapters;
    selected.push(clone);
  }

  console.log("[*] Da chon tai tu chapter #" + (startFlat + 1) + " den #" + (endFlat + 1) + " (" + (endFlat - startFlat + 1) + " chuong).");
  return selected;
}

function getExtFromURL(url) {
  let clean = String(url || "").split("#")[0];
  const nested = clean.match(/[?&]url=([^&]+)/i);
  if (nested) {
    try {
      clean = decodeURIComponent(nested[1]);
    } catch (e) {
      clean = nested[1];
    }
  }
  clean = clean.split("?")[0];
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

function fetchWithRetry(session, url, headers, maxAttempts) {
  if (!maxAttempts) maxAttempts = 8;
  let attempt = 0;
  while (attempt < maxAttempts) {
    let resp = null;
    try {
      resp = session.Get(url, headers || {});
      if (resp && resp.Status >= 200 && resp.Status < 300) return resp;
      console.log("  [*] HTTP " + (resp ? resp.Status : "khong phan hoi") + " khi tai: " + url);
      if (resp && resp.Status === 404) break;
    } catch (e) {
      console.log("  [*] Loi ket noi: " + e.message);
    }

    attempt++;
    if (attempt < maxAttempts) {
      const delay = Math.min(1500 * Math.pow(2, attempt - 1), 20000);
      console.log("  [*] Thu lai sau " + Math.round(delay / 1000) + "s (" + (attempt + 1) + "/" + maxAttempts + ")...");
      utils.sleep(delay);
    }
  }
  throw new Error("Khong the tai URL sau nhieu lan thu: " + url);
}

function parseJSONResponse(resp, context) {
  try {
    return JSON.parse(resp && resp.Body ? resp.Body : "{}");
  } catch (e) {
    throw new Error("Khong parse duoc JSON " + (context || "") + ": " + e.message);
  }
}

function postJSONWithRetry(session, url, payload, headers, maxAttempts) {
  if (!maxAttempts) maxAttempts = 3;
  let attempt = 0;
  while (attempt < maxAttempts) {
    let resp = null;
    try {
      resp = session.Post(url, payload || {}, headers || {});
      if (resp && resp.Status >= 200 && resp.Status < 300) return resp;
      console.log("  [*] HTTP " + (resp ? resp.Status : "khong phan hoi") + " khi goi API.");
      if (resp && (resp.Status === 400 || resp.Status === 401 || resp.Status === 403)) break;
    } catch (e) {
      console.log("  [*] Loi API: " + e.message);
    }

    attempt++;
    if (attempt < maxAttempts) {
      const delay = Math.min(1500 * Math.pow(2, attempt - 1), 8000);
      utils.sleep(delay);
    }
  }
  throw new Error("Khong the goi API: " + url);
}

function getJSONWithRetry(session, url, headers, maxAttempts) {
  const resp = fetchWithRetry(session, url, headers || {}, maxAttempts || 4);
  return parseJSONResponse(resp, url);
}

function valvrareAPIHeaders(token, referer) {
  const headers = {
    "Accept": "application/json",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": referer || VALVRARE_BASE_URL,
    "Origin": VALVRARE_BASE_URL
  };
  if (token) headers.Authorization = "Bearer " + token;
  return headers;
}

function loginValvrare(session, params, storyUrl) {
  const username = String(params.username || "").trim();
  const password = String(params.password || "");
  if (!username && !password) {
    return { token: "", user: null };
  }
  if (!username || !password) {
    throw new Error("Can nhap du ca tai khoan va mat khau Valvrareteam de mo chuong bao mat.");
  }

  console.log("[*] Dang dang nhap Valvrareteam de mo chuong bao mat...");
  const payload = { username: username, password: password };
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Referer": storyUrl || VALVRARE_BASE_URL,
    "Origin": VALVRARE_BASE_URL
  };
  const loginURLs = [
    VALVRARE_BASE_URL + "/api/auth/login",
    VALVRARE_DIRECT_API_BASE_URL + "/api/auth/login"
  ];

  let lastError = "";
  for (let i = 0; i < loginURLs.length; i++) {
    try {
      const resp = postJSONWithRetry(session, loginURLs[i], payload, headers, 2);
      const data = parseJSONResponse(resp, "dang nhap Valvrareteam");
      if (!data || !data.token) {
        throw new Error("API dang nhap khong tra token.");
      }
      const user = data.user || {};
      console.log("[+] Dang nhap Valvrareteam thanh cong: " + (user.username || user.displayName || "user") + " (" + (user.role || "user") + ").");
      return { token: data.token, user: user, refreshToken: data.refreshToken || "" };
    } catch (e) {
      lastError = e.message;
    }
  }

  throw new Error("Dang nhap Valvrareteam that bai: " + lastError);
}

function fetchFullChapterFromAPI(session, chapter, auth, storyUrl) {
  if (!auth || !auth.token || !chapter || !chapter.id) return null;

  const apiURLs = [
    VALVRARE_BASE_URL + "/api/chapters/" + chapter.id + "/full",
    VALVRARE_DIRECT_API_BASE_URL + "/api/chapters/" + chapter.id + "/full"
  ];
  let lastError = "";
  for (let i = 0; i < apiURLs.length; i++) {
    try {
      const data = getJSONWithRetry(session, apiURLs[i], valvrareAPIHeaders(auth.token, chapter.url || storyUrl), 3);
      const apiChapter = data && data.chapter ? data.chapter : null;
      if (apiChapter && apiChapter.content) {
        return {
          title: apiChapter.title || chapter.title,
          content: apiChapter.content,
          chapter: apiChapter
        };
      }
      lastError = "API khong co content.";
    } catch (e) {
      lastError = e.message;
    }
  }

  console.log("  [*] Khong lay duoc full content cho chuong bao mat: " + chapter.title + " (" + lastError + ")");
  return null;
}

function downloadCoverImage(session, coverURL, referer) {
  if (!coverURL) return "";
  try {
    const ext = getExtFromURL(coverURL);
    const base64 = session.GetBinaryBase64(coverURL, { "Referer": referer || VALVRARE_BASE_URL });
    if (!base64) return "";
    return "data:" + mimeFromExt(ext) + ";base64," + base64;
  } catch (e) {
    console.log("[-] Khong tai duoc anh bia: " + coverURL + " (" + e.message + ")");
    return "";
  }
}

function sanitizeHTML(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<audio[\s\S]*?<\/audio>/gi, "")
    .replace(/<button[\s\S]*?<\/button>/gi, "")
    .replace(/\s(?:onclick|onload|onerror|class|id|data-[a-z0-9_-]+)=(".*?"|'.*?'|[^\s>]+)/gi, "")
    .replace(/\sstyle=(".*?"|'.*?'|[^\s>]+)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractChapterTitle(html, fallbackTitle) {
  let title = htmlToText(firstMatch(html, /<h2\b[^>]*class=["'][^"']*chapter-title-banner[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i));
  if (!title) title = htmlToText(firstMatch(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i));
  if (!title) {
    const decoded = decodeNextFlightEscapes(html);
    title = htmlToText(firstMatch(decoded, /"chapter"\s*:\s*\{[\s\S]{0,500}?"title"\s*:\s*"([^"]+)"/i));
  }
  return title || fallbackTitle || "Chuong";
}

function chapterLooksLocked(html) {
  const body = String(html || "");
  return /"accessDenied"\s*:\s*true/i.test(body) ||
    /restricted-content-message/i.test(body) ||
    /locked-chapter-container/i.test(body) ||
    /chapter-access-guard/i.test(body);
}

function extractChapterContent(html) {
  return innerByClass(html, "chapter-content");
}

function downloadAndRewriteImages(session, content, pageUrl, images, prefix, startCounter) {
  let html = String(content || "");
  let counter = startCounter || 1;
  const imgRegex = /<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi;
  const imageSources = [];
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    const src = match[1];
    if (!src || /^data:/i.test(src)) continue;
    if (imageSources.indexOf(src) === -1) imageSources.push(src);
  }

  const downloaded = {};
  const failed = {};
  if (imageSources.length > 0) {
    const absoluteURLs = [];
    for (let i = 0; i < imageSources.length; i++) {
      absoluteURLs.push(absolutize(imageSources[i], pageUrl));
    }
    const downloadedMap = session.GetBinariesBase64(absoluteURLs, { "Referer": pageUrl }) || {};
    for (let i = 0; i < imageSources.length; i++) {
      const src = imageSources[i];
      const fullURL = absoluteURLs[i];
      const base64 = downloadedMap[fullURL];
      if (base64) {
        const ext = getExtFromURL(fullURL);
        const internalPath = "images/" + prefix + "_" + counter + "." + ext;
        images[internalPath] = base64;
        downloaded[src] = internalPath;
        counter++;
      } else {
        failed[src] = true;
        console.log("  [*] Bo qua anh khong tai duoc: " + fullURL);
      }
    }
  }


  html = html.replace(imgRegex, function(tag, src) {
    if (downloaded[src]) {
      return tag
        .replace(/\s+srcset=["'][^"']*["']/i, "")
        .replace(src, downloaded[src]);
    }
    if (failed[src]) return "";
    return tag.replace(/\s+srcset=["'][^"']*["']/i, "");
  });

  return { html: html, nextCounter: counter };
}

function wrapIfPlainText(content) {
  const html = String(content || "").trim();
  if (!html) return "";
  if (/<(p|div|br|img|h[1-6]|ul|ol|li|blockquote)\b/i.test(html)) return html;

  const lines = html.split(/\r?\n/);
  let out = "";
  for (let i = 0; i < lines.length; i++) {
    const line = htmlToText(lines[i]);
    if (line) out += "<p>" + line + "</p>";
  }
  return out || "<p>" + htmlToText(html) + "</p>";
}

function lockedChapterPlaceholder(chapterTitle, chapterURL) {
  return '<p><em>Chuong nay dang bi khoa tren Valvrareteam va khong co noi dung cong khai khi khong dang nhap.</em></p>' +
    '<p><a href="' + chapterURL + '">Mo tren Valvrareteam</a></p>';
}

function buildVolumeEbook(session, volume, seriesInfo, storyUrl, auth) {
  const volumeTitle = volume.title || ("Tap " + volume.index);
  const volumeCoverURL = volume.coverURL || seriesInfo.coverURL;
  const coverImage = downloadCoverImage(session, volumeCoverURL, storyUrl);

  const resultChapters = [];
  const resultImages = {};
  let imageCounter = 1;
  let lockedCount = 0;

  console.log("[*] Dang tai " + volumeTitle + " (" + volume.chapters.length + " chuong).");
  for (let i = 0; i < volume.chapters.length; i++) {
    const chap = volume.chapters[i];
    console.log("  -> [" + (i + 1) + "/" + volume.chapters.length + "] " + chap.title);

    const chapResp = fetchWithRetry(session, chap.url, { "Referer": storyUrl }, 8);
    let pageTitle = extractChapterTitle(chapResp.Body, chap.title);
    let content = extractChapterContent(chapResp.Body);

    if (!content || (!/<img\b/i.test(content) && htmlToText(content).length < 5)) {
      const fullChapter = fetchFullChapterFromAPI(session, chap, auth, storyUrl);
      if (fullChapter && fullChapter.content) {
        pageTitle = fullChapter.title || pageTitle;
        content = fullChapter.content;
        console.log("  [+] Da lay full content bang API cho chuong bao mat: " + pageTitle);
      }
    }

    if (!content || (!/<img\b/i.test(content) && htmlToText(content).length < 5)) {
      if (chapterLooksLocked(chapResp.Body) || chap.mode === "protected" || chap.mode === "paid") {
        lockedCount++;
        console.log("  [*] Chuong bi khoa, them placeholder: " + pageTitle);
        resultChapters.push({
          id: "vol_" + volume.index + "_chap_" + (resultChapters.length + 1),
          title: pageTitle,
          text: lockedChapterPlaceholder(pageTitle, chap.url),
          rawHtml: true
        });
        utils.sleep(500);
        continue;
      }
      throw new Error("Khong tim thay noi dung chuong: " + pageTitle);
    }

    content = sanitizeHTML(content);
    const rewritten = downloadAndRewriteImages(session, content, chap.url, resultImages, "valvrare_v" + volume.index, imageCounter);
    content = wrapIfPlainText(rewritten.html);
    imageCounter = rewritten.nextCounter;

    if (!content || (!/<img\b/i.test(content) && htmlToText(content).length < 5)) {
      throw new Error("Noi dung chuong rong sau khi lam sach: " + pageTitle);
    }

    resultChapters.push({
      id: "vol_" + volume.index + "_chap_" + (resultChapters.length + 1),
      title: pageTitle,
      text: content,
      rawHtml: true
    });
    utils.sleep(700);
  }

  if (resultChapters.length === 0) {
    throw new Error("Khong tai duoc chuong nao trong tap: " + volumeTitle);
  }
  if (lockedCount > 0) {
    console.log("[*] " + volumeTitle + " co " + lockedCount + " chuong bi khoa, da them placeholder vao EPUB.");
  }
  console.log("[+] Hoan tat " + volumeTitle + ": " + resultChapters.length + " chuong, " + Object.keys(resultImages).length + " anh.");

  return {
    title: volumeTitle,
    author: seriesInfo.author,
    metadata: {
      title: volumeTitle,
      creator: seriesInfo.author,
      language: "vi",
      publisher: "Valvrareteam",
      description: seriesInfo.description,
      subject: seriesInfo.subject,
      series: seriesInfo.title,
      seriesIndex: String(volume.index || ""),
      coverImage: coverImage
    },
    chapters: resultChapters,
    images: resultImages
  };
}

function run(params) {
  const session = http.newSession();
  const storyUrl = storyURLFromInput(params.url);
  const baseUrl = valvrareOriginFromURL(storyUrl);

  console.log("[*] Valvrareteam domain: " + baseUrl);
  console.log("[*] Dang tai trang truyen: " + storyUrl);

  const seriesResp = fetchWithRetry(session, storyUrl, {}, 8);
  const auth = loginValvrare(session, params, storyUrl);
  const seriesInfo = extractSeriesInfo(seriesResp.Body, storyUrl);
  console.log("[*] Ten truyen: " + seriesInfo.title);
  console.log("[*] Tac gia: " + seriesInfo.author);

  let volumes = collectVolumesFromSeriesHTML(seriesResp.Body, storyUrl);
  if (volumes.length === 0) {
    throw new Error("Khong tim thay tap/chuong nao trong trang Valvrareteam.");
  }

  console.log("[+] Tim thay " + volumes.length + " tap co chuong.");
  for (let i = 0; i < volumes.length; i++) {
    console.log("  [" + volumes[i].index + "] " + volumes[i].title + " (" + volumes[i].chapters.length + " chuong)");
  }

  const mode = normalizeDownloadMode(params);
  let selectedVolumeIDs = null;
  if (mode === "choose_volumes") {
    selectedVolumeIDs = parseVolumeSelectionSpec(params.volumeSelection, volumes.length);
    if (!selectedVolumeIDs) {
      const options = [];
      for (let i = 0; i < volumes.length; i++) {
        options.push({
          id: String(volumes[i].index),
          label: "[" + volumes[i].index + "] " + volumes[i].title,
          description: volumes[i].chapters.length + " chuong"
        });
      }
      selectedVolumeIDs = utils.choose("Chon tap Valvrareteam muon tai", options, true);
    }
  } else {
    selectedVolumeIDs = parseVolumeSelectionSpec("all", volumes.length);
  }

  const selectedMap = {};
  for (let i = 0; i < selectedVolumeIDs.length; i++) selectedMap[String(selectedVolumeIDs[i])] = true;

  const selectedVolumes = [];
  for (let i = 0; i < volumes.length; i++) {
    if (selectedMap[String(volumes[i].index)]) selectedVolumes.push(volumes[i]);
  }
  if (selectedVolumes.length === 0) throw new Error("Khong co tap hop le nao duoc chon.");

  volumes = applyChapterURLRangeToVolumes(selectedVolumes, params, storyUrl);
  if (volumes.length === 0) throw new Error("Khong co chuong nao nam trong khoang link da chon.");

  const ebooks = [];
  for (let i = 0; i < volumes.length; i++) {
    ebooks.push(buildVolumeEbook(session, volumes[i], seriesInfo, storyUrl, auth));
  }

  console.log("[+] Da tao du lieu " + ebooks.length + " EPUB rieng cho Valvrareteam.");
  return { ebooks: ebooks };
}
