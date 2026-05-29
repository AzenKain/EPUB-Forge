# Hướng dẫn sử dụng EPUBForge

Tài liệu này mô tả toàn bộ các luồng sử dụng chính của EPUBForge: quản lý sách trong workspace, chỉnh sửa EPUB, tách/gộp volume, tạo EPUB mới, tối ưu, sửa lỗi, tải truyện bằng extension và cập nhật ứng dụng.

Nếu bạn cần bản ngắn, dễ đọc và có ảnh minh họa cho người dùng phổ thông, xem `docs/user-guide-basic.md`.

## 1. Tổng quan

EPUBForge là công cụ làm việc trực tiếp với EPUB qua giao diện web chạy từ backend Go. Khi mở ứng dụng, server nội bộ khởi động ở `http://127.0.0.1:5180` và tự mở trình duyệt mặc định.

Các thư mục quan trọng:

- `edit/`: thư mục làm việc chính. EPUB đang quản lý/chỉnh sửa nằm ở đây.
- `output/`: nơi lưu EPUB được tách volume hoặc xuất ra từ một số tác vụ.
- `extensions/`: nơi chứa extension `.js` do người dùng thêm.
- `extensions/origin/`: extension chính thức/bundled của app.
- `dist-native/`: binary native sau khi build.
- `cmd/epubforge/dist/`: frontend đã build để nhúng vào server Go.

Lưu ý an toàn: nhiều thao tác như sửa chương, đổi metadata, tối ưu, nhúng font, sửa EPUB, gallery và gộp chương sẽ ghi trực tiếp vào file trong `edit/`. Nếu file quan trọng, hãy giữ một bản sao riêng trước khi thao tác lớn. Nút Hoàn tác chỉ bật khi backend có snapshot undo; không nên xem Undo là cơ chế backup chính.

## 2. Khởi động ứng dụng

Chạy bản native đã build:

```powershell
.\dist-native\epubforge-windows-amd64.exe
```

Hoặc chạy từ source:

```bash
npm install
npm run build
npm run native
```

Biến môi trường hữu ích:

- `PORT=5180`: đổi cổng server nội bộ.
- `NO_OPEN=1`: không tự mở trình duyệt sau khi server chạy.

Các lệnh build:

- `npm run native:build`: build Windows.
- `npm run native:build:mac`: build macOS.
- `npm run native:build:linux`: build Linux.
- `npm run native:build:all`: build tất cả nền tảng.
- `npm run typecheck`: kiểm tra TypeScript.

## 3. Quản lý thư viện EPUB

Thanh bên trái là khu vực quản lý sách.

Các thao tác chính:

- Mở sách: chọn một hoặc nhiều file `.epub` từ máy. App copy sách vào `edit/`.
- Quét lại: quét lại thư mục `edit/`.
- Gộp EPUB: mở công cụ gộp nhiều file EPUB thành một.
- Tạo EPUB: tạo EPUB mới từ text, DOCX hoặc ảnh manga.
- Tiện ích mở rộng: mở Extension Center để tải truyện từ website.
- Thu gọn/mở rộng sidebar: nút ở phần logo.
- Chọn sách: click tên sách để phân tích và mở workspace.
- Đổi tên sách: nút bút chì trên từng sách.
- Xóa sách: nút thùng rác trên từng sách.
- Chọn nhiều: bật chế độ chọn hàng loạt để xóa nhiều sách.

Khi upload nhiều sách cùng lúc, app sẽ chọn sách upload cuối cùng sau khi hoàn tất.

## 4. Workspace chỉnh sửa sách

Khi chọn một EPUB, app phân tích:

- Metadata: tiêu đề, tác giả, ngôn ngữ, nhà xuất bản, mô tả, series, bìa.
- Spine: danh sách chương/file đọc theo thứ tự.
- TOC: mục lục NCX/EPUB3 nav nếu có.
- Ảnh và tài nguyên nội bộ.
- Volume tự phát hiện.
- Dung lượng file.

Thanh trên cùng gồm:

- Hoàn tác: undo thay đổi gần nhất nếu backend đang có snapshot.
- Metadata: sửa thông tin sách và bìa.
- Phông chữ: nhúng font tiếng Việt hoặc font tùy chỉnh.
- Gallery: tạo trang gallery minh họa và tải ảnh trong sách.
- Tối ưu: dọn tài nguyên, nén ảnh, dọn HTML.
- Kiểm tra & Sửa: validate EPUB và áp dụng các sửa lỗi có thể tự động hóa.
- Tìm & Thay: tìm và thay thế text/regex trong chương.

Workspace có ba panel chính:

- Danh sách chương ở trái.
- Preview ở giữa.
- Volumes ở phải.

## 5. Danh sách chương

Panel Danh sách chương hiển thị toàn bộ spine item/chương theo thứ tự đọc.

Thao tác với chương:

- Click chương để xem preview.
- Kéo thả một chương để đổi thứ tự spine.
- Đổi tên chương bằng nút bút chì.
- Thêm chương mới sau chương đang preview.
- Xóa chương khỏi luồng đọc.
- Tách tự động một chương dựa trên heading từ `h1` đến `h6`.
- Chọn nhiều để gộp hoặc xóa nhiều chương.

Gộp chương thủ công:

- Bật Chọn nhiều.
- Chọn các chương cần gộp.
- Bấm Gộp.
- Sắp xếp thứ tự gộp bằng nút lên/xuống.
- Thêm hoặc bỏ chương khỏi danh sách gộp.
- Chọn tên chương sau khi gộp.
- Tùy chọn xóa tiêu đề chương phụ trong nội dung gộp.

Gộp chương thông minh:

- Bấm Quét gộp.
- App tự phát hiện các chương bị chia nhỏ như `Chương 1.1`, `Chương 1.2`, `10a`, `10b`, `Phần 1`, `Phần 2`, hậu tố La Mã, chữ cái hoặc nhãn đầu/giữa/cuối.
- Chọn hoặc bỏ chọn từng nhóm.
- Sửa tiêu đề sau gộp cho từng nhóm.
- Bỏ riêng từng fragment nếu không muốn gộp fragment đó.
- Chọn tự động xóa tiêu đề chương phụ.
- Sau khi gộp, app cập nhật lại spine và mục lục, gồm NCX, EPUB3 nav và các trang TOC hiển thị nếu EPUB có.

## 6. Preview chương

Panel Preview hiển thị chương hiện tại trong iframe.

Chế độ thiết bị:

- Tự do.
- Kindle.
- Mobile.
- Tablet.

Tùy chỉnh đọc thử:

- Chủ đề sáng/kem.
- Chủ đề sepia.
- Chủ đề tối.
- Tăng/giảm cỡ chữ từ 80% đến 200%.
- Căn đều hai bên hoặc căn trái.
- Phóng to để xem preview trong modal lớn.
- Sửa chương để mở editor nội dung.

Preview chỉ là lớp giả lập hiển thị. Các lựa chọn theme/cỡ chữ trong preview không tự ghi vào EPUB.

## 7. Sửa nội dung chương

Bấm Sửa chương trong Preview để mở trình sửa chương.

Editor có hai chế độ:

- Visual: chỉnh sửa trực quan trong vùng content editable.
- Raw HTML: chỉnh trực tiếp XHTML/HTML với highlight cú pháp.

Thanh công cụ Visual:

- Đậm, nghiêng, gạch chân, gạch ngang.
- Chuyển block sang `H2`, `H4`, `P`.
- Căn trái, giữa, phải.
- Danh sách bullet và danh sách số.
- Xóa định dạng.
- Dọn dẹp.
- Chèn chú thích/footnote.
- Format HTML.

Raw HTML:

- Hiển thị highlight HTML.
- Đồng bộ scroll giữa textarea và highlight.
- Phím Tab chèn hai dấu cách.
- Có nút format lại HTML.

Dọn dẹp chương:

- Xóa inline style và style rác.
- Xóa dòng/đoạn trống.
- Chuẩn hóa paragraph.
- Regex lọc quảng cáo/rác, mỗi dòng một regex.
- Chuẩn hóa typography tiếng Việt:
  - ngoặc kép thông minh,
  - chuẩn hóa dấu thanh,
  - sửa khoảng cách dấu câu.

Khi lưu, app ghi lại nội dung chương vào EPUB và refresh preview. Các đường dẫn ảnh/tài nguyên nội bộ được rewrite để hiển thị đúng trong editor rồi trả về đường dẫn tương đối hợp lệ khi lưu.

## 8. Metadata và bìa sách

Mở từ nút Metadata trên topbar.

Trường metadata:

- Title.
- Author.
- Language.
- Publisher.
- Subject / Tags.
- Series.
- Series Index.
- Description.
- Cover Image.

Chọn bìa sách:

- Chọn ảnh có sẵn trong EPUB.
- Upload ảnh từ máy, hỗ trợ PNG, JPEG, GIF.
- Dán URL ảnh trực tiếp.
- Dùng kết quả tìm metadata online.

Tìm metadata online:

- Auto.
- AniList, hợp light novel/anime/manga.
- Google Books.
- Open Library.

Chọn một kết quả sẽ tự điền metadata và bìa nếu nguồn có trả về. Bấm Lưu thay đổi để ghi vào EPUB.

## 9. Nhúng phông chữ

Mở từ nút Phông chữ.

Bạn có thể:

- Upload font `.ttf` hoặc `.otf`, tối đa 20MB.
- Đặt tên font tùy chỉnh trước khi upload.
- Kéo thả file font vào vùng upload.
- Nhúng font đề xuất chỉ với một click.

Font đề xuất hiện có:

- Be Vietnam Pro.
- Noto Sans.
- Source Sans 3.
- IBM Plex Sans.
- Roboto.
- Nunito Sans.
- Inter.
- Literata.
- Lora.
- Merriweather.
- Playfair Display.

Sau khi nhúng, app cập nhật manifest/style để EPUB dùng font mới.

## 10. Gallery và thư viện ảnh

Mở từ nút Gallery.

Tab Gallery:

- Xem toàn bộ ảnh tìm thấy trong EPUB.
- Click ảnh để thêm vào trang Gallery.
- Bỏ chọn ảnh đã thêm.
- Sắp xếp ảnh bằng nút lên/xuống.
- Nhập chú thích riêng cho từng ảnh.
- Lưu Gallery để tạo/cập nhật trang `gallery.xhtml`.
- App tự cập nhật manifest và TOC.

Tab Thư viện:

- Chọn ảnh trong sách để tải xuống.
- Chọn tất cả hoặc bỏ chọn.
- Tải ảnh đã chọn.
- Tải toàn bộ ảnh trong sách dưới dạng file tải xuống phù hợp, thường là ZIP nếu có nhiều ảnh.

## 11. Tách volume EPUB

Panel Volumes dùng để chia một EPUB lớn thành nhiều file EPUB nhỏ.

Các phần chính:

- Ảnh bìa gốc của sách.
- Auto-detect volume: app tự đoán ranh giới volume.
- Áp dụng auto-detect để thay danh sách range hiện tại.
- Thêm range mới thủ công.
- Bật/tắt thêm title/index đầu sách vào mỗi EPUB.
- Với mỗi range: cover, label, start index, end index.

Cấu hình bìa riêng cho volume:

- Click ô cover của range.
- So sánh bìa gốc và bìa sẽ dùng.
- Upload ảnh từ máy.
- Dán URL ảnh.
- Chọn ảnh nằm trong chính range chương đó.
- Khôi phục về bìa gốc.

Xuất volume:

- Kiểm tra label/start/end của từng range.
- Bấm Tách EPUB.
- Theo dõi tiến trình xuất.
- File kết quả nằm trong `output/` và hiển thị link tải trong panel.

## 12. Gộp nhiều EPUB

Mở từ nút Gộp EPUB ở sidebar.

Luồng dùng:

- Chọn ít nhất hai EPUB.
- Sắp xếp thứ tự gộp bằng nút lên/xuống.
- Sách đầu tiên là sách chính, được ưu tiên lấy bìa/metadata gốc.
- Có thể thêm EPUB khác từ danh sách còn lại.
- Có thể bỏ EPUB khỏi danh sách gộp.
- Chọn gợi ý tên sách hoặc nhập tên tùy chỉnh.
- Bấm Bắt đầu gộp.

Kết quả là một EPUB mới trong `edit/`, với spine và TOC hợp nhất theo thứ tự đã chọn.

## 13. Tạo EPUB mới

Mở từ nút Tạo EPUB ở sidebar.

Bạn có thể tạo EPUB từ:

- Chương text/HTML nhập thủ công.
- File `.txt`.
- File `.docx`.
- Ảnh manga/comic.

Metadata khi tạo:

- Title là bắt buộc.
- Author, Language, Publisher, Subject, Series, Series Index, Description.
- Bìa upload từ máy.

Quản lý chương trong màn tạo EPUB:

- Thêm chương text.
- Thêm chương manga.
- Xóa chương.
- Đổi thứ tự chương bằng nút lên/xuống.
- Đổi tiêu đề từng chương.
- Chuyển một chương giữa chế độ Text và Manga.

Nhập TXT/DOCX:

- Chọn một hoặc nhiều file `.txt` hoặc `.docx`.
- `.doc` cũ không đọc trực tiếp; hãy mở bằng Word/LibreOffice và Save As `.docx`.
- Khi nhập, app hỏi cách chia chương:
  - Tự tách chương: TXT dùng regex, DOCX dùng heading `H1/H2` nếu có.
  - Mỗi file là một chương.
  - Gộp tất cả file vào một chương.
- Regex tách chương có preset tiêu chuẩn, Chương X, Quyển/Tập X, số đơn và tùy chỉnh.
- Có preview số chương sẽ tạo trước khi áp dụng.

Chương text:

- Visual editor có các nút format cơ bản.
- Raw HTML cho phép nhập nội dung XHTML/HTML.
- Có dọn dẹp nhanh nội dung bản nháp.

Chương manga:

- Upload nhiều ảnh.
- Ảnh mới được sắp xếp A-Z tự nhiên.
- Có nút sắp lại A-Z.
- Có thể xóa hết ảnh.
- Có thể đổi thứ tự từng trang bằng nút lên/xuống.
- Chọn hướng đọc `RTL` cho manga Nhật hoặc `LTR` cho comic/webtoon.

Bấm Tạo EPUB để đóng gói sách mới và đưa vào `edit/`.

## 14. Tìm kiếm và thay thế

Mở từ nút Tìm & Thay.

Tùy chọn:

- Find: từ khóa hoặc regex cần tìm.
- Replace: chuỗi thay thế.
- Mode: Regex hoặc Normal.
- Scope: toàn bộ file text/chương hoặc file hiện tại.
- Direction: Down hoặc Up để đổi thứ tự duyệt kết quả.
- Case sensitive.
- Dot all cho regex khớp cả xuống dòng.
- Wrap trong giao diện tìm kiếm.

Thao tác:

- Find: tìm và liệt kê kết quả.
- Click một kết quả để chọn.
- Replace: thay kết quả đang chọn.
- Replace and Find: thay kết quả đang chọn rồi tìm lại.
- Replace all: thay toàn bộ kết quả trong scope đã chọn.

Sau khi thay, app cập nhật lại analysis và preview.

## 15. Tối ưu EPUB

Mở từ nút Tối ưu.

Nhóm tối ưu tài nguyên:

- Dọn ảnh thừa không dùng.
- Dọn font thừa không dùng.
- Nén ảnh JPEG/PNG.
- Chuyển ảnh JPEG/PNG sang WebP.
- Chỉnh chất lượng ảnh từ 10% đến 100%.

Nhóm tối ưu HTML:

- Dọn dẹp và chuẩn hóa HTML toàn bộ sách.
- Xóa inline styles/style rác.
- Xóa dòng trống thừa.
- Chuẩn hóa thụt lề/paragraph.
- Regex tùy chỉnh, mỗi dòng một regex để xóa phần khớp.

Nhóm typography tiếng Việt:

- Ngoặc kép thông minh.
- Chuẩn hóa dấu thanh.
- Sửa khoảng cách dấu câu.

Kết quả hiển thị:

- Dung lượng gốc.
- Dung lượng mới.
- Dung lượng tiết kiệm.
- Danh sách file thừa đã xóa.
- Danh sách ảnh đã chuyển sang WebP.

Tối ưu ghi đè trực tiếp lên EPUB trong `edit/`.

## 16. Kiểm tra và sửa EPUB

Mở từ nút Kiểm tra & Sửa.

Khi mở modal, app tự validate EPUB và hiển thị:

- Trạng thái Valid/Invalid.
- Số Errors.
- Số Warnings.
- Số Info.
- Danh sách issue theo file, mã lỗi và khả năng sửa.

Nhóm lỗi có thể tự sửa:

- Sửa `mimetype` bị thiếu/sai/nén/sai vị trí.
- Nâng cấp metadata/navigation theo EPUB 3 khi thiếu.
- Loại manifest/spine item trỏ tới file không tồn tại.
- Sửa media type sai.
- Thêm file chưa khai báo vào manifest.
- Sửa XHTML namespace/XML/entity phổ biến.
- Sửa NCX/TOC trỏ sai.
- Tự động dựng lại file `toc.ncx` bị lỗi cú pháp XML từ danh sách spine.
- Dọn link/ảnh hỏng trong content.
- Tạo lại trang TOC hiển thị.
- Tạo lại trang cover từ ảnh bìa.

Bạn có thể:

- Kiểm tra lại.
- Chọn tất cả mục có thể sửa.
- Chọn từng issue.
- Chọn tác vụ dựng lại thủ công: trang TOC hoặc trang cover.
- Bấm Sửa mục đã chọn.

Sau khi sửa, app trả log và refresh analysis.

## 17. Extension Center

Mở từ nút Tiện ích mở rộng ở sidebar.

Tab Đã cài:

- Xem extension hiện có.
- Phân biệt extension chính thức và bên thứ ba.
- Thấy badge Có cập nhật nếu store có bản mới.
- Chọn extension để cấu hình input.
- Upload extension `.js` mới.
- Xóa extension.
- Cập nhật extension đang chọn nếu có bản mới.
- Tự động kiểm tra và cập nhật các extension chính thức (nằm trong thư mục `extensions/origin/`) từ Github Store mỗi khi khởi động ứng dụng.

Tab Cửa hàng:

- Tải danh sách extension từ store.
- Cài extension mới.
- Cập nhật extension đã cài.
- Retry nếu không kết nối được store.

Chạy extension:

- Nhập các trường do extension khai báo.
- Trường input hỗ trợ `text`, `password`, `number`, `boolean`, `select`.
- Trường có thể ẩn/hiện theo `visibleWhen`.
- Giá trị form được lưu trong trình duyệt theo từng extension để lần sau dùng lại.
- Bấm Chạy Extension.
- Theo dõi log streaming trực tiếp.
- Bấm Dừng nếu muốn ngắt tác vụ.

Tương tác khi extension yêu cầu:

- Captcha/Cloudflare: app hiện ảnh chụp trình duyệt, bạn click trực tiếp vào ảnh hoặc nhập text rồi gửi.
- Lựa chọn động: extension có thể hiện danh sách volume/chapter sau khi quét trang; chọn một hoặc nhiều mục rồi xác nhận.

Kết quả:

- Extension có thể tạo một EPUB hoặc nhiều EPUB.
- File tạo xong được đưa vào `edit/`.
- Nếu tạo nhiều file, app chọn file đầu tiên sau khi hoàn tất.

Extension chính thức hiện có:

- `hako2epub`: tải DocLN/Hako, hỗ trợ đăng nhập và xuất mỗi volume thành một EPUB.
- `jukaza2epub`: tải Jukaza qua reader API/decryption.
- `valvrareteam2epub`: tải Valvrareteam, đọc dữ liệu module/chapter từ Next.js, xuất mỗi volume thành EPUB riêng; có input tài khoản tùy chọn để mở chương bị khóa nếu tài khoản có quyền.

Không ghi tài khoản/mật khẩu thật vào mã nguồn extension hoặc tài liệu public. Hãy nhập trong UI khi chạy nếu extension có trường đăng nhập.

## 18. Viết extension

Mỗi extension là một file `.js` và cần có hai hàm global:

```javascript
function register() {
  return {
    id: "my_extension",
    name: "My Extension",
    description: "Tải truyện và đóng gói EPUB.",
    inputs: [
      { id: "url", type: "text", label: "Đường dẫn truyện", required: true }
    ]
  };
}

function run(params) {
  console.log("[*] Bắt đầu tải: " + params.url);
  return {
    title: "Tên sách",
    author: "Tác giả",
    metadata: { title: "Tên sách", creator: "Tác giả", language: "vi" },
    chapters: [
      { id: "chapter_1", title: "Chương 1", text: "<p>Nội dung...</p>", rawHtml: true }
    ],
    images: {}
  };
}
```

Input schema:

- `id`: tên field, truy cập qua `params.id`.
- `type`: `text`, `password`, `number`, `boolean`, `select`.
- `label`: nhãn hiển thị.
- `placeholder`: gợi ý nhập.
- `options`: danh sách chọn cho `select`.
- `visibleWhen`: điều kiện ẩn/hiện theo field khác.
- `defaultValue`: giá trị mặc định.
- `required`: bắt buộc nhập.

API có sẵn trong extension:

- `http.newSession()`: tạo phiên trình duyệt/headless browser.
- `session.Get(url, headers)`: mở trang hoặc gọi request.
- `session.Post(url, payload, headers)`: gửi POST.
- `session.GetFast(url, headers)`: gửi GET thô siêu nhanh sử dụng Go HTTP client, tự động đồng bộ cookie hai chiều và tự động fallback về trình duyệt ảo nếu gặp Cloudflare.
- `session.PostFast(url, payload, headers)`: gửi POST thô siêu nhanh sử dụng Go HTTP client, tự động đồng bộ cookie hai chiều và tự động fallback về trình duyệt ảo nếu gặp Cloudflare.
- `session.GetBinaryBase64(url, headers)`: tải ảnh/font dạng base64.
- `session.HasCookie(name)`: kiểm tra cookie.
- `console.log(...)`: gửi log về UI.
- `utils.sleep(ms)`: nghỉ giữa request.
- `utils.choose(prompt, options, multiple)`: yêu cầu người dùng chọn động trong UI.

Return shape:

- Một object ebook: tạo một EPUB.
- Một array ebook: tạo nhiều EPUB.
- `{ ebooks: [...] }`: tạo nhiều EPUB.

Với site có nhiều volume, nên trả mỗi volume một ebook riêng. `metadata.title` là tên volume, `metadata.series` là tên truyện chính, `metadata.seriesIndex` là số thứ tự volume.

Chi tiết đầy đủ nằm ở `EXTENSION_GUIDE.md`.

## 19. Cập nhật ứng dụng

Khi app khởi động, backend kiểm tra bản phát hành mới. Nếu có update, modal Cập nhật ứng dụng sẽ mở.

Modal hiển thị:

- Phiên bản hiện tại.
- Phiên bản mới nhất.
- Release notes.
- Tên và dung lượng asset tải xuống nếu có.

Luồng cập nhật:

- Bấm Cập nhật ngay.
- App tải bản mới và hiển thị phần trăm.
- App áp dụng update.
- Khi hoàn tất, bấm Khởi động lại ngay để chạy bản mới.

Tính năng cập nhật cần kết nối mạng và phù hợp nhất với bản native executable.

## 20. Phím tắt và thao tác nhanh

- `Ctrl+Z` hoặc `Cmd+Z`: Hoàn tác thay đổi gần nhất nếu focus không nằm trong ô nhập/editor và undo đang khả dụng.
- `Enter` trong ô tìm kiếm metadata online: chạy tìm kiếm.
- `Enter` trong ô Find: chạy tìm.
- `Tab` trong Raw HTML editor: chèn hai dấu cách.
- Kéo thả chương trong danh sách chương: đổi thứ tự spine.
- Kéo thả font vào modal Phông chữ: upload font tùy chỉnh.

## 21. Quy trình gợi ý

Chỉnh EPUB truyện chữ:

1. Mở EPUB vào `edit/`.
2. Kiểm tra metadata và bìa.
3. Dùng Quét gộp nếu chương bị chia `1.1`, `1.2`.
4. Sửa hoặc dọn chương lỗi trong editor.
5. Tìm & Thay các pattern cần sửa hàng loạt.
6. Tạo Gallery nếu cần gom ảnh minh họa.
7. Chạy Kiểm tra & Sửa.
8. Chạy Tối ưu nếu muốn giảm dung lượng.
9. Tách volume nếu sách gồm nhiều tập.

Tạo EPUB từ bản thảo:

1. Mở Tạo EPUB.
2. Nhập metadata và bìa.
3. Import TXT/DOCX hoặc tạo chương thủ công.
4. Chọn cách chia chương và kiểm tra preview.
5. Dọn nội dung từng chương nếu cần.
6. Bấm Tạo EPUB.
7. Mở EPUB mới trong workspace để kiểm tra metadata, TOC và preview.

Tải truyện từ website:

1. Mở Tiện ích mở rộng.
2. Cài hoặc chọn extension phù hợp.
3. Nhập URL và tùy chọn tải.
4. Nhập tài khoản nếu extension hỗ trợ và trang cần quyền truy cập.
5. Chạy extension, xử lý captcha/lựa chọn động nếu có.
6. Mở EPUB tạo ra trong workspace để kiểm tra chương, ảnh, bìa và TOC.

## 22. Xử lý sự cố thường gặp

Không thấy sách sau khi copy vào thư mục:

- Bấm Quét lại.
- Kiểm tra file có đuôi `.epub`.
- Đảm bảo file nằm trong `edit/` của đúng thư mục đang chạy app.

File đang bị khóa trên Windows:

- Đóng trình đọc EPUB bên ngoài.
- Chờ vài giây rồi thử lại.
- Tránh sửa/xóa file trực tiếp khi app đang xử lý.

Preview không hiện ảnh:

- Kiểm tra ảnh có nằm trong manifest không.
- Chạy Kiểm tra & Sửa và chọn các mục liên quan manifest/link.
- Nếu ảnh là URL ngoài, hãy tải ảnh vào EPUB thay vì phụ thuộc URL ngoài.

Tách volume ra EPUB thiếu ảnh:

- Mở cấu hình cover/range và chọn ảnh trong đúng range.
- Chạy Kiểm tra & Sửa trên file gốc trước khi tách.

Gộp chương xong TOC còn cũ:

- Chạy Kiểm tra & Sửa và chọn dựng lại TOC nếu cần.
- Với gộp thông minh, app đã có bước cập nhật TOC cuối sau khi gộp nhóm.

Extension tải thiếu chương:

- Kiểm tra log trong Extension Center.
- Nếu trang có chương khóa, nhập tài khoản nếu extension hỗ trợ.
- Nếu vẫn không có quyền truy cập, extension nên giữ placeholder thay vì làm hỏng toàn bộ EPUB.
- Thử chạy lại chậm hơn nếu website rate limit.

Tối ưu làm giảm chất lượng ảnh quá nhiều:

- Chạy lại từ bản backup hoặc bản gốc.
- Tăng Image Quality.
- Tắt Convert to WebP nếu thiết bị đọc EPUB không hỗ trợ WebP tốt.

## 23. Tài liệu liên quan

- `README.md`: tổng quan dự án, lệnh chạy và build.
- `EXTENSION_GUIDE.md`: hướng dẫn chi tiết cho người viết extension.
- `docs/architecture.md`: kiến trúc backend/frontend.
- `docs/optimizations.md`: cache, overlay filesystem và background writer.
- `docs/guidelines.md`: quy chuẩn phát triển và lưu ý khi sửa code.
