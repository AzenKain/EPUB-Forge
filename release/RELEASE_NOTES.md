# Prebuild Version 2.4.5

## Thay đổi chính

- **Nâng cấp toàn diện tính năng Kiểm tra & Sửa EPUB (Validate & Repair)**:
  - **Phát hiện & Dọn dẹp file mồ côi (`MANIFEST_ORPHAN_DOCUMENT`)**: Tự động phát hiện các file HTML được khai báo trong manifest nhưng không nằm trong danh sách đọc (spine), dọn sạch khỏi manifest và loại bỏ hoàn toàn khỏi gói nén ZIP khi lưu.
  - **Làm sạch & Đồng bộ mục lục NCX (`FIX_TOC_NCX`)**: Tự động lọc sạch các đề mục volume rác trỏ về trang mục lục HTML (như *Minh họa LN*, *WN*, *Manga*, *Vol 1*), loại bỏ các liên kết trỏ ra ngoài spine và chuẩn hóa lại toàn bộ `playOrder`.
  - **Đồng bộ chuẩn hiển thị đa nền tảng (`TOC_NAV_NCX_MISMATCH`)**: Đồng bộ danh sách chương giữa EPUB 3 (`nav.xhtml`) và EPUB 2 (`toc.ncx`), giúp sách hiển thị mục lục nhất quán và chuẩn xác trên mọi trình đọc (Apple Books, Moon+ Reader, Calibre, Kindle, KOReader, Thorium...).
- **Cải tiến giao diện Kiểm tra & Sửa (Repair Modal UI)**:
  - Bổ sung các tác vụ sửa nhanh: *Dọn dẹp file mồ côi & manifest*, *Làm sạch & Đồng bộ mục lục NCX*, *Chuẩn hóa mimetype*.
  - Hiển thị nhãn giải thích tiếng Việt trực quan cho từng lỗi có thể khắc phục.

## Ghi chú

Tải đúng file theo hệ điều hành và kiến trúc máy của bạn trong phần Assets.

---
