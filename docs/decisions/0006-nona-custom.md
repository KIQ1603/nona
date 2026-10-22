# 0006 — NONA Custom designs

**Status:** accepted (Phase 6)

## Context

Customers design a conical hat (colour, text, motifs, uploaded image). The result must be priced by the backend, reviewed by staff, and reproduced exactly by the workshop even if options, prices or the design itself change later.

## Decision

- **Versioned designs.** `custom_designs` → `custom_design_versions` → `design_layers`. Only `DRAFT` versions are mutable; a DB trigger freezes content after submission and allows only the review transitions (`SUBMITTED → APPROVED | REVISION_REQUIRED → ARCHIVED`). Editing creates a new version.
- **Admin-managed options** in `site_settings.custom` (no hard-coded prices, colours or motifs). Fonts are the only code allow-list.
- **Shared pure code** in `@nona/contracts` (`validateDesign`, `priceDesign`, `renderHatSvg`) used by browser and API; the API alone is authoritative. The price addition is frozen at submission.
- **Server-rendered preview** (SVG → sharp PNG), stored privately and streamed only to the owner or staff. SVG is built only from validated catalogue values and escaped text; motif paths are restricted to path-data characters.
- **Uploads** are re-encoded to WebP (no SVG, no originals kept), size/dimension limited, capped per owner, and start `PENDING` moderation.
- **Ownership** by account or an HttpOnly guest cookie (hashed); merged into the account on login.
- **Orders** copy a customization snapshot onto `order_items`; production (`PROCESSING`) requires every design version to be `APPROVED`.

- **Default on.** Every product is customizable unless an admin switches it off; the storefront no longer renders the top announcement bar (the admin setting remains stored but unused).

## Consequences

- Option edits never alter submitted designs or placed orders.
- Preview text rendering depends on fonts of the API host (needs Vietnamese-capable fonts in production images).
- Approval can be switched off per shop policy, but images still require moderation.
- Not covered: print-ready artwork export and per-design production workflow beyond the work-order view.
