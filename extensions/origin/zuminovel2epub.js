// ==========================================
// Zumi Novel EPUB Downloader Extension
// ==========================================

function register() {
  return {
    id: "zuminovel2epub",
    name: "Zumi Novel Downloader",
    description: "Tải truyện chữ từ zuminovel.com và đóng gói thành EPUB riêng cho từng tập.",
    inputs: [
      {
        id: "url",
        type: "text",
        label: "Đường dẫn truyện",
        placeholder: "https://zuminovel.com/novel/khi-nhung-ao-tuong-thanh-xuan-tro-thanh-hien-thuc",
        required: true
      },
      {
        id: "username",
        type: "text",
        label: "Tài khoản (Email)",
        placeholder: "Email đăng nhập, bỏ trống nếu chỉ tải chương miễn phí.",
        required: false
      },
      {
        id: "password",
        type: "password",
        label: "Mật khẩu",
        placeholder: "Nhập mật khẩu để mở khóa chương VIP/trả phí.",
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
          { value: "single_chapter", label: "3. Tải 1 chương bằng link/ID" },
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
        placeholder: "Dán link chương hoặc ID cần tải.",
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

const ZUMI_BASE_URL = "https://zuminovel.com";
const ZUMI_API_BASE_URL = "https://zuminovel.com/api";

function htmlToText(html) {
  return decodeEntities(String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " "))
    .trim();
}

const HTML_ENTITIES = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  agrave: "à", aacute: "á", acirc: "â", atilde: "ã", adia: "ä", aring: "å",
  Agrave: "À", Aacute: "Á", Acirc: "Â", Atilde: "Ã",
  egrave: "è", eacute: "é", ecirc: "ê", edia: "ë",
  Egrave: "È", Eacute: "É", Ecirc: "Ê",
  igrave: "ì", iacute: "í", icirc: "î",
  Igrave: "Ì", Iacute: "Í", Icirc: "Î",
  ograve: "ò", oacute: "ó", ocirc: "ô", otilde: "õ",
  Ograve: "Ò", Oacute: "Ó", Ocirc: "Ô",
  ugrave: "ù", uacute: "ú", ucirc: "û",
  Ugrave: "Ù", Uacute: "Ú", Ucirc: "Û",
  yacute: "ỳ", yacute: "ý",
  Ygrave: "Ỳ", Yacute: "Ý"
};

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
    .replace(/&#x([0-9a-f]+);/gi, function(_, n) { return String.fromCharCode(parseInt(n, 16)); })
    .replace(/&([a-zA-Z0-9]+);/g, function(match, name) { return HTML_ENTITIES[name] || match; });
}

function normalizeZumiInputURL(input) {
  let value = decodeEntities(String(input || "").trim());
  if (value.indexOf("//") === 0) return "https:" + value;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^(?:www\.)?zuminovel\.com(?:[\/?#]|$)/i.test(value)) return "https://" + value;
  return value;
}

function extractNovelSlugOrId(rawUrl) {
  let url = normalizeZumiInputURL(rawUrl);
  url = url.replace(/#.*$/, "").replace(/\?.*$/, "");
  
  const readMatch = url.match(/\/novel\/([^\/]+)\/read\//i);
  if (readMatch) return readMatch[1];
  
  const novelMatch = url.match(/\/novel\/([^\/\?#]+)/i);
  if (novelMatch) return novelMatch[1];

  const directMatch = url.match(/^([a-z0-9_-]+)$/i);
  if (directMatch) return directMatch[1];

  return url;
}

function extractChapterId(raw) {
  const str = String(raw || "").trim().replace(/[?#].*$/, "").replace(/\/+$/, "");
  // Match 24-character hex MongoDB ObjectId
  const idMatch = str.match(/([a-f0-9]{24})(?:[\/?#]|$)/i);
  if (idMatch) return idMatch[1].toLowerCase();
  return "";
}

function absolutize(url, baseUrl) {
  if (!url) return "";
  let value = decodeEntities(String(url).trim());
  if (value.indexOf("//") === 0) return "https:" + value;
  if (/^https?:\/\//i.test(value)) return value;

  const base = baseUrl || ZUMI_BASE_URL;
  const originMatch = base.match(/^(https?:\/\/[^\/]+)/i);
  const origin = originMatch ? originMatch[1] : ZUMI_BASE_URL;
  if (value.charAt(0) === "/") return origin + value;

  const cleanBase = base.replace(/[?#].*$/, "");
  const dir = /^https?:\/\/[^\/]+$/i.test(cleanBase) ? origin + "/" : cleanBase.replace(/\/[^\/]*$/, "/");
  return dir + value;
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

function downloadCoverImage(session, coverURL, referer) {
  if (!coverURL) return "";
  try {
    const ext = getExtFromURL(coverURL);
    const base64 = session.GetBinaryBase64(coverURL, { "Referer": referer || ZUMI_BASE_URL });
    if (!base64) return "";
    return "data:" + mimeFromExt(ext) + ";base64," + base64;
  } catch (e) {
    console.log("[-] Không tải được ảnh bìa: " + coverURL + " (" + e.message + ")");
    return "";
  }
}

function parseJSONResponse(resp, context) {
  try {
    return JSON.parse(resp && resp.Body ? resp.Body : "{}");
  } catch (e) {
    throw new Error("Không parse được JSON " + (context || "") + ": " + e.message);
  }
}

function fetchWithRetry(session, url, headers, maxAttempts) {
  if (!maxAttempts) maxAttempts = 6;
  let attempt = 0;
  let is403 = false;
  while (attempt < maxAttempts) {
    let resp = null;
    try {
      if (session.GetFast) {
        resp = session.GetFast(url, headers || {});
      } else {
        resp = session.Get(url, headers || {});
      }
      if (resp && resp.Status >= 200 && resp.Status < 300) return resp;
      if (resp && resp.Status === 403) {
        is403 = true;
        maxAttempts = 2;
      }
      console.log("  [*] HTTP " + (resp ? resp.Status : "không phản hồi") + " khi tải: " + url);
      if (resp && resp.Status === 404) break;
    } catch (e) {
      console.log("  [*] Lỗi kết nối: " + e.message);
    }

    attempt++;
    if (attempt < maxAttempts) {
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 15000);
      console.log("  [*] Thử lại sau " + Math.round(delay / 1000) + "s (" + (attempt + 1) + "/" + maxAttempts + ")...");
      utils.sleep(delay);
    }
  }
  if (is403) {
    return { Status: 403, Body: "" };
  }
  throw new Error("Không thể tải URL sau nhiều lần thử: " + url);
}

function postJSONWithRetry(session, url, payload, headers, maxAttempts) {
  if (!maxAttempts) maxAttempts = 3;
  let attempt = 0;
  while (attempt < maxAttempts) {
    let resp = null;
    try {
      if (session.PostFast) {
        resp = session.PostFast(url, payload || {}, headers || {});
      } else {
        resp = session.Post(url, payload || {}, headers || {});
      }
      if (resp && resp.Status >= 200 && resp.Status < 300) return resp;
      console.log("  [*] HTTP " + (resp ? resp.Status : "không phản hồi") + " khi gọi POST API: " + url);
      if (resp && (resp.Status === 400 || resp.Status === 401 || resp.Status === 403)) break;
    } catch (e) {
      console.log("  [*] Lỗi API POST: " + e.message);
    }

    attempt++;
    if (attempt < maxAttempts) {
      const delay = Math.min(1500 * Math.pow(2, attempt - 1), 8000);
      utils.sleep(delay);
    }
  }
  throw new Error("Không thể gọi API POST: " + url);
}

function loginZumi(session, params, storyUrl) {
  const email = String(params.username || "").trim();
  const password = String(params.password || "");
  if (!email && !password) {
    return { token: "", user: null };
  }
  if (!email || !password) {
    throw new Error("Cần nhập đủ cả Email đăng nhập và Mật khẩu Zumi Novel để mở khóa chương VIP/trả phí.");
  }

  console.log("[*] Đang đăng nhập Zumi Novel (" + email + ")...");
  const payload = { email: email, password: password };
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Referer": "https://zuminovel.com/login",
    "Origin": "https://zuminovel.com"
  };

  const loginURL = ZUMI_API_BASE_URL + "/auth/login";
  try {
    const resp = postJSONWithRetry(session, loginURL, payload, headers, 2);
    const data = parseJSONResponse(resp, "đăng nhập Zumi Novel");
    if (!data || !data.token) {
      const msg = (data && data.message) ? data.message : "API đăng nhập không trả về token.";
      throw new Error(msg);
    }
    const user = data.user || {};
    console.log("[+] Đăng nhập Zumi Novel thành công: " + (user.username || user.email || "User") + " (Cấp " + (user.level || 1) + ").");
    return { token: data.token, user: user, refreshToken: data.refreshToken || "" };
  } catch (e) {
    throw new Error("Đăng nhập Zumi Novel thất bại: " + e.message);
  }
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

function getNextFlightStream(html) {
  let stream = "";
  const scriptRe = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRe.exec(String(html || ""))) !== null) {
    const scriptContent = match[1];
    const pushRe = /(?:self\.__next_f|\b__next_f)\.push\s*\(/g;
    let pushMatch;
    while ((pushMatch = pushRe.exec(scriptContent)) !== null) {
      const arrayText = extractBalanced(scriptContent, pushMatch.index, "[", "]");
      if (!arrayText) continue;
      try {
        const arr = JSON.parse(arrayText);
        if (Array.isArray(arr) && arr.length >= 2 && typeof arr[1] === "string") {
          stream += arr[1];
        }
      } catch (e) {
        const strMatch = arrayText.match(/^\s*\[\s*\d+\s*,\s*("[\s\S]*")\s*\]\s*$/);
        if (strMatch) {
          try {
            stream += JSON.parse(strMatch[1]);
          } catch (e2) {}
        }
      }
    }
  }
  return stream;
}

function extractNovelFromHTML(html) {
  const flightStream = getNextFlightStream(html);
  if (flightStream) {
    const markerIndex = flightStream.indexOf('"initialNovel":');
    if (markerIndex >= 0) {
      const raw = extractBalanced(flightStream, markerIndex, "{", "}");
      if (raw) {
        try {
          return JSON.parse(raw);
        } catch (e) {}
      }
    }
  }
  return null;
}

function fetchNovelData(session, rawUrl) {
  const slugOrId = extractNovelSlugOrId(rawUrl);
  if (!slugOrId) {
    throw new Error("Không nhận diện được đường dẫn truyện Zumi Novel hợp lệ: " + rawUrl);
  }

  const apiURL = ZUMI_API_BASE_URL + "/novels/" + encodeURIComponent(slugOrId);
  const headers = {
    "Accept": "application/json",
    "Referer": ZUMI_BASE_URL + "/novel/" + encodeURIComponent(slugOrId),
    "Origin": ZUMI_BASE_URL
  };

  let novelData = null;

  try {
    const resp = (session.GetFast ? session.GetFast(apiURL, headers) : session.Get(apiURL, headers));
    if (resp && resp.Status === 200) {
      const json = parseJSONResponse(resp, "lấy thông tin truyện");
      if (json && json.success && json.data) {
        novelData = json.data;
      }
    }
  } catch (e) {
    console.log("  [*] API novels trả về lỗi: " + e.message + ", chuyển sang đọc trang HTML...");
  }

  if (!novelData || !novelData.title) {
    const pageURL = ZUMI_BASE_URL + "/novel/" + encodeURIComponent(slugOrId);
    console.log("[*] Đang tải trang truyện HTML: " + pageURL);
    const pageResp = fetchWithRetry(session, pageURL, {}, 5);
    if (!pageResp || pageResp.Status !== 200) {
      throw new Error("Không thể tải trang truyện Zumi Novel (Status: " + (pageResp ? pageResp.Status : "không phản hồi") + ")");
    }
    novelData = extractNovelFromHTML(pageResp.Body);
  }

  if (!novelData || !novelData.title) {
    throw new Error("Không tìm thấy dữ liệu truyện Zumi Novel.");
  }

  return novelData;
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
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
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
    
    let downloadedMap = null;
    if (typeof session.GetBinariesBase64 === "function") {
      downloadedMap = session.GetBinariesBase64(absoluteURLs, { "Referer": pageUrl }) || {};
    }

    for (let i = 0; i < imageSources.length; i++) {
      const src = imageSources[i];
      const fullURL = absoluteURLs[i];
      let base64 = downloadedMap ? downloadedMap[fullURL] : null;
      if (!base64 && typeof session.GetBinaryBase64 === "function") {
        base64 = session.GetBinaryBase64(fullURL, { "Referer": pageUrl });
      }

      if (base64) {
        const ext = getExtFromURL(fullURL);
        const internalPath = "images/" + prefix + "_" + counter + "." + ext;
        images[internalPath] = base64;
        downloaded[src] = internalPath;
        counter++;
      } else {
        failed[src] = true;
        console.log("  [*] Bỏ qua ảnh không tải được: " + fullURL);
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
    const part = parts[i].replace(/^tap/i, "").replace(/^vol(?:ume)?/i, "").replace(/^t/i, "");
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
  if (result.length === 0) throw new Error("Không hiểu lựa chọn tập: " + spec);
  return result;
}

function isSameChapter(chap, inputQuery) {
  if (!inputQuery) return false;
  const target = String(inputQuery).trim().toLowerCase();
  const chapId = String(chap.id || chap._id || "").toLowerCase();
  const chapSlug = String(chap.slug || "").toLowerCase();
  const inputId = extractChapterId(target);

  if (inputId && chapId && inputId === chapId) return true;
  if (chapSlug && target.indexOf(chapSlug) !== -1) return true;
  if (chap.url && normalizeZumiInputURL(chap.url).toLowerCase() === normalizeZumiInputURL(target).toLowerCase()) return true;
  return false;
}

function applyChapterURLRangeToVolumes(volumes, params, storyUrl) {
  const mode = normalizeDownloadMode(params);
  if (mode !== "single_chapter" && mode !== "chapter_range") return volumes;

  const startUrl = String(params.startChapterUrl || params.url || "").trim();
  const endUrl = mode === "chapter_range" ? String(params.endChapterUrl || "").trim() : startUrl;
  if (!startUrl) throw new Error("Cần nhập link chương hoặc ID bắt đầu.");
  if (mode === "chapter_range" && !endUrl) throw new Error("Cần nhập link chương hoặc ID kết thúc.");

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
    if (startFlat < 0 && isSameChapter(flat[i].chapter, startUrl)) startFlat = i;
    if (endFlat < 0 && isSameChapter(flat[i].chapter, endUrl)) endFlat = i;
  }

  if (startFlat < 0) throw new Error("Không tìm thấy link/ID chương bắt đầu trong danh sách: " + startUrl);
  if (endFlat < 0) throw new Error("Không tìm thấy link/ID chương kết thúc trong danh sách: " + endUrl);
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

  console.log("[*] Đã chọn tải từ chương #" + (startFlat + 1) + " đến #" + (endFlat + 1) + " (tổng " + (endFlat - startFlat + 1) + " chương).");
  return selected;
}

function groupChaptersIntoVolumes(novelData) {
  const rawChapters = Array.isArray(novelData.chapters) ? novelData.chapters : [];
  if (rawChapters.length === 0) return [];

  const volumeMap = {};
  const volumeOrder = [];

  for (let i = 0; i < rawChapters.length; i++) {
    const c = rawChapters[i] || {};
    const volName = String(c.volume || "Toàn tập").trim();
    if (!volumeMap[volName]) {
      volumeMap[volName] = [];
      volumeOrder.push(volName);
    }
    const chapId = String(c.id || c._id || ("chap_" + (i + 1)));
    const chapSlug = String(c.slug || "");
    const readUrl = ZUMI_BASE_URL + "/novel/" + novelData.slug + "/read/" + encodeURIComponent(volName) + "/" + chapSlug + "-" + chapId;
    
    volumeMap[volName].push({
      id: chapId,
      title: htmlToText(c.title) || ("Chương " + (i + 1)),
      slug: chapSlug,
      order: typeof c.order === "number" ? c.order : (i + 1),
      volume: volName,
      isVIP: !!c.isVIP,
      price: c.price || 0,
      url: readUrl
    });
  }

  const volumes = [];
  for (let v = 0; v < volumeOrder.length; v++) {
    const volName = volumeOrder[v];
    const chaps = volumeMap[volName];
    chaps.sort(function(a, b) {
      if (a.order !== b.order) return a.order - b.order;
      return a.id.localeCompare(b.id);
    });

    let displayTitle = volName;
    if (volumeOrder.length === 1 && (volName === "Toàn tập" || volName === "Volume 1")) {
      displayTitle = novelData.title;
    }

    volumes.push({
      index: v + 1,
      id: "volume_" + (v + 1),
      title: displayTitle,
      volumeName: volName,
      coverURL: novelData.coverUrl ? absolutize(novelData.coverUrl, ZUMI_BASE_URL) : "",
      chapters: chaps
    });
  }

  return volumes;
}

function fetchChapterContentFromAPI(session, novelId, chapter, auth) {
  const chapId = chapter.id;
  const apiURL = ZUMI_API_BASE_URL + "/novels/" + novelId + "/chapters/" + chapId;
  const headers = {
    "Accept": "application/json",
    "Referer": ZUMI_BASE_URL + "/novel/" + novelId,
    "Origin": ZUMI_BASE_URL
  };
  if (auth && auth.token) {
    headers.Authorization = "Bearer " + auth.token;
  }

  let attempt = 0;
  const maxAttempts = 5;
  while (attempt < maxAttempts) {
    try {
      const resp = (session.GetFast ? session.GetFast(apiURL, headers) : session.Get(apiURL, headers));
      if (resp && resp.Status === 200) {
        const json = parseJSONResponse(resp, "lấy nội dung chương");
        if (json && json.success && json.data) {
          const d = json.data;
          const isLocked = d.isLocked === true || d.lockReason === "VIP_CONTENT";
          return {
            title: d.title || chapter.title,
            content: d.content || "",
            isLocked: isLocked,
            price: d.price || chapter.price
          };
        }
      }
      if (resp && resp.Status === 403) {
        return { title: chapter.title, content: "", isLocked: true, is403: true };
      }
      console.log("  [*] HTTP " + (resp ? resp.Status : "không phản hồi") + " khi lấy API chương: " + chapter.title);
    } catch (e) {
      console.log("  [*] Lỗi khi lấy API chương: " + e.message);
    }

    attempt++;
    if (attempt < maxAttempts) {
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
      utils.sleep(delay);
    }
  }

  throw new Error("Không thể tải nội dung chương qua API: " + chapter.title);
}

function lockedChapterPlaceholder(chapterTitle, chapterURL) {
  return '<p><em>Chương này đang bị khóa trên Zumi Novel (yêu cầu đăng nhập hoặc mở khóa bằng tài khoản).</em></p>' +
    '<p><a href="' + chapterURL + '">Mở chương trên Zumi Novel</a></p>';
}

function buildVolumeEbook(session, volume, seriesInfo, novelId, auth, failedChapters) {
  const volumeTitle = volume.title || ("Tập " + volume.index);
  const volumeCoverURL = volume.coverURL || seriesInfo.coverURL;
  const coverImage = downloadCoverImage(session, volumeCoverURL, ZUMI_BASE_URL);

  const resultChapters = [];
  const resultImages = {};
  let imageCounter = 1;
  let lockedCount = 0;

  console.log("[*] Đang tải " + volumeTitle + " (" + volume.chapters.length + " chương).");
  for (let i = 0; i < volume.chapters.length; i++) {
    const chap = volume.chapters[i];
    console.log("  -> [" + (i + 1) + "/" + volume.chapters.length + "] " + chap.title);

    const chapData = fetchChapterContentFromAPI(session, novelId, chap, auth);
    let pageTitle = chapData.title || chap.title;
    let content = chapData.content || "";

    if (chapData.isLocked || (!content && (chap.isVIP || chap.price > 0))) {
      lockedCount++;
      console.log("  [*] Chương bị khóa (VIP/Trả phí), thêm placeholder: " + pageTitle);
      resultChapters.push({
        id: "vol_" + volume.index + "_chap_" + (resultChapters.length + 1),
        title: pageTitle,
        text: lockedChapterPlaceholder(pageTitle, chap.url),
        rawHtml: true
      });
      utils.sleep(200);
      continue;
    }

    if (!content || (!/<img\b/i.test(content) && htmlToText(content).length < 5)) {
      if (chapData.is403) {
        console.log("  [!] Bỏ qua chương do lỗi 403: " + pageTitle);
        failedChapters.push(pageTitle);
        continue;
      }
      throw new Error("Không tìm thấy nội dung chương: " + pageTitle);
    }

    content = sanitizeHTML(content);
    const rewritten = downloadAndRewriteImages(session, content, chap.url, resultImages, "zumi_v" + volume.index, imageCounter);
    content = wrapIfPlainText(rewritten.html);
    imageCounter = rewritten.nextCounter;

    if (!content || (!/<img\b/i.test(content) && htmlToText(content).length < 5)) {
      throw new Error("Nội dung chương rỗng sau khi làm sạch: " + pageTitle);
    }

    resultChapters.push({
      id: "vol_" + volume.index + "_chap_" + (resultChapters.length + 1),
      title: pageTitle,
      text: content,
      rawHtml: true
    });

    // Rate-limiting delay: 300ms between chapters for fast & safe scraping
    utils.sleep(300);
  }

  if (resultChapters.length === 0) {
    throw new Error("Không tải được chương nào trong tập: " + volumeTitle);
  }
  if (lockedCount > 0) {
    console.log("[*] " + volumeTitle + " có " + lockedCount + " chương bị khóa, đã thêm placeholder vào EPUB.");
  }
  console.log("[+] Hoàn tất " + volumeTitle + ": " + resultChapters.length + " chương, " + Object.keys(resultImages).length + " ảnh.");

  return {
    title: volumeTitle,
    author: seriesInfo.author,
    metadata: {
      title: volumeTitle,
      creator: seriesInfo.author,
      language: "vi",
      publisher: "Zumi Novel",
      description: seriesInfo.description,
      subject: seriesInfo.subject,
      series: seriesInfo.title,
      seriesIndex: String(volume.index || "1"),
      coverImage: coverImage
    },
    chapters: resultChapters,
    images: resultImages
  };
}

function run(params) {
  const failedChapters = [];
  const session = http.newSession();
  const rawUrl = String(params.url || "").trim();
  if (!rawUrl) {
    throw new Error("Vui lòng nhập URL truyện Zumi Novel.");
  }

  console.log("[*] Bắt đầu xử lý truyện Zumi Novel: " + rawUrl);

  // 1. Login if credentials provided
  const auth = loginZumi(session, params, rawUrl);

  // 2. Fetch novel structure and metadata
  const novelData = fetchNovelData(session, rawUrl);
  const novelId = novelData._id || novelData.id || novelData.slug;
  const seriesInfo = {
    title: htmlToText(novelData.title) || "Zumi Novel",
    author: htmlToText(novelData.author) || "Unknown",
    coverURL: novelData.coverUrl ? absolutize(novelData.coverUrl, ZUMI_BASE_URL) : "",
    description: htmlToText(novelData.description || ""),
    subject: Array.isArray(novelData.genres) ? novelData.genres.join(", ") : (novelData.genres || "")
  };

  console.log("[*] Tên truyện: " + seriesInfo.title);
  console.log("[*] Tác giả: " + seriesInfo.author);
  console.log("[*] Tổng số chương: " + (novelData.chapters ? novelData.chapters.length : 0));

  // 3. Group chapters into volumes
  let volumes = groupChaptersIntoVolumes(novelData);
  if (volumes.length === 0) {
    throw new Error("Không tìm thấy chương nào trong truyện Zumi Novel này.");
  }

  console.log("[+] Tìm thấy " + volumes.length + " tập có chương.");
  for (let i = 0; i < volumes.length; i++) {
    console.log("  [" + volumes[i].index + "] " + volumes[i].title + " (" + volumes[i].chapters.length + " chương)");
  }

  // 4. Handle volume / chapter range selection
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
          description: volumes[i].chapters.length + " chương"
        });
      }
      selectedVolumeIDs = utils.choose("Chọn tập Zumi Novel muốn tải", options, true);
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
  if (selectedVolumes.length === 0) throw new Error("Không có tập hợp lệ nào được chọn.");

  volumes = applyChapterURLRangeToVolumes(selectedVolumes, params, rawUrl);
  if (volumes.length === 0) throw new Error("Không có chương nào nằm trong khoảng đã chọn.");

  // 5. Build Ebook payloads
  const ebooks = [];
  for (let i = 0; i < volumes.length; i++) {
    ebooks.push(buildVolumeEbook(session, volumes[i], seriesInfo, novelId, auth, failedChapters));
  }

  console.log("[+] Đã tạo dữ liệu " + ebooks.length + " EPUB riêng cho Zumi Novel.");
  return { ebooks: ebooks, warnings: failedChapters };
}
