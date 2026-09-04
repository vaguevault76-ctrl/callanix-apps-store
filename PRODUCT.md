# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Both equally:
- End-users (primarily mobile, incl. low-end devices) discovering/browsing curated apps, games, tools — searching, filtering by category, viewing details/screenshots, downloading via ad-gateway redirect.
- Publisher/developer (owner) managing catalog via private Dev Portal — adding/editing/deleting apps, checking stats, exporting/importing JSON, publishing to GitHub via clipboard.

## Product Purpose

Dual-site app store platform on GitHub Pages: public User Store for discovery + private Developer Portal for catalog management + landing index linking both. Success = fast discovery on low-end devices and frictionless self-publishing with no backend.

## Positioning

Curated lightweight store — tiny vanilla-JS, GPU CSS, lazy images, Font Awesome only — that stays fast where Play Store / heavy builders stall. Human-curated picks, not an open marketplace.

## Operating Context

GitHub Pages HTTPS hosting. Workflows: browse → search/filter → detail modal → 5-sec ad gateway → outbound link; manage: SHA-256 gate → dashboard → add/edit/delete (local autosave) → copy JSON → paste to GitHub / export-import backup. Data source: `data/links.json` + `RAW_DATA_URL` in `dev/config.js`.

## Capabilities and Constraints

Confirmed functionality to preserve: landing cards to user/dev; store search + clear, category filter, app grid cards, detail modal with screenshots, ad countdown modal with progress/continue; dev SHA-256 gate, stats (total/categories/ad count), form add/edit, apps list, publish-clipboard, JSON export/import, toasts, anti-copy (no select/right-click/devtools), responsive + low-end optimization.
Technical: vanilla HTML/CSS/JS single files (`index.html`, `user/index.html`, `dev/index.html`), inline CSS, no build, `dev/config.js` holds PASSWORD_HASH + GITHUB_OWNER/REPO + RAW_DATA_URL. `data/links.json` currently empty — do not fabricate apps/testimonials/pricing.

## Brand Commitments

Name Callanix Store / CALLANIX. Keep purple #6c5ce7 + teal #00cec9 gradient identity, dark theme + glassmorphism. Inter font. Existing voice: minimal, direct. No new brand world without user approval.

## Evidence on Hand

README.md, index.html landing, user/index.html (~438 lines), dev/index.html (~678 lines), dev/config.js, data/links.json (empty). No real app data, screenshots, testimonials, or analytics — future work must not invent them.

## Product Principles

1. Speed is the feature — must stay tiny and fast on low-end mobile.
2. Curate, don't aggregate — every listing is an owner pick.
3. Self-publish without backend — GitHub JSON is the CMS.
4. Both sides matter — buyer discovery and publisher workflow ship together.
