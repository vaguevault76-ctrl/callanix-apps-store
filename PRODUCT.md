# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Both equally:
- End-users (primarily mobile, incl. low-end devices) discovering/browsing curated apps, games, tools — searching, filtering by category, viewing details/screenshots, downloading via ad-gateway redirect.
- Any developer with a free GitHub account proposing apps via the open Dev Portal — filing new apps, edits, removals as submission tickets, tracking them to live.
- Owner approving filings (one label click) and curating the allowlist; trusted publishers auto-approve via `data/publishers.json`.

## Product Purpose

Dual-site app store platform on GitHub Pages: public User Store for discovery + open Developer Portal for community filings + landing index linking both. A GitHub Action publishes approved submission tickets into `data/links.json`. Success = fast discovery on low-end devices and keyless community publishing with no backend.

## Positioning

Curated lightweight store — tiny vanilla-JS, GPU CSS, lazy images, Font Awesome only — that stays fast where Play Store / heavy builders stall. Human-curated picks, not an open marketplace.

## Operating Context

GitHub Pages HTTPS hosting. Workflows: browse → search/filter → detail modal → fullscreen screenshots → 5-sec ad gateway → outbound link; file: portal form → prefilled submission ticket → approval (or auto-approve) → Action validates → writes `data/links.json` → ticket stamped with app ID → store refetches. Data source: `data/links.json` (+ `RAW_DATA_URL` in `dev/config.js`); allowlist: `data/publishers.json`.

## Capabilities and Constraints

Confirmed functionality to preserve: landing departures to user/dev; store search + clear, category filter, app grid, detail modal with screenshots + fullscreen viewer, ad countdown modal with progress/continue; dev keyless filing (new/edit/delete via tickets), live-value loader, submission tracker, guide, toasts; publisher Action (validate → write → stamp → close); user-store anti-copy; responsive + low-end optimization.
Technical: vanilla HTML/CSS/JS single files (`index.html`, `user/index.html`, `dev/index.html`), inline CSS, no build, `dev/config.js` holds GITHUB_OWNER/REPO + RAW_DATA_URL. `data/links.json` currently empty — do not fabricate apps/testimonials/pricing. Submissions live in issues labeled `app-submission`; states via `approved` / `needs-fix` / `published` labels.

## Brand Commitments

Name Callanix Store / CALLANIX. Keep purple #6c5ce7 + teal #00cec9 gradient identity, dark theme + glassmorphism. Inter font. Existing voice: minimal, direct. No new brand world without user approval.

## Evidence on Hand

README.md, index.html landing, user/index.html (~438 lines), dev/index.html (~678 lines), dev/config.js, data/links.json (empty). No real app data, screenshots, testimonials, or analytics — future work must not invent them.

## Product Principles

1. Speed is the feature — must stay tiny and fast on low-end mobile.
2. Curate, don't aggregate — every listing is an owner pick.
3. Self-publish without backend — GitHub JSON is the CMS.
4. Both sides matter — buyer discovery and publisher workflow ship together.
