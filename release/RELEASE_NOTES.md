# Prebuild Version 2.4.2

## Thay đổi chính

- **Tự động bỏ qua chương lỗi 403 (Skip 403 HTTP errors)**:
  - Các extension cào truyện chính thức (`Hako`, `Valvrareteam` và `Jukaza`) sẽ tự động phát hiện và bỏ qua các chương bị lỗi 403 Forbidden (nội dung bị ẩn, khóa hoặc không có quyền truy cập công khai) sau 2 lần thử lại.
  - Ngăn chặn việc dừng tiến trình đột ngột hoặc làm hỏng toàn bộ tệp EPUB được đóng gói khi gặp một vài chương lỗi.

- **Hệ thống hiển thị cảnh báo (Warnings UI)**:
  - Tổng hợp danh sách các chương không thể tải và hiển thị thông báo cảnh báo trực quan (màu vàng) trên giao diện Extension Modal khi hoàn tất.
  - Hỗ trợ định dạng và hiển thị màu vàng nổi bật cho các dòng nhật ký cảnh báo bắt đầu bằng ký tự `[!]` trong bảng Console Log.

- **Cập nhật tài liệu Extension Developer Guide**:
  - Bổ sung tài liệu mô tả trường `warnings` (`string[]`) trong giá trị trả về của hàm `run()` tại `EXTENSION_GUIDE.md` để các nhà phát triển có thể tự định nghĩa cảnh báo bỏ qua chương lỗi.

## Ghi chú

Tải đúng file theo hệ điều hành và kiến trúc máy của bạn trong phần Assets.

---
