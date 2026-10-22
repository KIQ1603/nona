# NONA — Kế hoạch triển khai & timeline

> Tài liệu quản lý tiến độ. **Nguồn sự thật về hành vi/kỹ thuật** vẫn là `.agents/skills/nona-commerce/references/` — file này chỉ lập lịch, không sao chép spec.
> Cập nhật trạng thái (`[ ]` → `[x]`) khi hoàn thành từng đầu việc.

## 1. Nguyên tắc

- Modular monolith, vertical slice nhỏ (schema → domain → API → UI → test → doc).
- Backend là nguồn sự thật cho giá, kho, thanh toán, đơn hàng. Tiền = số nguyên VND.
- UI giữ nguyên hướng thiết kế của `prototype/` (kem – xanh rêu – đỏ son, serif editorial).
- Mỗi phase kết thúc bằng: test xanh, build xanh, tài liệu cập nhật, báo cáo cho chủ dự án.

## 2. Timeline (ước lượng 1 dev full-time; phase nào xong thì báo cáo)

| Phase | Nội dung                                     | Milestone spec          | Ước lượng | Exit criteria                                                                                              |
| ----- | -------------------------------------------- | ----------------------- | --------- | ---------------------------------------------------------------------------------------------------------- |
| **1** | Nền tảng + Catalog chỉ-đọc + Shop UI migrate | M0 + slice 1–2          | 1.5 tuần  | `pnpm dev` chạy web/api/db; shop SSR đọc từ API; filter theo URL; test + CI baseline                       |
| **2** | Admin sản phẩm + media + kho                 | M1 (phần 1) + slice 3–4 | 2 tuần    | Admin đăng nhập, tạo/sửa/publish sản phẩm, upload ảnh, nhập/điều chỉnh kho append-only                     |
| **3** | Tài khoản + giỏ hàng                         | M1 (phần 2) + slice 5   | 1.5 tuần  | Đăng ký/đăng nhập, giỏ guest + merge khi login, giá refresh                                                |
| **4** | Checkout + đơn COD + vận hành đơn            | M1 (phần 3) + slice 6–7 | 2.5 tuần  | Quote backend, tạo đơn transactional + giữ kho + idempotency, admin xử lý đơn, tra cứu đơn, email xác nhận |
| **5** | Thanh toán online + độ tin cậy               | M2 + slice 8            | 2.5 tuần  | VNPay + webhook idempotent + đối soát, coupon, phí ship, hủy/hoàn tiền, backup/restore                     |
| **6** | NONA Custom (thiết kế nón)                   | M3                      | 3 tuần    | Draft → duyệt → đơn đã thanh toán → sản xuất, snapshot bất biến                                            |
| **7** | Hardening & Launch                           | Launch gate             | 1.5 tuần  | HTTPS, rate-limit, monitoring, E2E, runbook, thanh toán live giá trị thấp                                  |

Tổng ≈ 14–15 tuần. Phase 1–4 = có thể bán hàng COD thực tế.

## 3. Danh sách tính năng theo phase

### Phase 1 — Nền tảng + Catalog chỉ-đọc _(đang làm)_

Hạ tầng

- [x] Monorepo pnpm: `apps/web`, `apps/api`, `apps/worker`, `packages/contracts`, `packages/config`, `database`, `infrastructure`
- [x] Docker Compose: PostgreSQL, Redis, MinIO (S3), Mailpit
- [x] Validate biến môi trường (zod), `.env.example`
- [x] Logging có cấu trúc + request ID, `/v1/health/live`, `/v1/health/ready`
- [x] Error contract chuẩn (`{error:{code,message,details,requestId}}`)
- [x] Migration runner SQL (expand/contract), seed dữ liệu mẫu
- [x] CI baseline (lint, typecheck, test, build)
- [x] ADR 0001 (stack & cấu trúc), ADR 0002 (pg + SQL migrations)
      Catalog
- [x] Schema: categories, products, product_variants, product_images, inventory_movements
- [x] `GET /v1/categories`, `GET /v1/products` (lọc: category, giá, màu, phong cách, search; sort; phân trang), `GET /v1/products/:slug`
- [x] Tính tồn kho khả dụng từ movements (không tin cache)
      Storefront (migrate từ prototype)
- [x] Design tokens + primitives (Button, Badge, Price, EmptyState, Drawer…)
- [x] Layout: announcement, header, mobile nav, footer, search panel
- [x] Trang `/shop`: hero, category strip, filter sidebar/drawer, toolbar, lưới 4/3/2 cột đều nhau, empty state
- [x] Filter/sort/search nằm trên URL query (shareable)
- [x] Trang `/san-pham/[slug]` (SSR, metadata, JSON-LD)
- [x] Trang chủ `/`, CTA NONA Custom (tĩnh)
- [x] sitemap, robots, a11y cơ bản, responsive
- [x] Giỏ hàng tạm (client, chỉ là UI placeholder — thay bằng giỏ server ở Phase 3)
      Test
- [x] Unit: query parser, tính khả dụng; Integration: repository với Postgres thật; API contract; web: unit cho parser/format

### Phase 2 — Admin sản phẩm + media + kho _(hoàn thành)_

- [x] Auth admin (session cookie, Argon2id, CSRF), roles: catalog/fulfillment/finance/admin
- [x] Layout `/admin`, guard phía server
- [x] CRUD category/product/variant, publish rules (tên, slug, danh mục, ≥1 ảnh, ≥1 variant active)
- [x] Upload ảnh: signed URL, validate MIME/size, derivative qua worker
- [x] Nhập kho / điều chỉnh (Idempotency-Key), lịch sử movements
- [x] Audit log cho thay đổi giá/kho/publish
- [x] Test: phân quyền âm, optimistic version
- [x] **Khuyến mãi/cấu hình do admin quản lý** (thanh thông báo, ngưỡng miễn phí ship) — không hard-code; coupon/phí ship ở Phase 5 cũng do admin cấu hình

### Phase 3 — Tài khoản + giỏ hàng _(hoàn thành)_

- [x] Đăng ký/đăng nhập/đăng xuất/refresh, `/v1/me`, đổi mật khẩu, địa chỉ
- [ ] Quên/đặt lại mật khẩu qua email (làm cùng module thông báo ở Phase 4)
- [x] Cart server (cookie ẩn danh cho guest), thêm/sửa/xóa item, refresh giá + hiển thị thay đổi
- [x] Merge giỏ khi đăng nhập (giới hạn theo tồn kho)
- [x] Cart drawer + trang `/gio-hang` dùng API thật
- [x] Yêu thích (wishlist) cho user
- [x] **Landing page** `/` (hero, điểm nổi bật, danh mục, sản phẩm nổi bật, câu chuyện, quy trình, CTA); ưu đãi miễn phí ship đọc từ cấu hình admin
- [x] Trang `/dang-nhap`, `/dang-ky`, `/tai-khoan/*`, `/gio-hang`

### Phase 4 — Checkout + COD + vận hành đơn _(hoàn thành)_

- [x] `POST /checkout/quote` (backend tính toàn bộ)
- [x] `POST /orders` transactional: snapshot item, giữ kho có hạn, lịch sử trạng thái, Idempotency-Key
- [x] Worker: hết hạn reservation, outbox, email xác nhận (Mailpit/SMTP)
- [x] Trang `/thanh-toan`, `/don-hang/[code]`, `/tai-khoan/don-hang`
- [x] Admin đơn hàng: danh sách, chi tiết, chuyển trạng thái hợp lệ, shipment thủ công
- [x] Test race "2 checkout 1 sản phẩm cuối", idempotency, hết hạn giữ kho
- [x] Quên/đặt lại mật khẩu qua email (outbox → worker → SMTP/Mailpit)
- [x] Phí vận chuyển cố định + ngưỡng miễn phí **do admin cấu hình** (`/admin/settings`)
- [x] Worker: gửi email có retry/dead-letter, đánh dấu hết hạn giữ chỗ, dọn dữ liệu quá hạn

### Phase 5 — Thanh toán online + độ tin cậy _(hoàn thành — cần xác minh VNPay sandbox thật trước khi launch)_

- [x] Port/adapter thanh toán + VNPay (sandbox), webhook xác thực chữ ký + idempotent
- [x] Trang return lấy trạng thái thật; đối soát định kỳ
- [x] Coupon do admin tạo/sửa trên `/admin` (cửa sổ thời gian, giới hạn, tối thiểu, snapshot rule)
- [x] Phí ship (bảng phí → adapter vận chuyển)
- [x] Hủy đơn / hoàn tiền (append-only), MFA admin
- [x] Queue monitoring, alert, backup/restore drill
- [x] Rà soát bảo mật: `docs/security-review-phase5.md`; runbook trong `docs/runbooks/`; ADR 0005
- [ ] **Xác minh adapter VNPay với tài khoản sandbox thật** (hiện kiểm thử với trình giả lập cùng giao thức)

### Phase 6 — NONA Custom

- [x] Mô hình design/version/layers, state machine DRAFT→SUBMITTED→APPROVED|REVISION_REQUIRED→ARCHIVED (trigger DB khóa nội dung sau khi gửi)
- [x] Editor `/thiet-ke-non` (màu/họa tiết/chữ/ảnh, xem trước trực tiếp), upload asset + moderation
- [x] Phụ phí tùy biến do admin cấu hình, chốt giá khi gửi; snapshot bất biến vào order item
- [x] Admin duyệt/yêu cầu sửa/từ chối ảnh, chặn sản xuất khi chưa duyệt, email thông báo khách

### Bổ sung ngoài kế hoạch (theo yêu cầu chủ dự án)

- [x] Tab **Bài viết** `/bai-viet` do admin đăng (tiêu đề, ảnh bìa, nội dung, ảnh trong bài, nháp/đăng/lưu trữ, SEO, sitemap)
- [x] Kênh liên hệ nổi (Zalo/Facebook/Gmail/TikTok) + trang `/lien-he` do admin cấu hình
- [x] Landing `/` theo `prototype/landing-UI.html`, nội dung do admin cấu hình (ADR 0007)

### Phase 7 — Hardening & Launch

- [ ] Rate limit, CSP/headers, kiểm thử bảo mật, dependency scan
- [ ] E2E Playwright cho luồng mua hàng + admin
- [ ] Observability (metrics, alert), runbooks, RPO/RTO, restore test
- [ ] Nội dung pháp lý, SEO hoàn thiện, Core Web Vitals
- [ ] Launch gate checklist (security-operations.md)

## 4. Luồng nghiệp vụ chính

```text
Khách:  Xem shop ─▶ Chi tiết ─▶ Thêm giỏ ─▶ Checkout (quote) ─▶ Tạo đơn (giữ kho)
                                                     │              │
                                         COD ◀───────┴──▶ VNPay ─ webhook (xác thực) ─▶ PAID
Vận hành: PAID/CONFIRMED ─▶ PROCESSING ─▶ READY_TO_SHIP ─▶ SHIPPING ─▶ COMPLETED
Custom:  Thiết kế (DRAFT) ─▶ SUBMITTED ─▶ APPROVED ─▶ vào giỏ/đơn (snapshot) ─▶ sản xuất
```

Chi tiết state machine & bất biến: `references/domain-rules.md`.

## 5. Quyết định/giả định cần chủ dự án xác nhận

Chưa có trong spec; tôi dùng mặc định bên dưới, đổi được bất cứ lúc nào:

1. **Miễn phí ship từ 600.000đ** (lấy từ banner prototype) — áp dụng thật ở Phase 4/5; hiện chỉ là nội dung hiển thị.
2. **Thời hạn giữ kho:** 15 phút cho online, 24h cho COD (Phase 4).
3. **Phong cách / màu** là thuộc tính lọc của sản phẩm (cột `color_code`, `style_code`), danh sách cố định theo prototype.
4. **Catalog phân trang theo trang (page/pageSize ≤ 48)** thay vì cursor vì cần tổng số cho toolbar; sẽ xem lại khi catalog lớn.
5. **Ảnh sản phẩm Phase 1** là SVG minh họa nón sinh từ seed (thay bằng ảnh thật khi có upload ở Phase 2).
6. Nhà cung cấp email/vận chuyển chưa chọn → dùng adapter giả lập/Mailpit tới khi chốt.
