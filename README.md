# Callanix Store Apps

A dual-website app store platform — a public **User Store** and a private **Developer Portal** — hosted on GitHub Pages.

## Project Structure

```
├── index.html          # Landing page (links to both sites)
├── user/
│   └── index.html      # Public User Store (no auth required)
├── dev/
│   ├── index.html      # Private Developer Portal (password required)
│   └── config.js       # Dev configuration
├── data/
│   └── links.json      # App data file (edit this on GitHub to publish)
└── README.md
```


## Features

### User Store (Public)
- Ultra-modern dark theme with glassmorphism
- spaceInDown and swap animations, particle effects
- App search, category filtering, detail modal with screenshots
- Ad gateway support (5-sec countdown before redirect)
- Responsive, works on low-end devices
- Anti-copy protections (no right-click, no F12, anti-devtools)

### Developer Portal (Open — No Password, No Repo Access, No GitHub Visits)
- Anyone with a free GitHub account can file: new app, edit, or removal
- One-time connect with a classic token (`public_repo` ticked) — then filings go straight from the portal, GitHub never opens
- Track filings live: pending → queued → live, with fix requests
- A GitHub Action validates, writes `data/links.json`, and stamps tickets published
- Trusted publishers in `data/publishers.json` board automatically; others need one approval label
- No shared passwords, no tokens, no backend — repo is the database

## Publishing Pipeline

```
dev/ form → GitHub Issue (app-submission) → approval (or auto mode)
→ .github/workflows/publish.yml → validates → writes data/links.json
→ commits → ID-free comment + closes ticket → user/ refetches
→ private app ID emailed (if contact given + SMTP secrets set)
```

## Private App IDs by Email (optional, free)

1. Create a Gmail app password (Google Account → Security → 2-Step → App passwords).
2. Repo → Settings → Secrets and variables → Actions → add:
   `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER=you@gmail.com`,
   `SMTP_PASS=<app password>`, `SMTP_FROM=Callanix Store <you@gmail.com>`.
3. Done. Published/updated tickets with a contact email trigger the mail;
   without secrets the step skips silently and IDs stay in MY APPS.

Honest note: IDs can't be invisible — the public `data/links.json` that
powers the store must contain them. They are unguessable (96-bit random),
never shown in UI, comments, or tracking, and emailed privately on request.
Edit/delete tickets must contain the target ID to function; the address is
scrubbed off the public ticket right after.

Mode in data/publishers.json: "auto" (everyone boards instantly — default)
or "approve" (strangers wait for the `approved` label). The Action also runs
on ticket events plus a sweep every 5 minutes.

## Security

- No passwords or tokens anywhere — identity is the submitter's GitHub account
- Only the Action (built-in `GITHUB_TOKEN`) can write `data/links.json`
- Edits/deletes allowed for the original submitter only (plus allowlisted publishers)
- Validation caps: 80-char titles, 5 screenshots, URL shapes, confirmation checkbox
- App IDs are cryptographic random, never shown on any page or ticket, and emailed privately when a contact address is given
- Anti-copy measures on the user store; GitHub Pages provides free HTTPS encryption

## Customization

- **Theme colors**: Edit `#6c5ce7` (purple) and `#00cec9` (teal) in the CSS
- **Ad timer**: Change `let count = 5;` in `user/index.html`
- **Approval mode**: Set `"mode": "auto"` or `"approve"` in `data/publishers.json`

## Low-End Device Optimization

- Vanilla JS (no frameworks)
- GPU-accelerated CSS animations
- Lazy-loaded images
- Only Font Awesome as external dependency
- Tiny file sizes
