# Prebuild Version 2.4

## Thay đổi chính

- **Thêm phương thức GetFast và PostFast cho Extensions**:
  - Hỗ trợ gửi Raw HTTP Request siêu nhanh qua Go Client (tốc độ cào tải tăng gấp 10-30 lần do không tốn tài nguyên dựng giao diện Chrome).
  - Tự động đồng bộ Cookie hai chiều: Chuyển giao cookie mượt mà giữa Go Client Jar và Chrome Headless Rod Page để giữ trạng thái đăng nhập đồng nhất.
  - Tự động giải quyết lỗi chứng chỉ TLS và SNI hostname không khớp (hỗ trợ tự động chuyển ServerName, đặc biệt hữu dụng cho host ảnh như `img.jukaza.site`).
- **Cơ chế Fallback thông minh khi gặp Cloudflare/Turnstile**:
  - Nếu `GetFast` / `PostFast` gặp lỗi kết nối hoặc bị chặn bởi Cloudflare, hệ thống sẽ tự động chuyển hướng request sang chế độ duyệt trình duyệt ảo Rod (Stealth Mode) để giải quyết challenge tự động, đảm bảo việc cào truyện luôn hoạt động mượt mà.
## Ghi chú

Tải đúng file theo hệ điều hành và kiến trúc máy của bạn trong phần Assets.

---
