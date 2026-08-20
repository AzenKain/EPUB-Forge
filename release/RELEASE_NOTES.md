# Prebuild Version 2.4.4

## Thay đổi chính

- **Nâng cấp & Sửa lỗi Hako / DocLN Extension (`hako2epub`)**:
  - Tối ưu tốc độ tải và loại bỏ nghẽn tài nguyên trình duyệt bằng `session.GetFast` kết hợp cơ chế tự động chuyển sang trình duyệt ảo khi phát hiện Cloudflare / Turnstile.
  - Khắc phục triệt để lỗi `context deadline exceeded` và `Không tìm thấy nội dung chương hoặc nội dung bị khóa` khi tải các bộ truyện/volume nhiều chương.
  - Hỗ trợ chế độ đăng nhập tùy chọn (Optional Login): Có thể tải ngay các truyện/chương công khai mà không bắt buộc nhập tài khoản; tự động đăng nhập khi cung cấp thông tin xác thực.
  - Cải tiến vòng lặp giải mã nội dung bảo vệ (`chapter-c-protected`) và hỗ trợ tải ảnh minh họa song song đa luồng vào EPUB.
- **Đồng bộ Timeout trình duyệt & mạng (30s)**:
  - Cập nhật chuẩn Timeout điều hướng `WaitLoad` và nạp form thành 30 giây, đồng bộ với toàn bộ HTTP Client và bộ tải tài nguyên để tối ưu độ ổn định trên mạng yếu/lag.

## Ghi chú

Tải đúng file theo hệ điều hành và kiến trúc máy của bạn trong phần Assets.

---
