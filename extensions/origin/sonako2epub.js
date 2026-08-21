// ==========================================
// Sonako Light Novel Wiki EPUB Downloader Extension
// Supports sonako.fandom.com
// ==========================================

function register() {
  return {
    id: "sonako2epub",
    name: "Sonako Downloader",
    description: "Tải Light Novel / truyện dịch từ Sonako Light Novel Wiki (sonako.fandom.com) và tự động đóng gói thành EPUB.",
    inputs: [
      {
        id: "url",
        type: "text",
        label: "Đường dẫn truyện (Series URL)",
        placeholder: "https://sonako.fandom.com/vi/wiki/Taimadou_Gakuen_35_Shiken_Shoutai",
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
        label: "Link chương / Link bắt đầu",
        placeholder: "Dán link chương đầy đủ...",
        visibleWhen: { downloadMode: ["single_chapter", "chapter_range"] },
        required: false
      },
      {
        id: "endChapterUrl",
        type: "text",
        label: "Link chương kết thúc",
        placeholder: "Chỉ hiện khi tải từ link A đến link B (Mode 4)...",
        visibleWhen: { downloadMode: "chapter_range" },
        required: false
      }
    ]
  };
}

const SONAKO_DEFAULT_BASE_URL = "https://sonako.fandom.com";
const SONAKO_HOST = "sonako.fandom.com";

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

function htmlToText(html) {
  return decodeEntities(String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " "))
    .trim();
}

function stripWWW(host) {
  return String(host || "").toLowerCase().replace(/^www\./, "");
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

function normalizeSonakoInputURL(input) {
  let value = decodeEntities(String(input || "").trim());
  if (value.indexOf("//") === 0) return "https:" + value;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^(?:www\.)?sonako\.fandom\.com(?:[\/?#]|$)/i.test(value)) return "https://" + value;
  if (/^sonako\./i.test(value)) return "https://" + value;
  return value;
}

function sonakoOriginFromURL(url) {
  const parts = parseAbsoluteURL(normalizeSonakoInputURL(url));
  if (parts && (parts.host === SONAKO_HOST || parts.host.indexOf("sonako.") !== -1)) {
    return parts.scheme + "://" + parts.host;
  }
  return SONAKO_DEFAULT_BASE_URL;
}

function absolutize(url, baseUrl) {
  if (!url) return "";
  let value = decodeEntities(String(url).trim());
  if (value.indexOf("//") === 0) return "https:" + value;
  if (/^https?:\/\//i.test(value)) return value;

  const base = baseUrl || SONAKO_DEFAULT_BASE_URL;
  const originMatch = base.match(/^(https?:\/\/[^\/]+)/i);
  const origin = originMatch ? originMatch[1] : SONAKO_DEFAULT_BASE_URL;
  if (value.charAt(0) === "/") return origin + value;

  const cleanBase = base.replace(/[?#].*$/, "");
  const dir = /^https?:\/\/[^\/]+$/i.test(cleanBase) ? origin + "/" : cleanBase.replace(/\/[^\/]*$/, "/");
  return dir + value;
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

function extractPageTitleFromURL(url) {
  const normalized = normalizeSonakoInputURL(url);
  const parts = parseAbsoluteURL(normalized);
  const rest = parts ? parts.rest : normalized;
  const cleanPath = rest.split("?")[0].split("#")[0];
  const match = cleanPath.match(/\/(?:vi\/)?wiki\/([^/?#]+)/i);
  if (match) {
    try {
      return decodeURIComponent(match[1]);
    } catch (e) {
      return match[1];
    }
  }
  return "";
}

function buildApiParseURL(pageTitle, origin) {
  const base = origin || SONAKO_DEFAULT_BASE_URL;
  return base.replace(/\/+$/, "") + "/vi/api.php?action=parse&page=" + encodeURIComponent(pageTitle) + "&prop=text|sections&format=json";
}

function cleanWikiaImageURL(url) {
  if (!url) return "";
  let u = String(url).trim();
  u = u.replace(/\/scale-to-width-down\/\d+/g, "");
  u = u.replace(/\/top-crop\/width\/\d+\/height\/\d+/g, "");
  return u;
}

function stripNestedTag(html, startPattern, tagName) {
  const source = String(html || "");
  const lowerTag = String(tagName || "div").toLowerCase();
  let result = source;
  let pos = 0;

  while (pos < result.length) {
    const sub = result.slice(pos);
    const m = sub.match(startPattern);
    if (!m) break;

    const startIdx = pos + m.index;
    const openTagEnd = startIdx + m[0].length;
    let depth = 1;
    const tagRe = new RegExp("</?" + lowerTag + "\\b[^>]*>", "ig");
    tagRe.lastIndex = openTagEnd;

    let endIdx = -1;
    let match;
    while ((match = tagRe.exec(result)) !== null) {
      const tagStr = match[0];
      if (/^<\//.test(tagStr)) {
        depth--;
        if (depth === 0) {
          endIdx = tagRe.lastIndex;
          break;
        }
      } else if (!/\/>$/.test(tagStr)) {
        depth++;
      }
    }

    if (endIdx !== -1) {
      result = result.slice(0, startIdx) + result.slice(endIdx);
      pos = startIdx;
    } else {
      pos = openTagEnd;
    }
  }
  return result;
}

function sanitizeSonakoHTML(html) {
  if (!html) return "";
  let s = String(html);

  // 1. Remove comments
  s = s.replace(/<!--[\s\S]*?-->/g, "");

  // 2. Remove script and style tags
  s = s.replace(/<script\b[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style\b[\s\S]*?<\/style>/gi, "");

  // 3. Remove edit sections & visual editor links
  s = s.replace(/<span\b[^>]*class=["'][^"']*mw-editsection[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, "");
  s = s.replace(/<a\b[^>]*class=["'][^"']*mw-editsection[^"']*["'][^>]*>[\s\S]*?<\/a>/gi, "");

  // 4. Remove status / export / pocket / dotEPUBremove containers
  s = stripNestedTag(s, /<div\b[^>]*class=["'][^"']*(?:dotEPUBremove|print-no|status)[^"']*["'][^>]*>/i, "div");
  s = stripNestedTag(s, /<div\b[^>]*class=["'][^"']*(?:globalNav|NavFrame|navbox|mw-collapsible)[^"']*["'][^>]*>/i, "div");

  // 5. Remove navigation tables, follow tables, export tables
  s = stripNestedTag(s, /<table\b[^>]*class=["'][^"']*(?:localNav|navbox|vertical-navbox|follow|wikitable)[^"']*["'][^>]*>/i, "table");

  // 6. Remove TOC and follow buttons
  s = s.replace(/<div\b[^>]*id=["']toc["'][^>]*>[\s\S]*?<\/div>/gi, "");
  s = s.replace(/<span\b[^>]*class=["'][^"']*(?:followButton|unfollowButton)[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, "");

  // 7. Remove tracking/header leftovers
  s = s.replace(/<h[1-6]\b[^>]*class=["'][^"']*(?:dotEPUBremove|print-no)[^"']*["'][^>]*>[\s\S]*?<\/h[1-6]>/gi, "");
  s = s.replace(/<h[1-6]\b[^>]*>[\s\S]*?Theo dõi\s*&\s*Thanh chuyển trang[\s\S]*?<\/h[1-6]>/gi, "");

  // 8. Clean up empty paragraphs
  s = s.replace(/<br\s+style=["']clear:\s*both["']\s*\/?>/gi, "");
  s = s.replace(/<p>\s*(?:<br\s*\/?>)?\s*<\/p>/gi, "");

  return s.trim();
}

function transformWikiaGalleries(html) {
  let s = String(html || "");

  s = s.replace(/<div\b[^>]*class=["'][^"']*wikia-gallery-item[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi, function(match, itemHtml) {
    const srcMatch = itemHtml.match(/(?:data-src|src)=["'](https:\/\/static\.wikia\.nocookie\.net\/[^"']+)["']/i);
    const captionMatch = itemHtml.match(/<div\b[^>]*class=["'][^"']*gallery-image-caption[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    const rawSrc = srcMatch ? srcMatch[1] : "";
    const caption = captionMatch ? htmlToText(captionMatch[1]) : "";

    if (!rawSrc) return "";
    const cleanSrc = cleanWikiaImageURL(rawSrc);

    let fig = '<figure style="text-align: center; margin: 1.5em 0;"><img src="' + cleanSrc + '" style="max-width: 100%; height: auto;" />';
    if (caption) {
      fig += '<figcaption style="font-style: italic; color: #666; margin-top: 0.5em;">' + caption + '</figcaption>';
    }
    fig += '</figure>';
    return fig;
  });

  s = s.replace(/<div\b[^>]*class=["'][^"']*wikia-gallery[^"']*["'][^>]*>/gi, "<div>");
  return s;
}

function fetchPageWithRetry(session, pageTitle, pageUrl, origin, maxAttempts) {
  if (!maxAttempts) maxAttempts = 5;
  const apiUrl = pageTitle ? buildApiParseURL(pageTitle, origin) : "";
  let attempt = 0;
  let is403 = false;

  while (attempt < maxAttempts) {
    try {
      if (apiUrl) {
        const resp = session.GetFast(apiUrl, { "Referer": origin || SONAKO_DEFAULT_BASE_URL, "Accept": "application/json" });
        if (resp && resp.Status === 200) {
          try {
            const data = JSON.parse(resp.Body);
            if (data && data.parse && data.parse.text && data.parse.text["*"]) {
              return {
                title: data.parse.title || pageTitle,
                html: data.parse.text["*"],
                sections: data.parse.sections || [],
                rawJson: data
              };
            }
          } catch (jsonErr) {
            // Fallback to web page
          }
        } else if (resp && resp.Status === 403) {
          is403 = true;
          maxAttempts = 2;
        }
      }

      if (pageUrl) {
        const webResp = session.GetFast(pageUrl, { "Referer": origin || SONAKO_DEFAULT_BASE_URL });
        if (webResp && webResp.Status === 200) {
          return {
            title: pageTitle || "",
            html: webResp.Body,
            sections: [],
            isWebHTML: true
          };
        } else if (webResp && webResp.Status === 403) {
          is403 = true;
          maxAttempts = 2;
        }
      }
    } catch (e) {
      console.log("  [!] Lỗi kết nối khi tải trang " + (pageTitle || pageUrl) + ": " + e.message);
    }

    attempt++;
    if (attempt < maxAttempts) {
      const delay = Math.min(1500 * Math.pow(2, attempt - 1), 12000) + Math.random() * 500;
      console.log("  [*] Thử lại sau " + Math.round(delay / 1000) + "s (lần " + (attempt + 1) + "/" + maxAttempts + ")...");
      utils.sleep(delay);
    }
  }

  if (is403) {
    return { is403: true };
  }
  return null;
}

function extractSeriesMetadata(parsedPage, storyUrl) {
  const html = parsedPage.html || "";
  let title = parsedPage.title || "";
  if (!title) {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
      title = htmlToText(titleMatch[1]).replace(/\s*\|\s*Sonako.*$/i, "").trim();
    }
  }

  let author = "Khuyết danh";
  let description = "";
  let coverURL = "";

  const introMatch = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/gi);
  if (introMatch) {
    for (let i = 0; i < Math.min(introMatch.length, 6); i++) {
      const pText = htmlToText(introMatch[i]);
      if (!pText) continue;

      if (!description && pText.length > 30 && pText.indexOf("Facebook") === -1 && pText.indexOf("Sonako") === -1) {
        description = pText;
      }

      const authorMatch = pText.match(/(?:được viết bởi|viết bởi|tác giả\s*:|author\s*:)\s*([^,.\n]+?)(?:\s+và\s+minh\s+họa\s+bởi\s+([^,.\n]+))?(?:[.]|$)/i);
      if (authorMatch && authorMatch[1]) {
        author = authorMatch[1].trim();
      }
    }
  }

  const coverMatch = html.match(/(?:data-src|src)=["'](https:\/\/static\.wikia\.nocookie\.net\/sonako\/images\/[^"']+)["']/i);
  if (coverMatch) {
    coverURL = cleanWikiaImageURL(coverMatch[1]);
  }

  return {
    title: title || "Sonako Light Novel",
    author: author,
    description: description,
    coverURL: coverURL
  };
}

function isNonStoryHeader(headerText) {
  const t = String(headerText || "").toLowerCase().trim();
  const ignored = [
    "nội dung", "lich su cap nhat", "lịch sử cập nhật", "nhân sự", "nhan su",
    "translators", "translator", "editor", "những tập đã được xuất bản", "nhung tap da duoc xuat ban",
    "danh sách nhân vật", "thảo luận", "categories", "thể loại", "xem thêm",
    "chú thích", "tham khảo", "bình chọn", "poll", "theo dõi & thanh chuyển trang",
    "đặc biệt", "timeline", "terms", "quy chuẩn dịch thuật", "quy chuẩn"
  ];
  for (let i = 0; i < ignored.length; i++) {
    if (t === ignored[i] || t.indexOf(ignored[i]) === 0) return true;
  }
  return false;
}

function isInvalidChapterHref(href) {
  if (!href) return true;
  const h = String(href);
  const badTokens = [
    "Special:", "%C4%90%E1%BA%B7c_bi%E1%BB%87t:", "T%E1%BA%ADp_tin:", "File:",
    "Th%C3%A0nh_vi%C3%AAn:", "User:", "Category:", "Thể_loại:", "%E1%BB%83_lo%E1%BA%A1i:",
    "Help:", "Trợ_giúp:", "Bản_mẫu:", "Template:", "action=", "veaction=",
    "diff=", "oldid=", "facebook.com", "twitter.com", "fandom.com/signin",
    "Terms", "Poll", "Progress_and_Registration", "Timeline", "ISBN", "B%C3%ACnh_ch%E1%BB%8Dn"
  ];
  for (let i = 0; i < badTokens.length; i++) {
    if (h.indexOf(badTokens[i]) !== -1) return true;
  }
  return false;
}

function collectVolumesFromPage(parsedPage, storyUrl, origin) {
  const html = parsedPage.html || "";
  const headerRegex = /<h([2-4])[^>]*>([\s\S]*?)<\/h\1>/gi;
  const headerPositions = [];
  let hMatch;

  while ((hMatch = headerRegex.exec(html)) !== null) {
    const fullTag = hMatch[0];
    const innerContent = hMatch[2];
    const headlineMatch = innerContent.match(/class=["']mw-headline["'][^>]*>([\s\S]*?)<\/span>/i);
    const headerTitle = htmlToText(headlineMatch ? headlineMatch[1] : innerContent);
    headerPositions.push({
      start: hMatch.index,
      end: headerRegex.lastIndex,
      title: headerTitle,
      fullTag: fullTag
    });
  }

  const volumes = [];
  for (let i = 0; i < headerPositions.length; i++) {
    const h = headerPositions[i];
    if (isNonStoryHeader(h.title)) continue;

    const startPos = h.end;
    const endPos = (i + 1 < headerPositions.length) ? headerPositions[i + 1].start : html.length;
    const sectionHtml = html.slice(startPos, endPos);

    const coverMatch = sectionHtml.match(/(?:data-src|src)=["'](https:\/\/static\.wikia\.nocookie\.net\/sonako\/images\/[^"']+)["']/i);
    const volCoverURL = coverMatch ? cleanWikiaImageURL(coverMatch[1]) : "";

    const linkRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const chapters = [];
    const seenHrefs = {};
    let lMatch;

    while ((lMatch = linkRegex.exec(sectionHtml)) !== null) {
      const rawHref = lMatch[1];
      const rawText = htmlToText(lMatch[2]);
      if (isInvalidChapterHref(rawHref)) continue;

      const fullUrl = absolutize(rawHref, storyUrl);
      const pageTitle = extractPageTitleFromURL(fullUrl);
      if (!pageTitle) continue;

      if (!seenHrefs[pageTitle.toLowerCase()]) {
        seenHrefs[pageTitle.toLowerCase()] = true;
        chapters.push({
          id: pageTitle,
          title: rawText || pageTitle.replace(/_/g, " "),
          url: fullUrl,
          pageTitle: pageTitle
        });
      }
    }

    if (chapters.length > 0) {
      volumes.push({
        index: volumes.length + 1,
        title: h.title || ("Tập " + (volumes.length + 1)),
        coverURL: volCoverURL,
        chapters: chapters
      });
    }
  }

  return volumes;
}

function normalizeDownloadMode(params) {
  const mode = String(params.downloadMode || "").trim().toLowerCase();
  if (mode === "choose_volumes" || mode === "single_chapter" || mode === "chapter_range") {
    return mode;
  }
  return "all_volumes";
}

function normalizeChapterURLForMatch(rawUrl) {
  const text = String(rawUrl || "").trim();
  if (!text) return "";
  const pageTitle = extractPageTitleFromURL(text);
  if (pageTitle) return pageTitle.toLowerCase();
  return text.toLowerCase();
}

function applyChapterURLRangeToVolumes(volumes, params) {
  const mode = normalizeDownloadMode(params);
  const startUrl = String(params.startChapterUrl || "").trim();
  const endUrl = String(params.endChapterUrl || "").trim();

  if (mode === "all_volumes" || mode === "choose_volumes") {
    return volumes;
  }

  const flat = [];
  for (let v = 0; v < volumes.length; v++) {
    const chapters = volumes[v].chapters || [];
    for (let c = 0; c < chapters.length; c++) {
      flat.push({ volumeIndex: v, chapter: chapters[c] });
    }
  }
  if (flat.length === 0) return volumes;

  let startFlat = 0;
  let endFlat = flat.length - 1;

  if (startUrl) {
    startFlat = -1;
    const target = normalizeChapterURLForMatch(startUrl);
    for (let i = 0; i < flat.length; i++) {
      if (normalizeChapterURLForMatch(flat[i].chapter.url) === target ||
          normalizeChapterURLForMatch(flat[i].chapter.pageTitle) === target) {
        startFlat = i;
        break;
      }
    }
    if (startFlat < 0) {
      throw new Error("Không tìm thấy link chương bắt đầu trong các volume: " + startUrl);
    }
  }

  if (mode === "single_chapter") {
    endFlat = startFlat;
  } else if (endUrl) {
    endFlat = -1;
    const target = normalizeChapterURLForMatch(endUrl);
    for (let i = 0; i < flat.length; i++) {
      if (normalizeChapterURLForMatch(flat[i].chapter.url) === target ||
          normalizeChapterURLForMatch(flat[i].chapter.pageTitle) === target) {
        endFlat = i;
        break;
      }
    }
    if (endFlat < 0) {
      throw new Error("Không tìm thấy link chương kết thúc trong các volume: " + endUrl);
    }
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
    for (const k in volumes[v]) clone[k] = volumes[v][k];
    clone.chapters = selectedChapters;
    selectedVolumes.push(clone);
  }

  console.log("[*] Đã chọn tải từ chương #" + (startFlat + 1) + " đến #" + (endFlat + 1) + " (" + (endFlat - startFlat + 1) + " chương).");
  return selectedVolumes;
}

function processChapterContent(session, chap, volumeIndex, resultChapters, resultImages, state, origin, failedChapters) {
  console.log("  [*] Đang tải chương: " + chap.title);
  const parsed = fetchPageWithRetry(session, chap.pageTitle, chap.url, origin, 5);

  if (!parsed || parsed.is403) {
    console.log("  [!] Không thể tải chương: " + chap.title + " (bỏ qua)");
    failedChapters.push(chap.title);
    return;
  }

  let html = parsed.html || "";
  html = sanitizeSonakoHTML(html);
  html = transformWikiaGalleries(html);

  // Extract and download images
  const imgRegex = /<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi;
  const imageSources = [];
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    const src = match[1];
    if (src && imageSources.indexOf(src) === -1 && src.indexOf("data:") !== 0) {
      imageSources.push(src);
    }
  }

  const downloadedMap = {};
  for (let i = 0; i < imageSources.length; i++) {
    const originalSrc = imageSources[i];
    const fullImgUrl = cleanWikiaImageURL(absolutize(originalSrc, origin));
    try {
      const base64 = session.GetBinaryBase64(fullImgUrl, { "Referer": origin });
      if (base64) {
        const ext = getExtFromURL(fullImgUrl);
        const internalPath = "images/v" + (volumeIndex || 1) + "_img_" + state.imageCounter + "." + ext;
        resultImages[internalPath] = base64;
        downloadedMap[originalSrc] = internalPath;
        state.imageCounter++;
      } else {
        console.log("  [*] Không tải được ảnh: " + fullImgUrl);
      }
    } catch (imgErr) {
      console.log("  [*] Lỗi tải ảnh: " + imgErr.message);
    }
  }

  html = html.replace(imgRegex, function(tag, src) {
    if (downloadedMap[src]) {
      return tag.replace(src, downloadedMap[src]);
    }
    return tag;
  });

  const textClean = htmlToText(html);
  const hasImages = /<img\b/i.test(html);
  if (!html || (!hasImages && textClean.length < 5)) {
    const isIllustration = /minh\s*hoạ|minh\s*họa|illustration/i.test(chap.title);
    if (isIllustration) {
      html = "<p>[Hình ảnh minh họa không khả dụng trên server]</p>";
    } else {
      console.log("  [!] Nội dung chương quá ngắn hoặc rỗng: " + chap.title);
      failedChapters.push(chap.title);
      return;
    }
  }

  resultChapters.push({
    id: "v" + (volumeIndex || 1) + "_chap_" + (resultChapters.length + 1),
    title: chap.title || parsed.title || ("Chương " + (resultChapters.length + 1)),
    text: html,
    rawHtml: true
  });

  utils.sleep(600 + Math.random() * 400);
}

function run(params) {
  const failedChapters = [];
  const rawUrl = params.url;
  const normalizedUrl = normalizeSonakoInputURL(rawUrl);
  const origin = sonakoOriginFromURL(normalizedUrl);
  const pageTitle = extractPageTitleFromURL(normalizedUrl);

  if (!pageTitle) {
    throw new Error("Không thể trích xuất tên trang Sonako từ URL: " + rawUrl);
  }

  const session = http.newSession();
  console.log("[*] Sonako URL: " + normalizedUrl);
  console.log("[*] Đang tải thông tin bộ truyện: " + pageTitle);

  const seriesParsed = fetchPageWithRetry(session, pageTitle, normalizedUrl, origin, 5);
  if (!seriesParsed || seriesParsed.is403) {
    throw new Error("Không thể tải trang truyện từ Sonako: " + pageTitle);
  }

  const meta = extractSeriesMetadata(seriesParsed, normalizedUrl);
  console.log("[+] Tên truyện: " + meta.title);
  console.log("[+] Tác giả: " + meta.author);

  const volumes = collectVolumesFromPage(seriesParsed, normalizedUrl, origin);

  if (volumes.length === 0) {
    // If no volume headers detected, treating the current page as a single volume/chapter
    console.log("[*] Không tìm thấy danh sách volume, xử lý trang như một tập đơn...");
    const singleVolume = {
      index: 1,
      title: meta.title,
      coverURL: meta.coverURL,
      chapters: [
        {
          id: pageTitle,
          title: meta.title,
          url: normalizedUrl,
          pageTitle: pageTitle
        }
      ]
    };
    volumes.push(singleVolume);
  }

  console.log("[+] Đã phát hiện " + volumes.length + " volume trên Sonako.");
  for (let v = 0; v < volumes.length; v++) {
    console.log("  [" + volumes[v].index + "] " + volumes[v].title + " (" + volumes[v].chapters.length + " chương)");
  }

  const downloadMode = normalizeDownloadMode(params);
  let selectedVolumeIDs = [];
  for (let v = 0; v < volumes.length; v++) {
    selectedVolumeIDs.push(String(volumes[v].index));
  }

  if (downloadMode === "choose_volumes") {
    const options = [];
    for (let v = 0; v < volumes.length; v++) {
      options.push({
        id: String(volumes[v].index),
        label: "[" + volumes[v].index + "] " + volumes[v].title,
        description: volumes[v].chapters.length + " chương"
      });
    }
    selectedVolumeIDs = utils.choose("Chọn volume Sonako muốn tải", options, true);
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
    throw new Error("Không có volume nào được chọn để tải.");
  }

  selectedVolumes = applyChapterURLRangeToVolumes(selectedVolumes, params);
  if (selectedVolumes.length === 0) {
    throw new Error("Không có chương nào nằm trong khoảng link đã chọn.");
  }

  const ebooks = [];
  for (let v = 0; v < selectedVolumes.length; v++) {
    const vol = selectedVolumes[v];
    console.log("\n==================================================");
    console.log("[*] Bắt đầu tải Volume " + vol.index + ": " + vol.title);
    console.log("==================================================");

    const resultChapters = [];
    const resultImages = {};
    const state = { imageCounter: 1 };

    // Download volume cover
    const effectiveCoverURL = vol.coverURL || meta.coverURL;
    let coverImage = "";
    if (effectiveCoverURL) {
      try {
        const fullCoverURL = cleanWikiaImageURL(absolutize(effectiveCoverURL, origin));
        const ext = getExtFromURL(fullCoverURL);
        const coverB64 = session.GetBinaryBase64(fullCoverURL, { "Referer": origin });
        if (coverB64) {
          coverImage = "data:" + mimeFromExt(ext) + ";base64," + coverB64;
          console.log("[+] Đã tải ảnh bìa cho " + vol.title);
        }
      } catch (coverErr) {
        console.log("[-] Không tải được ảnh bìa: " + coverErr.message);
      }
    }

    for (let c = 0; c < vol.chapters.length; c++) {
      const chap = vol.chapters[c];
      processChapterContent(session, chap, vol.index, resultChapters, resultImages, state, origin, failedChapters);
    }

    if (resultChapters.length === 0) {
      console.log("  [!] Không tải được chương nào cho " + vol.title);
      continue;
    }

    console.log("[+] Đã hoàn tất " + resultChapters.length + " chương cho " + vol.title);
    ebooks.push({
      title: vol.title,
      author: meta.author,
      metadata: {
        title: vol.title,
        creator: meta.author,
        language: "vi",
        publisher: "Sonako Light Novel Wiki",
        description: meta.description,
        series: meta.title,
        seriesIndex: String(vol.index || ""),
        coverImage: coverImage
      },
      chapters: resultChapters,
      images: resultImages
    });
  }

  if (ebooks.length === 0) {
    throw new Error("Không thể tải thành công bất kỳ volume nào từ Sonako.");
  }

  if (ebooks.length === 1) {
    const single = ebooks[0];
    if (failedChapters.length > 0) {
      single.warnings = failedChapters;
    }
    return single;
  }

  return {
    ebooks: ebooks,
    warnings: failedChapters
  };
}
