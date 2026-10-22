# NONA

Hệ thống bán hàng NONA (nón lá Việt). Quy tắc & đặc tả: `.agents/skills/nona-commerce/references/`. Kế hoạch & tiến độ: [docs/ROADMAP.md](docs/ROADMAP.md). Giao diện mẫu gốc: `prototype/`.

## Chạy local

```bash
pnpm install
cp .env.example .env
pnpm infra:up          # Postgres :5433, Redis :6390 (+ MinIO, Mailpit)
pnpm db:reset          # migrate + seed (dev only)
pnpm dev               # web :3100, api :4100, worker
```

Admin: http://localhost:3100/admin — tài khoản dev `admin@nona.local` / `ChangeMe!2026` (chỉ tạo bởi seed dev; **không dùng ở production**).
Tạo nhân viên: `NONA_STAFF_PASSWORD='mật-khẩu-≥12-ký-tự' pnpm db:create-staff email@nona.vn CATALOG Tên`.
Khuyến mãi/thông báo/ngưỡng miễn phí ship: chỉnh trong **Admin → Khuyến mãi & cấu hình** (lưu trong DB, không nằm trong code).

Admin: http://localhost:3100/admin — tài khoản dev `admin@nona.local` / `ChangeMe!2026` (chỉ do seed dev tạo; **không dùng ở production**).
Tạo nhân viên: `NONA_STAFF_PASSWORD='mật-khẩu-≥12-ký-tự' pnpm db:create-staff email@nona.vn CATALOG Tên`.
Khuyến mãi/thông báo/ngưỡng miễn phí ship: chỉnh tại **Admin → Khuyến mãi & cấu hình** (lưu trong DB, không nằm trong code).

Bài viết: admin viết tại **Admin → Bài viết** (ảnh bìa, nội dung có định dạng, ảnh trong bài, nháp/đăng); khách đọc ở tab **Bài viết** (`/bai-viet`).

Trang chủ (`/`) là landing dạng từng màn hình theo `prototype/landing-UI.html`; nội dung chỉnh tại **Admin → Trang chủ (landing)**, kênh Zalo/Facebook/Gmail/TikTok tại **Admin → Liên hệ & kênh chat**.

NONA Custom: khách thiết kế tại `/thiet-ke-non`; nhân viên duyệt tại **Admin → Thiết kế riêng**; màu/họa tiết/phụ thu chỉnh tại **Admin → Tùy chọn NONA Custom** (giá trị seed chỉ là dữ liệu mẫu). Bật cho từng sản phẩm bằng ô “Cho phép khách thiết kế riêng”.

Thanh toán online chạy với **trình giả lập VNPay** khi `PAYMENTS_MODE=simulator` (mặc định dev). Chọn "Thanh toán trực tuyến qua VNPay" ở bước thanh toán rồi bấm thành công/thất bại trên trang giả lập. Dùng VNPay thật: đặt `PAYMENTS_MODE=vnpay` + `VNPAY_*` (xem `.env.example`).
Sao lưu/khôi phục: `infrastructure/scripts/backup.sh`, `restore-drill.sh` (xem `docs/runbooks/`).

Kiểm tra: `pnpm typecheck && pnpm test && pnpm build`. Test API dùng Postgres thật (DB `nona_test` tự tạo).

## Cấu trúc

```text
apps/web          Next.js: src/app (routes) · src/features/<feature> · src/components · src/styles
apps/api          NestJS: src/modules/<module>/{presentation,application,domain,infrastructure}
apps/worker       Job runner (skeleton)
packages/contracts  DTO + zod dùng chung (API ⇄ web)
database          migrations/*.sql, runner, seed
docs              ROADMAP, decisions (ADR)
```
