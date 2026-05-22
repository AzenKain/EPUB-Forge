# 🔌 EPUBForge Extension Developer Guide

Hướng dẫn chi tiết cách viết extension JavaScript cho EPUBForge. Extension cho phép bạn scrape truyện/light novel từ bất kỳ trang web nào, xử lý nội dung, và đóng gói tự động thành file EPUB chuyên nghiệp — tất cả hoạt động trực tiếp từ giao diện ứng dụng.

---

## 📐 Kiến trúc tổng quan

```
┌──────────────────────────────────────────────────┐
│  EPUBForge Application                           │
│                                                  │
│  ┌────────────┐   ┌───────────────────────────┐  │
│  │ React UI   │◄──┤ Streaming Logs (NDJSON)   │  │
│  │ (Frontend) │   └───────────┬───────────────┘  │
│  └────────────┘               │                  │
│                    ┌──────────▼──────────┐       │
│                    │ Go HTTP Controller  │       │
│                    └──────────┬──────────┘       │
│                    ┌──────────▼──────────┐       │
│                    │   Goja JS Engine    │       │
│                    │  (Sandboxed VM)     │       │
│                    │                     │       │
│                    │  ┌───────────────┐  │       │
│                    │  │ Extension .js │  │       │
│                    │  └───────┬───────┘  │       │
│                    └──────────┼──────────┘       │
│                    ┌──────────▼──────────┐       │
│                    │    Go-Rod Browser   │       │
│                    │  (Headless Chrome)  │       │
│                    │  + Stealth Plugin   │       │
│                    └────────────────────-┘       │
└──────────────────────────────────────────────────┘
```

Mỗi extension là một file JavaScript (`.js`) đặt trong thư mục `extensions/`.

EPUBForge thực thi extension bên trong **Goja** (máy ảo JS viết bằng Go) kết hợp **Go-Rod** (điều khiển trình duyệt Chrome headless). Trình duyệt chạy với plugin **Stealth** để giảm thiểu phát hiện bot và tự động bypass các thử thách Cloudflare cơ bản.

Nếu trang web yêu cầu xác minh captcha thủ công hoặc Turnstile, EPUBForge sẽ chụp ảnh màn hình trình duyệt theo thời gian thực và truyền về giao diện React, cho phép người dùng giải captcha bằng cách click hoặc nhập text trực tiếp.

---

## 📝 Cấu trúc file Extension

Mỗi extension **bắt buộc** phải định nghĩa 2 hàm JavaScript ở phạm vi toàn cục (global scope):

| Hàm | Mô tả |
|-----|-------|
| `register()` | Khai báo metadata và các tham số đầu vào cần từ người dùng |
| `run(params)` | Thực thi logic crawl/scrape và trả về dữ liệu sách đã biên dịch |

```javascript
// my_scraper.js

function register() {
  return {
    id: "my_scraper",          // Phải trùng với tên file (không có .js)
    name: "My Custom Scraper",
    description: "Scrape chương truyện từ my-novel-site.com và đóng gói EPUB.",
    inputs: [
      {
        id: "url",
        type: "text",
        label: "URL Truyện",
        placeholder: "https://my-novel-site.com/series/ten-truyen",
        required: true
      }
    ]
  };
}

function run(params) {
  console.log("[*] Bắt đầu scrape: " + params.url);
  const session = http.newSession();
  // Logic scrape ở đây...
  return {
    title: "Tên Truyện",
    author: "Tên Tác Giả",
    chapters: [
      { id: "chap_1", title: "Chương 1", text: "<p>Nội dung...</p>", rawHtml: true }
    ]
  };
}
```

---

## 🏷️ Schema hàm `register()`

Hàm `register()` phải trả về một object JSON mô tả extension và các input cần thiết:

### Cấu trúc `ExtensionMeta`

| Trường | Kiểu | Bắt buộc | Mô tả |
|--------|------|----------|-------|
| `id` | `string` | ✅ | ID duy nhất của extension. **Phải trùng tên file** (ví dụ: file `jukaza2epub.js` → `id: "jukaza2epub"`) |
| `name` | `string` | ✅ | Tên hiển thị trên giao diện UI |
| `description` | `string` | ✅ | Mô tả ngắn gọn chức năng của extension |
| `inputs` | `InputSchema[]` | ✅ | Mảng các trường nhập liệu cần từ người dùng |

### Cấu trúc `InputSchema`

| Trường | Kiểu | Bắt buộc | Mô tả |
|--------|------|----------|-------|
| `id` | `string` | ✅ | Tên tham số — sẽ truy cập được qua `params.id` trong hàm `run()` |
| `type` | `string` | ✅ | Loại trường nhập trên UI. Giá trị hợp lệ: `"text"`, `"password"`, `"number"`, `"boolean"` |
| `label` | `string` | ✅ | Nhãn hiển thị bên cạnh trường nhập |
| `placeholder` | `string` | ❌ | Văn bản gợi ý bên trong trường nhập |
| `defaultValue` | `any` | ❌ | Giá trị mặc định khi người dùng chưa nhập |
| `required` | `boolean` | ❌ | Đặt `true` nếu trường bắt buộc phải nhập |

**Ví dụ đầy đủ:**

```javascript
function register() {
  return {
    id: "my_novel_scraper",
    name: "MyNovel Downloader",
    description: "Tải và đóng gói truyện chữ từ mynovel.com",
    inputs: [
      {
        id: "url",
        type: "text",
        label: "URL bộ truyện",
        placeholder: "https://mynovel.com/truyen/ten-truyen",
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
        id: "maxChapters",
        type: "number",
        label: "Số chương tối đa (0 = tất cả)",
        defaultValue: 0,
        required: false
      }
    ]
  };
}
```

---

## 🌐 Browser Session API

EPUBForge inject đối tượng toàn cục `http` vào sandbox JS để tạo phiên trình duyệt headless.

### Khởi tạo Session

```javascript
const session = http.newSession();
```

Mỗi lần gọi `http.newSession()` sẽ tạo một **tab trình duyệt mới** (Rod Page) với cookie riêng biệt. Session này hoạt động như một trình duyệt thật — có thể đăng nhập, giữ session, và tải tài nguyên.

---

### `session.Get(url, headers)`

Điều hướng trình duyệt tới URL hoặc gửi network request tùy theo ngữ cảnh.

**Quy tắc phân loại tự động:**

| Điều kiện | Hành vi |
|-----------|---------|
| URL chứa `/api/` hoặc kết thúc bằng `.json` | Gọi `fetch()` bên trong trang hiện tại (sub-request) |
| Headers chứa `"Accept": "application/json"` | Gọi `fetch()` bên trong trang hiện tại (sub-request) |
| Headers chứa `"X-Requested-With"` | Gọi `fetch()` bên trong trang hiện tại (sub-request) |
| Các trường hợp khác | `Navigate()` trình duyệt đến URL, chờ DOM ổn định, tự xử lý Cloudflare |

**Tham số:**

| Tham số | Kiểu | Mô tả |
|---------|------|-------|
| `url` | `string` | URL đích |
| `headers` | `object` | Object chứa các HTTP headers. Truyền `{}` nếu không cần header đặc biệt |

**Trả về:** Object `Response`

```javascript
{
  Status: 200,          // HTTP status code (số nguyên)
  Body: "<html>...",    // Nội dung body dưới dạng chuỗi (HTML hoặc JSON text)
  Headers: { ... }      // Map các response headers
}
```

**Ví dụ - Tải trang HTML:**

```javascript
const resp = session.Get("https://example.com/truyen/ten-truyen", {});
if (resp.Status === 200) {
  const html = resp.Body;
  // Phân tích HTML...
}
```

**Ví dụ - Gọi JSON API (sub-request):**

```javascript
const apiResp = session.Get("https://example.com/api/chapters/123", {
  "X-Requested-With": "XMLHttpRequest",
  "Accept": "application/json",
  "Referer": "https://example.com/truyen/ten-truyen"
});
if (apiResp.Status === 200) {
  const data = JSON.parse(apiResp.Body);
}
```

> **Lưu ý quan trọng:** Khi dùng sub-request (`fetch()`), trình duyệt phải đã navigate tới một trang trước đó. Nếu trang hiện tại là `about:blank`, request sẽ tự chuyển sang chế độ Navigate.

---

### `session.Post(url, payload, headers)`

Gửi POST request bên trong ngữ cảnh trình duyệt hiện tại.

**Tham số:**

| Tham số | Kiểu | Mô tả |
|---------|------|-------|
| `url` | `string` | URL đích |
| `payload` | `object` | Dữ liệu gửi đi. Tự động encode tùy theo Content-Type |
| `headers` | `object` | HTTP headers |

**Quy tắc encoding payload:**

| Content-Type Header | Encoding |
|---------------------|----------|
| `"application/json"` | `JSON.stringify(payload)` |
| Khác hoặc không set | `x-www-form-urlencoded` (key=value&key2=value2) |

**Trả về:** Object `Response` (giống `session.Get`)

**Ví dụ - Đăng nhập form:**

```javascript
const loginResp = session.Post("https://example.com/login", {
  _token: csrfToken,
  username: params.username,
  password: params.password,
  remember: "on"
}, {
  "Referer": "https://example.com/login",
  "Content-Type": "application/x-www-form-urlencoded"
});
```

**Ví dụ - Gửi JSON API:**

```javascript
const resp = session.Post("https://example.com/api/bookmark", {
  chapterId: 123,
  position: 50
}, {
  "Content-Type": "application/json",
  "Accept": "application/json"
});
```

---

### `session.GetBinaryBase64(url, headers)`

Tải tài nguyên nhị phân (ảnh, font, v.v.) sử dụng cookie session của trình duyệt.

**Tham số:**

| Tham số | Kiểu | Mô tả |
|---------|------|-------|
| `url` | `string` | URL tài nguyên nhị phân |
| `headers` | `object` | HTTP headers (thường cần `Referer`) |

**Trả về:** `string` — Chuỗi Base64 thuần (**không có** prefix `data:image/...;base64,`)

**Ví dụ - Tải ảnh bìa:**

```javascript
const coverBase64 = session.GetBinaryBase64("https://example.com/cover.jpg", {
  "Referer": "https://example.com"
});
// coverBase64 = "iVBORw0KGgo..." (Base64 thuần, không có data URI prefix)

// Để dùng làm coverImage trong metadata, thêm data URI prefix:
const coverDataUri = "data:image/jpeg;base64," + coverBase64;
```

---

### `session.HasCookie(cookieName)`

Kiểm tra session trình duyệt hiện tại có cookie cụ thể hay không.

**Tham số:**

| Tham số | Kiểu | Mô tả |
|---------|------|-------|
| `cookieName` | `string` | Tên cookie cần kiểm tra (hỗ trợ tìm kiếm partial match) |

**Trả về:** `boolean`

**Ví dụ:**

```javascript
if (!session.HasCookie("my-session-token")) {
  throw new Error("Đăng nhập thất bại!");
}
```

---

## ⚡ Global Utilities

Các API toàn cục được inject sẵn vào sandbox:

### `console.log(...args)`

Gửi tin nhắn log theo thời gian thực tới giao diện React UI. Hỗ trợ nhiều tham số.

```javascript
console.log("[*] Đang tải chương:", chapterTitle);
console.log("[+] Hoàn tất:", count, "chương");
```

---

### `utils.sleep(ms)`

Tạm dừng thực thi trong khoảng thời gian chỉ định (mili-giây). **Rất quan trọng** để tránh bị rate limit (HTTP 429) khi scrape.

```javascript
utils.sleep(1500);  // Nghỉ 1.5 giây giữa mỗi request
```

---

### `utils.base64ToBytes(str)`

Giải mã chuỗi Base64 thành mảng byte. Được thực thi bằng Go native nên rất nhanh.

| Tham số | Kiểu | Mô tả |
|---------|------|-------|
| `str` | `string` | Chuỗi Base64 hợp lệ |

**Trả về:** Mảng byte Go (`[]byte`) — trong JS có thể truy cập `.length` và index `arr[i]` như mảng bình thường.

```javascript
const bytes = utils.base64ToBytes("SGVsbG8gV29ybGQ=");
console.log(bytes.length);  // 11
console.log(bytes[0]);      // 72 (= 'H')
```

---

### `utils.bytesToBase64(bytes)`

Mã hóa mảng byte thành chuỗi Base64.

| Tham số | Kiểu | Mô tả |
|---------|------|-------|
| `bytes` | `Uint8Array` hoặc Go `[]byte` | Mảng byte cần mã hóa |

**Trả về:** `string` — Chuỗi Base64

```javascript
const b64 = utils.bytesToBase64(myBytes);
```

---

### `utils.stringToBytes(str)`

Chuyển đổi chuỗi JS thành mảng byte UTF-8.

| Tham số | Kiểu | Mô tả |
|---------|------|-------|
| `str` | `string` | Chuỗi JS cần chuyển đổi |

**Trả về:** Mảng byte Go (`[]byte`)

```javascript
const keyBytes = utils.stringToBytes("secret_key");
console.log(keyBytes.length);  // 10
```

---

### `utils.bytesToString(bytes)`

Chuyển đổi mảng byte UTF-8 thành chuỗi JS.

| Tham số | Kiểu | Mô tả |
|---------|------|-------|
| `bytes` | `Uint8Array` hoặc Go `[]byte` | Mảng byte UTF-8 |

**Trả về:** `string`

```javascript
const text = utils.bytesToString(decryptedBytes);
```

---

### Ví dụ tổng hợp: Giải mã XOR

Nhiều trang web mã hóa nội dung chương bằng XOR + Base64. Dưới đây là pattern giải mã hoàn chỉnh:

```javascript
function decryptContent(encryptedBase64, cipherKey) {
  // 1. Giải mã Base64 → byte array
  const encryptedBytes = utils.base64ToBytes(encryptedBase64);
  const keyBytes = utils.stringToBytes(cipherKey);

  // 2. XOR giải mã
  const decryptedBytes = new Uint8Array(encryptedBytes.length);
  for (let i = 0; i < encryptedBytes.length; i++) {
    decryptedBytes[i] = encryptedBytes[i] ^ keyBytes[i % keyBytes.length];
  }

  // 3. Kết quả XOR → chuỗi Base64 → giải mã lần 2 → text
  const intermediateBase64 = utils.bytesToString(decryptedBytes);
  const finalBytes = utils.base64ToBytes(intermediateBase64);
  return utils.bytesToString(finalBytes);
}
```

---

## 📦 Giá trị trả về của `run(params)` — Chi tiết đầy đủ

Hàm `run(params)` phải trả về dữ liệu sách theo một trong **3 định dạng** dưới đây. EPUBForge sẽ tự động nhận diện format và đóng gói thành file EPUB.

### Cấu trúc dữ liệu Ebook

Trước tiên, hãy hiểu rõ cấu trúc **một đối tượng Ebook** — đây là đơn vị cơ bản mà cả 3 format đều sử dụng:

```javascript
{
  title: "Tên Sách",                    // [BẮT BUỘC] Tiêu đề sách
  author: "Tên Tác Giả",               // [TÙY CHỌN] Tên tác giả (mặc định: "Khuyết danh")
  direction: "ltr",                     // [TÙY CHỌN] Hướng đọc: "ltr" (trái→phải) hoặc "rtl" (phải→trái, cho manga)
  metadata: { ... },                    // [TÙY CHỌN] Metadata chi tiết của sách
  chapters: [ ... ],                    // [BẮT BUỘC] Mảng các chương (ít nhất 1 chương)
  images: { ... }                       // [TÙY CHỌN] Map các ảnh nhúng trong sách
}
```

---

#### Chi tiết trường `metadata`

Object metadata chứa thông tin mô tả sách theo chuẩn EPUB/OPF:

| Trường | Kiểu | Bắt buộc | Mô tả |
|--------|------|----------|-------|
| `title` | `string` | ❌ | Tiêu đề sách. Nếu có, sẽ **ghi đè** trường `title` ở cấp ngoài |
| `creator` | `string` | ❌ | Tên tác giả. Nếu có, sẽ **ghi đè** trường `author` ở cấp ngoài |
| `language` | `string` | ❌ | Mã ngôn ngữ ISO 639-1 (mặc định: `"vi"`) |
| `publisher` | `string` | ❌ | Nhà xuất bản |
| `description` | `string` | ❌ | Mô tả/tóm tắt nội dung sách |
| `subject` | `string` | ❌ | Chủ đề / thể loại (ví dụ: `"Fantasy, Action"`) |
| `series` | `string` | ❌ | Tên bộ truyện (cho calibre: `calibre:series`) |
| `seriesIndex` | `string` | ❌ | Số thứ tự tập trong bộ (ví dụ: `"1"`, `"2.5"`) |
| `coverImage` | `string` | ❌ | Ảnh bìa dạng **Data URI** đầy đủ (xem bên dưới) |

**Định dạng `coverImage`:**

Trường `coverImage` phải là chuỗi Data URI hoàn chỉnh bao gồm prefix MIME type:

```
data:image/jpeg;base64,/9j/4AAQSkZJRg...
data:image/png;base64,iVBORw0KGgo...
data:image/webp;base64,UklGRlYA...
data:image/gif;base64,R0lGODlh...
```

**Ví dụ tạo coverImage từ URL:**

```javascript
const coverB64 = session.GetBinaryBase64("https://example.com/cover.jpg", {
  "Referer": "https://example.com"
});
// GetBinaryBase64 trả về Base64 thuần, cần thêm prefix:
const coverDataUri = "data:image/jpeg;base64," + coverB64;

// Sử dụng trong metadata:
metadata: {
  coverImage: coverDataUri
}
```

**Ví dụ metadata đầy đủ:**

```javascript
metadata: {
  title: "Sword Art Online - Tập 01: Aincrad",
  creator: "Kawahara Reki",
  language: "vi",
  publisher: "IPM",
  description: "Câu chuyện về Kirito trong thế giới game thực tế ảo SAO.",
  subject: "Light Novel, Fantasy, Action",
  series: "Sword Art Online",
  seriesIndex: "1",
  coverImage: "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
}
```

---

#### Chi tiết trường `chapters`

Mảng các chương sách. Mỗi chương là một object với cấu trúc:

| Trường | Kiểu | Bắt buộc | Mô tả |
|--------|------|----------|-------|
| `id` | `string` | ✅ | ID duy nhất của chương (ví dụ: `"chap_1"`, `"vol1_ch01"`) |
| `title` | `string` | ✅ | Tiêu đề chương hiển thị trong mục lục |
| `text` | `string` | ✅ | Nội dung chương (plain text hoặc HTML) |
| `rawHtml` | `boolean` | ❌ | `true` = giữ nguyên HTML tags. `false`/không set = text thuần, tự wrap `<p>` |
| `mode` | `string` | ❌ | `"manga"` = chương ảnh manga. Mặc định: chương text thường |
| `mangaDirection` | `string` | ❌ | Hướng đọc manga: `"rtl"` (phải→trái, kiểu Nhật) hoặc `"ltr"` |
| `imageFileNames` | `string[]` | ❌ | Danh sách tên file ảnh cho chương manga (dùng với `mode: "manga"`) |

**Ví dụ chương text thường (plain text):**

```javascript
{
  id: "chap_1",
  title: "Chương 1: Khởi đầu",
  text: "Đây là đoạn văn đầu tiên.\n\nĐây là đoạn văn thứ hai.",
  rawHtml: false
  // Kết quả EPUB: mỗi dòng tự động wrap thành <p>...</p>
}
```

**Ví dụ chương HTML (rawHtml):**

```javascript
{
  id: "chap_5",
  title: "Chương 5: Trận chiến",
  text: '<p>Kirito rút kiếm.</p><p>"Hãy chiến đấu!" — Asuna hét lớn.</p><img src="images/battle_01.jpg" />',
  rawHtml: true
  // Kết quả EPUB: HTML được giữ nguyên, không wrap thêm <p>
}
```

> **Lưu ý:** Khi `rawHtml: true`, đường dẫn ảnh trong HTML (thuộc tính `src` của `<img>`) nên là đường dẫn tương đối trỏ tới key trong map `images` (xem phần tiếp theo).

---

#### Chi tiết trường `images`

Object map chứa các ảnh nhúng bên trong EPUB. Key là **đường dẫn tương đối** của ảnh bên trong cấu trúc EPUB, value là **chuỗi Base64** của ảnh đó.

| Thành phần | Kiểu | Mô tả |
|------------|------|-------|
| Key | `string` | Đường dẫn tương đối trong EPUB (ví dụ: `"images/img_01.jpg"`) |
| Value | `string` | Dữ liệu ảnh dạng Base64 (có hoặc không có Data URI prefix đều được) |

**Hai định dạng value được chấp nhận:**

```javascript
// Cách 1: Base64 thuần (khuyến nghị — kết quả trả về từ GetBinaryBase64)
"images/img_01.jpg": "iVBORw0KGgoAAAANSUhEU..."

// Cách 2: Data URI đầy đủ (hệ thống tự cắt prefix)
"images/img_01.jpg": "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
```

**Cách liên kết ảnh với nội dung chương:**

1. Trong HTML của chương, sử dụng tag `<img>` với `src` trỏ tới key trong map `images`
2. Key path phải khớp chính xác với `src` trong HTML

```javascript
// Trong chapter text (rawHtml: true):
text: '<p>Một bức tranh minh họa:</p><img src="images/illustration_01.jpg" />'

// Trong map images:
images: {
  "images/illustration_01.jpg": "iVBORw0KGgoAAAANSUhEU..."
}
```

**Ví dụ tải và map ảnh:**

```javascript
const resultImages = {};
let imageCounter = 1;

// Tìm tất cả tag <img> trong HTML chương
const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/g;
let imgMatch;

while ((imgMatch = imgRegex.exec(chapterHtml)) !== null) {
  const originalSrc = imgMatch[1];
  const fullUrl = originalSrc.startsWith("http") ? originalSrc : baseUrl + originalSrc;

  // Tải ảnh dạng Base64
  const imgBase64 = session.GetBinaryBase64(fullUrl, { "Referer": baseUrl });

  if (imgBase64) {
    // Xác định extension
    let ext = originalSrc.split(".").pop().split("?")[0].toLowerCase();
    if (!ext || ext.length > 4) ext = "jpg";

    // Tạo key path nội bộ
    const internalPath = "images/image_" + imageCounter + "." + ext;
    resultImages[internalPath] = imgBase64;

    // Thay thế src trong HTML chương
    chapterHtml = chapterHtml.replace(originalSrc, internalPath);
    imageCounter++;
  }
}
```

---

### Format A: Trả về một EPUB duy nhất (Single Ebook)

Dùng khi URL scrape ra một cuốn sách duy nhất. Đây là format phổ biến nhất.

```javascript
function run(params) {
  // ... logic scrape ...

  return {
    title: "Tên Truyện",
    author: "Tên Tác Giả",
    metadata: {
      title: "Tên Truyện",
      creator: "Tên Tác Giả",
      language: "vi",
      publisher: "NXB ABC",
      description: "Mô tả ngắn về truyện...",
      series: "Tên Bộ Truyện",
      seriesIndex: "1",
      coverImage: "data:image/jpeg;base64,..."
    },
    chapters: [
      {
        id: "chap_1",
        title: "Chương 1: Khởi Đầu",
        text: "<p>Nội dung chương 1...</p>",
        rawHtml: true
      },
      {
        id: "chap_2",
        title: "Chương 2: Cuộc Phiêu Lưu",
        text: "<p>Nội dung chương 2...</p><img src=\"images/map.png\" />",
        rawHtml: true
      }
    ],
    images: {
      "images/map.png": "iVBORw0KGgoAAAANSUhEU..."
    }
  };
}
```

**Kết quả:** EPUBForge tạo 1 file EPUB → `Tên Truyện.epub`

---

### Format B: Trả về nhiều tập (Direct Array)

Dùng khi một URL chứa nhiều tập/volume và bạn muốn tạo **nhiều file EPUB riêng biệt** cùng lúc. Trả về mảng trực tiếp.

```javascript
function run(params) {
  // ... logic scrape tất cả volumes ...

  return [
    {
      title: "Sword Art Online - Tập 01",
      author: "Kawahara Reki",
      metadata: {
        title: "Sword Art Online - Tập 01",
        creator: "Kawahara Reki",
        language: "vi",
        series: "Sword Art Online",
        seriesIndex: "1",
        coverImage: "data:image/jpeg;base64,..."
      },
      chapters: [
        { id: "v1_ch1", title: "Chương 1", text: "<p>...</p>", rawHtml: true },
        { id: "v1_ch2", title: "Chương 2", text: "<p>...</p>", rawHtml: true }
      ],
      images: { }
    },
    {
      title: "Sword Art Online - Tập 02",
      author: "Kawahara Reki",
      metadata: {
        title: "Sword Art Online - Tập 02",
        creator: "Kawahara Reki",
        language: "vi",
        series: "Sword Art Online",
        seriesIndex: "2",
        coverImage: "data:image/jpeg;base64,..."
      },
      chapters: [
        { id: "v2_ch1", title: "Chương 1", text: "<p>...</p>", rawHtml: true },
        { id: "v2_ch2", title: "Chương 2", text: "<p>...</p>", rawHtml: true }
      ],
      images: { }
    }
  ];
}
```

**Kết quả:** EPUBForge tạo 2 file EPUB → `Sword Art Online - Tập 01.epub` + `Sword Art Online - Tập 02.epub`

---

### Format C: Trả về nhiều tập (Wrapped Object)

Tương tự Format B, nhưng mảng ebook được bọc trong object dưới key `ebooks`. Hai format hoạt động tương đương.

```javascript
function run(params) {
  return {
    ebooks: [
      {
        title: "Tên Truyện - Tập 01",
        author: "Tác Giả",
        metadata: { title: "Tên Truyện - Tập 01", creator: "Tác Giả", language: "vi" },
        chapters: [ /* ... */ ],
        images: { }
      },
      {
        title: "Tên Truyện - Tập 02",
        author: "Tác Giả",
        metadata: { title: "Tên Truyện - Tập 02", creator: "Tác Giả", language: "vi" },
        chapters: [ /* ... */ ],
        images: { }
      }
    ]
  };
}
```

**Kết quả:** Giống Format B — EPUBForge tạo nhiều file EPUB riêng biệt.

---

### Sơ đồ xử lý Return Value

```
run(params) trả về
        │
        ▼
   ┌─ Là Object? ──────────────────────┐
   │                                    │
   │  Có key "ebooks"?                  │ Không phải object
   │  ├── Có → Lấy mảng ebooks[...]    │
   │  │        → Tạo N file EPUB       │
   │  └── Không → Coi object này       │
   │              là 1 ebook duy nhất   │
   │              → Tạo 1 file EPUB    │
   │                                    │
   └────────────────────────────────────┘
                    │
                    ▼
            ┌── Là Array? ──┐
            │               │
            │  Duyệt từng   │  Không hợp lệ
            │  phần tử       │  → Ném lỗi
            │  → Tạo N file │
            │     EPUB      │
            └───────────────┘
```

---

### Bảng tóm tắt tất cả trường

| Trường | Vị trí | Kiểu | Bắt buộc | Mô tả |
|--------|--------|------|----------|-------|
| `title` | Root | `string` | ✅ | Tiêu đề sách (cũng là tên file EPUB) |
| `author` | Root | `string` | ❌ | Tác giả (mặc định: "Khuyết danh") |
| `direction` | Root | `string` | ❌ | Hướng đọc: `"ltr"` / `"rtl"` |
| `metadata` | Root | `object` | ❌ | Metadata EPUB chi tiết |
| `metadata.title` | Metadata | `string` | ❌ | Ghi đè `title` ngoài |
| `metadata.creator` | Metadata | `string` | ❌ | Ghi đè `author` ngoài |
| `metadata.language` | Metadata | `string` | ❌ | Ngôn ngữ ISO 639-1 |
| `metadata.publisher` | Metadata | `string` | ❌ | Nhà xuất bản |
| `metadata.description` | Metadata | `string` | ❌ | Mô tả sách |
| `metadata.subject` | Metadata | `string` | ❌ | Thể loại/chủ đề |
| `metadata.series` | Metadata | `string` | ❌ | Tên bộ truyện |
| `metadata.seriesIndex` | Metadata | `string` | ❌ | Số thứ tự tập |
| `metadata.coverImage` | Metadata | `string` | ❌ | Ảnh bìa Data URI |
| `chapters` | Root | `array` | ✅ | Mảng các chương |
| `chapters[].id` | Chapter | `string` | ✅ | ID duy nhất của chương |
| `chapters[].title` | Chapter | `string` | ✅ | Tiêu đề chương |
| `chapters[].text` | Chapter | `string` | ✅ | Nội dung (text/HTML) |
| `chapters[].rawHtml` | Chapter | `boolean` | ❌ | Giữ nguyên HTML? |
| `chapters[].mode` | Chapter | `string` | ❌ | `"manga"` cho chương ảnh |
| `chapters[].mangaDirection` | Chapter | `string` | ❌ | `"rtl"` / `"ltr"` cho manga |
| `chapters[].imageFileNames` | Chapter | `string[]` | ❌ | File ảnh cho chương manga |
| `images` | Root | `object` | ❌ | Map path→Base64 ảnh nhúng |
| `ebooks` | Root | `array` | ❌ | Mảng ebook (Format C) |

---

## 💡 Best Practices & Patterns

### 1. Xử lý Rate Limit (HTTP 429)

Hầu hết các trang web novel đều có cơ chế chống DDoS. **Luôn** implement retry với progressive backoff:

```javascript
function fetchWithRetry(session, url, headers, maxAttempts) {
  if (!maxAttempts) maxAttempts = 10;
  let attempt = 0;

  while (attempt < maxAttempts) {
    try {
      const resp = session.Get(url, headers || {});
      if (resp && resp.Status === 200) return resp;

      console.log("  [!] HTTP " + resp.Status + " - Có thể bị rate limit");
    } catch (e) {
      console.log("  [!] Lỗi kết nối: " + e.message);
    }

    attempt++;
    if (attempt < maxAttempts) {
      // Backoff: 2s → 4s → 8s → 16s → 30s (cap)
      const delay = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
      console.log("  [*] Thử lại sau " + (delay / 1000) + "s (lượt " + (attempt + 1) + "/" + maxAttempts + ")...");
      utils.sleep(delay);
    }
  }
  throw new Error("Thất bại sau " + maxAttempts + " lần thử: " + url);
}
```

**Quan trọng:** Luôn thêm delay giữa mỗi chương:

```javascript
for (let i = 0; i < chapters.length; i++) {
  // ... tải chương ...
  utils.sleep(1500);  // Nghỉ 1.5s giữa mỗi chương
}
```

### 2. Dọn dẹp HTML

Trang crawl thường chứa trap spans, quảng cáo, phần tử chống copy. Loại bỏ trước khi trả về:

```javascript
// Loại bỏ trap spans/divs
html = html.replace(/<span\s+class=["']trap["']>.*?<\/span>/g, "");
html = html.replace(/<div\s+class=["']ad-block["']>[\s\S]*?<\/div>/g, "");

// Loại bỏ script tags
html = html.replace(/<script[\s\S]*?<\/script>/g, "");

// Loại bỏ inline styles nếu cần
html = html.replace(/\s+style=["'][^"']*["']/g, "");
```

### 3. Xử lý đăng nhập

```javascript
// 1. Tải trang login để lấy CSRF token
const loginPage = session.Get("https://site.com/login", {});
const csrfToken = loginPage.Body.match(/name=["']_token["']\s+value=["']([^"']+)["']/)[1];

// 2. POST form đăng nhập
session.Post("https://site.com/login", {
  _token: csrfToken,
  username: params.username,
  password: params.password
}, {
  "Content-Type": "application/x-www-form-urlencoded",
  "Referer": "https://site.com/login"
});

// 3. Kiểm tra đăng nhập thành công
if (!session.HasCookie("session-name")) {
  throw new Error("Đăng nhập thất bại! Kiểm tra lại tài khoản/mật khẩu.");
}
```

### 4. Xử lý lỗi

Sử dụng `throw new Error(message)` khi gặp lỗi nghiêm trọng. EPUBForge sẽ bắt exception, dọn dẹp tài nguyên (đóng trình duyệt), và hiển thị lỗi trên giao diện React.

```javascript
if (chapters.length === 0) {
  throw new Error("Không tìm thấy chương truyện nào để tải.");
}

if (!apiResp || apiResp.Status !== 200) {
  throw new Error("API trả về lỗi ở chương: " + chapterTitle);
}
```

### 5. Wrap plain text thành HTML

Nếu nội dung chương là text thuần (không có HTML tags), wrap mỗi đoạn văn thành `<p>`:

```javascript
// Kiểm tra có phải HTML không
if (!content.match(/<(p|br|div)[^>]*>/i)) {
  const lines = content.split("\n");
  let wrapped = "";
  for (let j = 0; j < lines.length; j++) {
    const line = lines[j].trim();
    if (line) {
      wrapped += "<p>" + line + "</p>";
    }
  }
  content = wrapped;
}
```

Hoặc đơn giản hơn, đặt `rawHtml: false` trong chapter object — EPUBForge sẽ tự wrap.

### 6. Dừng Extension

Extension sẽ chạy cho đến khi hoàn tất hoặc người dùng bấm nút **"Dừng (Ngắt)"** trên giao diện. Không có giới hạn thời gian chạy.
