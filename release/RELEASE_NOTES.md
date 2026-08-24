# Prebuild Version 2.4.6

## Thay đổi chính

- **Thêm Extension Novest Downloader (`novest2epub`)**:
  - Hỗ trợ tải truyện chữ từ nền tảng `novest.me` và đóng gói thành sách EPUB riêng cho từng tập.
  - Tích hợp xác thực tài khoản (Email/Mật khẩu) hỗ trợ tải các chương VIP/trả phí hoặc tải chương công khai mà không cần đăng nhập.
  - Đa dạng chế độ tải: Tải toàn bộ truyện (*all_volumes*), Tùy chọn tập (*choose_volumes*), Tải 1 chương lẻ (*single_chapter*), hoặc Tải theo khoảng chương chỉ định (*chapter_range*).
  - Tự động tải và nhúng hình ảnh minh họa chất lượng cao vào tệp EPUB.
- **Thêm Extension Zumi Novel Downloader (`zuminovel2epub`)**:
  - Hỗ trợ tải truyện chữ từ `zuminovel.com` và đóng gói thành sách EPUB chuẩn cho từng tập.
  - Hỗ trợ tài khoản đăng nhập để mở khóa chương VIP/trả phí hoặc tải chương công khai.
  - Linh hoạt các chế độ tải: Tải tất cả tập (*all_volumes*), Chọn tập cần tải (*choose_volumes*), Tải 1 chương (*single_chapter*), hoặc Tải theo khoảng chương (*chapter_range*).
  - Tự động xử lý và nhúng hình ảnh minh họa trực tiếp vào gói EPUB.
- **Bổ sung Unit Tests & Kiểm thử tích hợp**:
  - Thêm bộ kiểm thử tự động trong `extension_test.go` cho cả hai extension `novest2epub` và `zuminovel2epub` (kiểm tra tải đơn/đa tập, xác thực cấu trúc tệp ZIP và hình ảnh minh họa nhúng trong EPUB).

## Ghi chú

Tải đúng file theo hệ điều hành và kiến trúc máy của bạn trong phần Assets.

---
