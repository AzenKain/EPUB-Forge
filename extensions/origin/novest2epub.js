// ==========================================
// Novest EPUB Downloader Extension
// ==========================================

function register() {
  return {
    id: "novest2epub",
    name: "Novest Downloader",
    description: "Tải truyện chữ từ novest.me và đóng gói thành EPUB riêng cho từng tập.",
    inputs: [
      {
        id: "url",
        type: "text",
        label: "Đường dẫn truyện",
        placeholder: "https://novest.me/truyen/muon-am-tham-ket-noi-cung-dong-hao-ngot",
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
          { value: "single_chapter", label: "3. Tải 1 chương bằng link/slug" },
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
        placeholder: "Dán link chương hoặc slug cần tải.",
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

const NOVEST_BASE_URL = "https://novest.me";

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

function normalizeNovestInputURL(input) {
  let value = decodeEntities(String(input || "").trim());
  if (value.indexOf("//") === 0) return "https:" + value;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^(?:www\.)?novest\.me(?:[\/?#]|$)/i.test(value)) return "https://" + value;
  return value;
}

function storyURLFromInput(rawUrl) {
  const normalized = normalizeNovestInputURL(rawUrl);
  const match = normalized.match(/^(https?:\/\/[^\/?#]+)?\/truyen\/([^\/?#]+)/i);
  if (match) {
    const origin = match[1] || NOVEST_BASE_URL;
    return origin + "/truyen/" + match[2];
  }
  return normalized;
}

function novelSlugFromURL(rawUrl) {
  const normalized = normalizeNovestInputURL(rawUrl);
  const match = normalized.match(/\/truyen\/([^\/?#]+)/i);
  if (match) return match[1];
  const directMatch = normalized.match(/^([a-z0-9_-]+)$/i);
  if (directMatch) return directMatch[1];
  return "";
}

function absolutize(url, baseUrl) {
  if (!url) return "";
  let value = decodeEntities(String(url).trim());
  if (value.indexOf("//") === 0) return "https:" + value;
  if (/^https?:\/\//i.test(value)) return value;

  const base = baseUrl || NOVEST_BASE_URL;
  const originMatch = base.match(/^(https?:\/\/[^\/]+)/i);
  const origin = originMatch ? originMatch[1] : NOVEST_BASE_URL;
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
    const base64 = session.GetBinaryBase64(coverURL, { "Referer": referer || NOVEST_BASE_URL });
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

function getFlightRefContent(stream, refKey) {
  const marker1 = "\n" + refKey + ":";
  let pos = stream.indexOf(marker1);
  if (pos === -1 && stream.startsWith(refKey + ":")) pos = 0;
  if (pos === -1) return "";

  const start = pos === 0 ? 0 : pos + 1;
  const afterColon = stream.slice(start + refKey.length + 1);
  
  if (afterColon.startsWith("T")) {
    const commaIdx = afterColon.indexOf(",");
    if (commaIdx !== -1) {
      const hexLen = afterColon.slice(1, commaIdx);
      const len = parseInt(hexLen, 16);
      if (!isNaN(len)) {
        return afterColon.slice(commaIdx + 1, commaIdx + 1 + len);
      }
    }
  }
  
  if (afterColon.startsWith('"')) {
    const endQuote = afterColon.indexOf('"', 1);
    if (endQuote !== -1) {
      try {
        return JSON.parse(afterColon.slice(0, endQuote + 1));
      } catch (e) {}
    }
  }

  const lineEnd = afterColon.indexOf("\n");
  return lineEnd === -1 ? afterColon : afterColon.slice(0, lineEnd);
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
    } catch (e) {}
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

function loginNovest(session, params, storyUrl) {
  const email = String(params.username || "").trim();
  const password = String(params.password || "");
  if (!email && !password) {
    return { userId: null, user: null };
  }
  if (!email || !password) {
    throw new Error("Cần nhập đủ cả Email đăng nhập và Mật khẩu Novest để mở khóa chương VIP/trả phí.");
  }

  console.log("[*] Đang đăng nhập Novest (" + email + ")...");

  // 1. Get CSRF Token
  const csrfResp = (session.GetFast ? session.GetFast(NOVEST_BASE_URL + "/api/auth/csrf", {}) : session.Get(NOVEST_BASE_URL + "/api/auth/csrf", {}));
  const csrfData = parseJSONResponse(csrfResp, "lấy CSRF token Novest");
  const csrfToken = csrfData.csrfToken;
  if (!csrfToken) {
    throw new Error("Không lấy được CSRF token từ Novest.");
  }

  // 2. Submit credentials
  const loginPayload = {
    csrfToken: csrfToken,
    email: email,
    password: password,
    redirect: "false",
    callbackUrl: NOVEST_BASE_URL
  };
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    "Referer": NOVEST_BASE_URL + "/login",
    "Origin": NOVEST_BASE_URL
  };

  const loginResp = (session.PostFast ? session.PostFast(NOVEST_BASE_URL + "/api/auth/callback/credentials", loginPayload, headers) : session.Post(NOVEST_BASE_URL + "/api/auth/callback/credentials", loginPayload, headers));
  if (loginResp && (loginResp.Status === 200 || loginResp.Status === 302)) {
    // 3. Verify session
    const sessionResp = (session.GetFast ? session.GetFast(NOVEST_BASE_URL + "/api/auth/session", {}) : session.Get(NOVEST_BASE_URL + "/api/auth/session", {}));
    const sessionData = parseJSONResponse(sessionResp, "kiểm tra phiên đăng nhập Novest");
    if (sessionData && sessionData.user && sessionData.user.id) {
      console.log("[+] Đăng nhập Novest thành công: " + (sessionData.user.name || sessionData.user.username || email) + " (ID: " + sessionData.user.id + ").");
      return { userId: sessionData.user.id, user: sessionData.user };
    }
  }

  throw new Error("Đăng nhập Novest thất bại: Email hoặc mật khẩu không chính xác.");
}

function decryptNovestContent(encryptedBase64, cipherKey) {
  if (!encryptedBase64) return "";
  try {
    const encryptedBytes = utils.base64ToBytes(encryptedBase64);
    const keyBytes = utils.stringToBytes(cipherKey);
    const decryptedBytes = new Uint8Array(encryptedBytes.length);
    for (let i = 0; i < encryptedBytes.length; i++) {
      decryptedBytes[i] = encryptedBytes[i] ^ keyBytes[i % keyBytes.length];
    }
    const intermediateBase64 = utils.bytesToString(decryptedBytes);
    const finalBytes = utils.base64ToBytes(intermediateBase64);
    return utils.bytesToString(finalBytes);
  } catch (e) {
    console.log("[-] Lỗi giải mã nội dung Novest: " + e.message);
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
  const chapId = String(chap.id || "");
  const chapSlug = String(chap.slug || "").toLowerCase();

  if (target === chapId) return true;
  if (chapSlug && target.indexOf(chapSlug) !== -1) return true;
  if (chap.url && normalizeNovestInputURL(chap.url).toLowerCase() === normalizeNovestInputURL(target).toLowerCase()) return true;
  return false;
}

function applyChapterURLRangeToVolumes(volumes, params) {
  const mode = normalizeDownloadMode(params);
  if (mode !== "single_chapter" && mode !== "chapter_range") return volumes;

  const startUrl = String(params.startChapterUrl || params.url || "").trim();
  const endUrl = mode === "chapter_range" ? String(params.endChapterUrl || "").trim() : startUrl;
  if (!startUrl) throw new Error("Cần nhập link chương hoặc slug bắt đầu.");
  if (mode === "chapter_range" && !endUrl) throw new Error("Cần nhập link chương hoặc slug kết thúc.");

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

  if (startFlat < 0) throw new Error("Không tìm thấy link/slug chương bắt đầu trong danh sách: " + startUrl);
  if (endFlat < 0) throw new Error("Không tìm thấy link/slug chương kết thúc trong danh sách: " + endUrl);
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

function lockedChapterPlaceholder(chapterTitle, chapterURL) {
  return '<p><em>Chương này đang bị khóa trên Novest (yêu cầu đăng nhập hoặc mở khóa bằng tài khoản).</em></p>' +
    '<p><a href="' + chapterURL + '">Mở chương trên Novest</a></p>';
}

function fetchChapterContent(session, chapter, auth) {
  const resp = fetchWithRetry(session, chapter.url, {}, 5);
  if (!resp || resp.Status !== 200) {
    if (resp && resp.Status === 403) {
      return { title: chapter.title, content: "", isLocked: true, is403: true };
    }
    throw new Error("Không thể tải trang chương (HTTP " + (resp ? resp.Status : "0") + "): " + chapter.url);
  }

  const flightStream = getNextFlightStream(resp.Body);
  const chapIdx = flightStream.indexOf('"chapter":');
  if (chapIdx === -1) {
    throw new Error("Không tìm thấy dữ liệu chapter trong trang: " + chapter.title);
  }

  const chapJson = extractBalanced(flightStream, chapIdx, "{", "}");
  const chapObj = JSON.parse(chapJson);
  const isLocked = chapObj.isLocked === true;
  const isObfuscated = chapObj.isObfuscated === true;
  let rawContent = chapObj.content || "";

  if (rawContent && rawContent.startsWith("$")) {
    rawContent = getFlightRefContent(flightStream, rawContent.slice(1));
  }

  let finalContent = rawContent;
  if (isObfuscated && rawContent) {
    const key = auth && auth.userId ? (auth.userId + "_" + chapObj.id) : ("guest_" + chapObj.id);
    finalContent = decryptNovestContent(rawContent, key);
  }

  return {
    id: chapObj.id,
    title: chapObj.title || chapter.title,
    content: finalContent || "",
    isLocked: isLocked,
    is403: false
  };
}

function buildVolumeEbook(session, volume, seriesInfo, auth, failedChapters) {
  const volumeTitle = volume.title || ("Tập " + volume.index);
  const volumeCoverURL = volume.coverURL || seriesInfo.coverURL;
  const coverImage = downloadCoverImage(session, volumeCoverURL, NOVEST_BASE_URL);

  const resultChapters = [];
  const resultImages = {};
  let imageCounter = 1;
  let lockedCount = 0;

  console.log("[*] Đang tải " + volumeTitle + " (" + volume.chapters.length + " chương).");
  for (let i = 0; i < volume.chapters.length; i++) {
    const chap = volume.chapters[i];
    console.log("  -> [" + (i + 1) + "/" + volume.chapters.length + "] " + chap.title);

    const chapData = fetchChapterContent(session, chap, auth);
    let pageTitle = chapData.title || chap.title;
    let content = chapData.content || "";

    if (chapData.isLocked || (!content && (chap.price > 0))) {
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
    const rewritten = downloadAndRewriteImages(session, content, chap.url, resultImages, "novest_v" + volume.index, imageCounter);
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

    // Rate limiting: 300ms delay between chapters
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
      publisher: "Novest",
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
    throw new Error("Vui lòng nhập URL truyện Novest.");
  }

  const storyUrl = storyURLFromInput(rawUrl);
  const novelSlug = novelSlugFromURL(storyUrl);
  if (!novelSlug) {
    throw new Error("Không nhận diện được slug truyện từ URL: " + rawUrl);
  }

  console.log("[*] Bắt đầu xử lý truyện Novest: " + storyUrl);

  // 1. Login if credentials provided
  const auth = loginNovest(session, params, storyUrl);

  // 2. Fetch novel story page
  const novelResp = fetchWithRetry(session, storyUrl, {}, 6);
  if (!novelResp || novelResp.Status !== 200) {
    throw new Error("Không thể tải trang truyện Novest (Status: " + (novelResp ? novelResp.Status : "không phản hồi") + ")");
  }

  const novelFlightStream = getNextFlightStream(novelResp.Body);
  const volIdx = novelFlightStream.indexOf('"initialVolumes":');
  if (volIdx === -1) {
    throw new Error("Không tìm thấy danh sách tập/chương trong trang truyện Novest.");
  }

  const volJson = extractBalanced(novelFlightStream, volIdx, "[", "]");
  const rawVolumes = JSON.parse(volJson);
  if (!Array.isArray(rawVolumes) || rawVolumes.length === 0) {
    throw new Error("Truyện này hiện chưa có chương nào.");
  }

  // 3. Extract series metadata (from JSON-LD or meta)
  const book = findBookJSONLD(novelResp.Body) || {};
  let title = book.name || "";
  if (!title) {
    const titleMatch = novelResp.Body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    title = titleMatch ? htmlToText(titleMatch[1]).replace(/\s*\|\s*Novest.*$/i, "").trim() : "Novest Novel";
  }
  // Strip leading '# ' if present
  title = title.replace(/^#\s*/, "").trim();

  let author = "Unknown";
  if (book.author) {
    author = typeof book.author === "object" ? (book.author.name || "") : String(book.author);
  }
  if (!author) author = "Unknown";

  let coverURL = book.image ? absolutize(book.image, NOVEST_BASE_URL) : "";
  let description = htmlToText(book.description || "");
  let subject = "";
  if (book.genre) {
    subject = Array.isArray(book.genre) ? book.genre.join(", ") : String(book.genre);
  }

  const seriesInfo = {
    title: title,
    author: author,
    coverURL: coverURL,
    description: description,
    subject: subject
  };

  console.log("[*] Tên truyện: " + seriesInfo.title);
  console.log("[*] Tác giả: " + seriesInfo.author);

  // 4. Map volumes and chapters
  const volumes = [];
  for (let v = 0; v < rawVolumes.length; v++) {
    const rv = rawVolumes[v];
    const rawChapters = Array.isArray(rv.chapters) ? rv.chapters : [];
    if (rawChapters.length === 0) continue;

    const chapters = [];
    for (let c = 0; c < rawChapters.length; c++) {
      const rc = rawChapters[c];
      const chapUrl = storyUrl + "/" + rc.slug;
      chapters.push({
        id: rc.id,
        title: htmlToText(rc.title) || ("Chương " + (c + 1)),
        slug: rc.slug,
        order: typeof rc.order === "number" ? rc.order : (c + 1),
        price: rc.price || 0,
        isR18: !!rc.isR18,
        url: chapUrl
      });
    }

    let displayTitle = rv.title || ("Tập " + (volumes.length + 1));
    if (rawVolumes.length === 1 && (displayTitle === "Tập 1" || displayTitle === "Volume 1")) {
      displayTitle = seriesInfo.title;
    }

    volumes.push({
      index: volumes.length + 1,
      id: "volume_" + (volumes.length + 1),
      title: displayTitle,
      volumeName: rv.title,
      coverURL: coverURL,
      chapters: chapters
    });
  }

  if (volumes.length === 0) {
    throw new Error("Không tìm thấy tập có chương hợp lệ nào.");
  }

  console.log("[+] Tìm thấy " + volumes.length + " tập có chương.");
  for (let i = 0; i < volumes.length; i++) {
    console.log("  [" + volumes[i].index + "] " + volumes[i].title + " (" + volumes[i].chapters.length + " chương)");
  }

  // 5. Apply user selection (choose_volumes / chapter_range / single_chapter)
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
      selectedVolumeIDs = utils.choose("Chọn tập Novest muốn tải", options, true);
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

  let finalVolumes = applyChapterURLRangeToVolumes(selectedVolumes, params);
  if (finalVolumes.length === 0) throw new Error("Không có chương nào nằm trong khoảng đã chọn.");

  // 6. Build Ebooks
  const ebooks = [];
  for (let i = 0; i < finalVolumes.length; i++) {
    ebooks.push(buildVolumeEbook(session, finalVolumes[i], seriesInfo, auth, failedChapters));
  }

  console.log("[+] Đã tạo dữ liệu " + ebooks.length + " EPUB riêng cho Novest.");
  return { ebooks: ebooks, warnings: failedChapters };
}
