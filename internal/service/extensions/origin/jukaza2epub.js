// ==========================================
// Jukaza EPUB Downloader Extension
// Converted from jukaza2epub.py
// ==========================================

function register() {
  return {
    id: "jukaza2epub",
    name: "Jukaza Downloader",
    description: "Tải truyện chữ từ jukaza.site và đóng gói thành file EPUB tự động.",
    inputs: [
      {
        id: "url",
        type: "text",
        label: "Đường dẫn truyện (Series URL)",
        placeholder: "https://sangtacviet.online/truyen/ten-truyen",
        required: true
      },
      {
        id: "username",
        type: "text",
        label: "Tên đăng nhập",
        placeholder: "Nhập username",
        required: true
      },
      {
        id: "password",
        type: "password",
        label: "Mật khẩu",
        placeholder: "Nhập password",
        required: true
      },
      {
        id: "startChapter",
        type: "number",
        label: "Từ chương (để trống = từ đầu)",
        placeholder: "VD: 1",
        required: false
      },
      {
        id: "endChapter",
        type: "number",
        label: "Đến chương (để trống = đến cuối)",
        placeholder: "VD: 100",
        required: false
      }
    ]
  };
}

function decryptContent(encryptedStr, cipherKey) {
  const r = utils.base64ToBytes(encryptedStr);
  const keyBytes = utils.stringToBytes(cipherKey);
  const aBytes = new Uint8Array(r.length);
  for (let i = 0; i < r.length; i++) {
    aBytes[i] = r[i] ^ keyBytes[i % keyBytes.length];
  }
  const base64Str = utils.bytesToString(aBytes);
  const decodedBytes = utils.base64ToBytes(base64Str);
  return utils.bytesToString(decodedBytes);
}

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

function isLoginPage(html) {
  const body = String(html || "");
  return /<form[^>]+action=["'][^"']*\/login["']/i.test(body) &&
    /name=["']password["']/i.test(body);
}

function extractLoginError(html) {
  const body = String(html || "");
  const known = body.match(/<div[^>]*class=["'][^"']*(?:text-red|bg-red|alert|error)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (known) {
    const message = htmlToText(known[1]);
    if (message) return message;
  }
  if (/Thông tin đăng nhập không chính xác/i.test(body)) {
    return "Thông tin đăng nhập không chính xác.";
  }
  return "";
}

function run(params) {
  const baseUrl = "https://sangtacviet.online";
  const session = http.newSession();

  var currentDelay = 300;  
  var MIN_DELAY = 200;
  var MAX_DELAY = 3000;
  var consecutiveSuccess = 0;

  function fetchPageWithRetry(url, maxAttempts) {
    if (!maxAttempts) maxAttempts = 10;
    let attempt = 0;
    let resp = null;
    let readerDataMatch = null;
    while (attempt < maxAttempts) {
      try {
        resp = session.Get(url, {});
        if (resp && resp.Status === 200) {
          readerDataMatch = resp.Body.match(/window\.__READER_DATA__\s*=\s*({[\s\S]*?});/);
          if (readerDataMatch) {
            consecutiveSuccess++;
            if (consecutiveSuccess >= 3 && currentDelay > MIN_DELAY) {
              currentDelay = Math.max(MIN_DELAY, Math.floor(currentDelay * 0.8));
            }
            return { resp: resp, readerDataMatch: readerDataMatch };
          }
          console.log("  [*] Trang tải thành công nhưng thiếu dữ liệu giải mã (có thể bị rate limit / Cloudflare).");
        } else {
          console.log("  [*] Lỗi tải trang chương. Status: " + (resp ? resp.Status : "không phản hồi"));
        }
      } catch (err) {
        console.log("  [*] Lỗi kết nối khi tải trang: " + err.message);
      }
      consecutiveSuccess = 0;
      currentDelay = Math.min(MAX_DELAY, Math.floor(currentDelay * 1.5));
      attempt++;
      if (attempt < maxAttempts) {
        const sleepMs = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
        console.log("  [*] Thử lại trang sau " + (sleepMs / 1000) + " giây (lượt " + (attempt + 1) + "/" + maxAttempts + ")...");
        utils.sleep(sleepMs);
      }
    }
    return null;
  }

  function fetchApiWithRetry(url, headers, maxAttempts) {
    if (!maxAttempts) maxAttempts = 10;
    let attempt = 0;
    let resp = null;
    while (attempt < maxAttempts) {
      try {
        resp = session.Get(url, headers || {});
        if (resp && resp.Status === 200) {
          return resp;
        }
        console.log("  [*] Lỗi API. Status: " + (resp ? resp.Status : "không phản hồi"));
      } catch (err) {
        console.log("  [*] Lỗi kết nối khi gọi API: " + err.message);
      }
      consecutiveSuccess = 0;
      currentDelay = Math.min(MAX_DELAY, Math.floor(currentDelay * 1.5));
      attempt++;
      if (attempt < maxAttempts) {
        const sleepMs = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
        console.log("  [*] Thử lại API sau " + (sleepMs / 1000) + " giây (lượt " + (attempt + 1) + "/" + maxAttempts + ")...");
        utils.sleep(sleepMs);
      }
    }
    return null;
  }
  
  console.log("[*] Đang khởi chạy đăng nhập...");
  const loginUrl = baseUrl + "/login";
  const loginPageResp = session.Get(loginUrl, {});
  
  if (loginPageResp.Status !== 200) {
    throw new Error("Không thể tải trang đăng nhập. HTTP Status: " + loginPageResp.Status);
  }
  
  const tokenMatch = loginPageResp.Body.match(/name=["']_token["']\s+value=["']([^"']+)["']/);
  if (!tokenMatch) {
    throw new Error("Không tìm thấy CSRF _token trên trang đăng nhập.");
  }
  const csrfToken = tokenMatch[1];
  
  const loginPayload = {
    _token: csrfToken,
    name: params.username,
    password: params.password,
    remember: "on"
  };
  
  const loginResp = session.Post(loginUrl, loginPayload, {
    "Referer": loginUrl,
    "Content-Type": "application/x-www-form-urlencoded"
  });
  
  if (!loginResp) {
    throw new Error("Đăng nhập thất bại: không nhận được phản hồi từ máy chủ.");
  }
  if (loginResp.Status >= 400) {
    throw new Error("Đăng nhập thất bại. HTTP Status: " + loginResp.Status);
  }
  const loginError = extractLoginError(loginResp ? loginResp.Body : "");
  if (loginError || isLoginPage(loginResp.Body)) {
    throw new Error(loginError ? "Đăng nhập thất bại: " + loginError : "Đăng nhập thất bại. Tài khoản hoặc mật khẩu không đúng, hoặc phiên đăng nhập đã hết hạn.");
  }

  console.log("[+] Đăng nhập thành công!");

  console.log("[*] Đang tải danh sách chương từ: " + params.url);
  const seriesResp = session.Get(params.url, {});
  if (seriesResp.Status !== 200) {
    throw new Error("Không thể tải trang truyện chính. HTTP Status: " + seriesResp.Status);
  }
  if (isLoginPage(seriesResp.Body)) {
    const pageLoginError = extractLoginError(seriesResp.Body);
    throw new Error(pageLoginError ? "Đăng nhập thất bại: " + pageLoginError : "Đăng nhập thất bại. Tài khoản hoặc mật khẩu không đúng, hoặc phiên đăng nhập đã hết hạn.");
  }

  let novelTitle = "Unknown Novel";
  let novelAuthor = "Unknown Author";
  let novelCoverUrl = "";
  
  const jsonLdMatches = seriesResp.Body.match(/<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/g);
  if (jsonLdMatches) {
    for (let i = 0; i < jsonLdMatches.length; i++) {
      try {
        const rawJson = jsonLdMatches[i].replace(/<script[^>]*>/, "").replace("</script>", "").trim();
        const data = JSON.parse(rawJson);
        if (data["@type"] === "Book") {
          if (data.name) novelTitle = data.name;
          if (data.author) {
            novelAuthor = typeof data.author === "object" ? data.author.name : data.author;
          }
          if (data.image) novelCoverUrl = data.image;
        }
      } catch (e) {
      }
    }
  }
  
  console.log("[*] Tên truyện: " + novelTitle);
  console.log("[*] Tác giả: " + novelAuthor);
  
  function collectChapters(htmlBody) {
    const found = [];
    const seenUrls = {};
    const linkRegex = /<a\s+[^>]*href=["']([^"']*\/chuong\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/g;
    let match;
    
    while ((match = linkRegex.exec(htmlBody || "")) !== null) {
      let rawHref = match[1];
      let fullUrl = rawHref.startsWith("http") ? rawHref : baseUrl + rawHref;
      
      let title = match[2].replace(/<[^>]+>/g, "").trim();
      title = title.replace(/&nbsp;/g, " ");
      title = title.replace(/\s+/g, " ").trim();
      
      const lowerTitle = title.toLowerCase();
      if (lowerTitle.indexOf("đọc từ đầu") !== -1 || lowerTitle.indexOf("đọc tiếp") !== -1 || lowerTitle.indexOf("tiếp tục đọc") !== -1) {
        continue;
      }

      if (!title) {
        title = "Chương " + (found.length + 1);
      }
      
      if (!seenUrls[fullUrl]) {
        found.push({ title: title, url: fullUrl });
        seenUrls[fullUrl] = true;
      }
    }
    return found;
  }

  function extractChapterId(url) {
    const match = url.match(/\/chuong\/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  let chapters = collectChapters(seriesResp.Body);
  for (let listAttempt = 1; chapters.length === 0 && listAttempt <= 3; listAttempt++) {
    console.log("[*] Chưa thấy danh sách chương, tải lại trang truyện (lượt " + listAttempt + "/3)...");
    utils.sleep(1000 * listAttempt);
    const retrySeriesResp = session.Get(params.url, {});
    if (retrySeriesResp.Status !== 200) {
      throw new Error("Không thể tải trang truyện chính. HTTP Status: " + retrySeriesResp.Status);
    }
    if (isLoginPage(retrySeriesResp.Body)) {
      const retryLoginError = extractLoginError(retrySeriesResp.Body);
      throw new Error(retryLoginError ? "Đăng nhập thất bại: " + retryLoginError : "Đăng nhập thất bại. Tài khoản hoặc mật khẩu không đúng, hoặc phiên đăng nhập đã hết hạn.");
    }
    chapters = collectChapters(retrySeriesResp.Body);
  }
  chapters.sort(function(a, b) {
    return extractChapterId(a.url) - extractChapterId(b.url);
  });
  
  console.log("[+] Đã tìm thấy tổng cộng " + chapters.length + " chương.");
  if (chapters.length === 0) {
    throw new Error("Không tìm thấy chương truyện nào để tải.");
  }

  var startIdx = 0;
  var endIdx = chapters.length;
  if (params.startChapter && Number(params.startChapter) > 0) {
    startIdx = Number(params.startChapter) - 1;
  }
  if (params.endChapter && Number(params.endChapter) > 0) {
    endIdx = Number(params.endChapter);
  }
  if (startIdx >= chapters.length) {
    throw new Error("Chương bắt đầu (" + (startIdx + 1) + ") vượt quá tổng số chương (" + chapters.length + ").");
  }
  if (endIdx > chapters.length) {
    endIdx = chapters.length;
  }
  if (startIdx > 0 || endIdx < chapters.length) {
    chapters = chapters.slice(startIdx, endIdx);
    console.log("[*] Đã chọn tải từ chương " + (startIdx + 1) + " đến chương " + endIdx + " (" + chapters.length + " chương).");
  }

  let coverImageBase64 = "";
  if (novelCoverUrl) {
    try {
      const fullCoverUrl = novelCoverUrl.startsWith("http") ? novelCoverUrl : baseUrl + novelCoverUrl;
      const coverResp = session.GetBinaryBase64(fullCoverUrl, { "Referer": baseUrl });
      if (coverResp) {
        let mime = "image/jpeg";
        if (novelCoverUrl.indexOf(".png") !== -1) mime = "image/png";
        if (novelCoverUrl.indexOf(".webp") !== -1) mime = "image/webp";
        if (novelCoverUrl.indexOf(".gif") !== -1) mime = "image/gif";
        coverImageBase64 = "data:" + mime + ";base64," + coverResp;
        console.log("[+] Đã tải ảnh bìa thành công!");
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
    
    const pageResult = fetchPageWithRetry(chap.url, 10);
    if (!pageResult) {
      throw new Error("Không thể tải trang chương sau nhiều lần thử lại: " + chap.title);
    }
    
    const chapPageResp = pageResult.resp;
    const readerDataMatch = pageResult.readerDataMatch;
    
    let readerData;
    try {
      readerData = JSON.parse(readerDataMatch[1]);
    } catch (e) {
      throw new Error("Lỗi parse reader data ở chương: " + chap.title);
    }
    
    const cipherKey = readerData.cipherKey;
    const chapterId = readerData.chapter ? readerData.chapter.id : null;
    const cleanTitle = readerData.chapter ? readerData.chapter.translated_title : null;
    
    let token = "";
    try {
      token = readerData.chapter.reader_access.current.token;
    } catch (e) {
      console.log("  [-] Chương bị khóa hoặc không có token truy cập.");
      continue;
    }
    
    if (!chapterId || !cipherKey || !token) {
      throw new Error("Thiếu tham số giải mã chương: " + chap.title);
    }
    
    const apiUrl = baseUrl + "/api/reader/chapter/" + chapterId;
    const apiResp = fetchApiWithRetry(apiUrl, {
      "X-Requested-With": "XMLHttpRequest",
      "X-Reader-Token": token,
      "Accept": "application/json",
      "Referer": chap.url
    }, 10);
    
    if (!apiResp) {
      throw new Error("Không thể gọi API giải mã sau nhiều lần thử lại ở chương: " + chap.title);
    }
    
    let apiData;
    try {
      apiData = JSON.parse(apiResp.Body);
    } catch (e) {
      throw new Error("Lỗi parse JSON API reader ở chương: " + chap.title);
    }
    
    const rawEnc = apiData.raw_content || "";
    const transEnc = apiData.translated_content || "";
    
    const rawDec = rawEnc ? decryptContent(rawEnc, cipherKey) : "";
    const transDec = transEnc ? decryptContent(transEnc, cipherKey) : "";
    
    let decrypted = transDec || rawDec;
    if (!decrypted) {
      throw new Error("Giải mã nội dung rỗng ở chương: " + chap.title);
    }
    
    if (transDec && rawDec && rawDec.indexOf("<img") !== -1 && transDec.indexOf("<img") === -1) {
      const imgMatches = rawDec.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/g);
      if (imgMatches) {
        decrypted += "\n" + imgMatches.join("\n");
      }
    }
    
    if (!decrypted.match(/<(p|br|div)[^>]*>/i)) {
      const lines = decrypted.split("\n");
      let wrapped = "";
      for (let j = 0; j < lines.length; j++) {
        const line = lines[j].trim();
        if (line) {
          wrapped += "<p>" + line + "</p>";
        }
      }
      decrypted = wrapped;
    }
    
    decrypted = decrypted.replace(/<span\s+class=["']jkz-trap["']>.*?<\/span>/g, "");
    decrypted = decrypted.replace(/<div\s+class=["']jkz-trap["']>.*?<\/div>/g, "");
    
    const imgUrlRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/g;
    const imageSources = [];
    let imgMatch;

    while ((imgMatch = imgUrlRegex.exec(decrypted)) !== null) {
      const origSrc = imgMatch[1];
      if (imageSources.indexOf(origSrc) === -1) {
        imageSources.push(origSrc);
      }
    }

    const downloadedImages = {};
    const failedImages = {};
    for (let imgIndex = 0; imgIndex < imageSources.length; imgIndex++) {
      const origSrc = imageSources[imgIndex];
      let fullImgUrl = origSrc;
      if (origSrc.indexOf("//") === 0) {
        fullImgUrl = "https:" + origSrc;
      } else if (!origSrc.startsWith("http")) {
        fullImgUrl = origSrc.startsWith("/") ? baseUrl + origSrc : baseUrl + "/" + origSrc;
      }
      
      let imgRespBase64 = null;
      let imageMissing404 = false;
      for (let imgAttempt = 0; imgAttempt < 5; imgAttempt++) {
        try {
          imgRespBase64 = session.GetBinaryBase64(fullImgUrl, { "Referer": chap.url });
          if (imgRespBase64) {
            break;
          }
        } catch (errImg) {
          if (String(errImg.message || "").indexOf("HTTP 404") !== -1) {
            console.log("  [*] Bỏ qua ảnh không tồn tại trên máy chủ: " + fullImgUrl);
            failedImages[origSrc] = true;
            imageMissing404 = true;
            break;
          }
          console.log("  [*] Lỗi tải ảnh (lượt " + (imgAttempt + 1) + "/5): " + errImg.message);
        }
        if (imgAttempt < 4) {
          utils.sleep(1500);
        }
      }
 
      if (imgRespBase64) {
        let ext = origSrc.split(".").pop().split("?")[0].toLowerCase();
        if (!ext || ext.length > 4) ext = "jpg";
        
        const internalFilename = "images/image_" + imageCounter + "." + ext;
        resultImages[internalFilename] = imgRespBase64;
        
        downloadedImages[origSrc] = internalFilename;
        imageCounter++;
      } else {
        failedImages[origSrc] = true;
        if (!imageMissing404) {
          console.log("  [-] Không thể tải ảnh trong chương sau 5 lần thử: " + fullImgUrl);
        }
      }
    }
    
    decrypted = decrypted.replace(imgUrlRegex, function(tag, src) {
      if (!downloadedImages[src]) {
        if (failedImages[src]) {
          return "";
        }
        return tag;
      }
      return tag.replace(src, downloadedImages[src]);
    });

    const finalTitle = cleanTitle || chap.title;
    resultChapters.push({
      id: "chap_" + (resultChapters.length + 1),
      title: finalTitle,
      text: decrypted,
      rawHtml: true
    });
    
    utils.sleep(currentDelay);
  }
  
  console.log("[+] Đã tải và giải mã thành công " + resultChapters.length + " chương!");
  
  return {
    title: novelTitle,
    author: novelAuthor,
    metadata: {
      title: novelTitle,
      creator: novelAuthor,
      language: "vi",
      series: novelTitle,
      coverImage: coverImageBase64
    },
    chapters: resultChapters,
    images: resultImages
  };
}
