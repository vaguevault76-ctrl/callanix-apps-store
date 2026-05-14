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

## Setup Instructions

### 1. Create a GitHub Repository

1. Go to https://github.com/new
2. Create a new **public** repository
3. Upload all files from this project to the repo

### 2. Enable GitHub Pages

1. Go to your repo **Settings** → **Pages**
2. Under "Branch", select `main` and `/ (root)` folder
3. Click **Save**
4. Your sites will be live at:
   - Landing: `https://YOUR_USERNAME.github.io/YOUR_REPO/`
   - User Store: `https://YOUR_USERNAME.github.io/YOUR_REPO/user/`
   - Dev Portal: `https://YOUR_USERNAME.github.io/YOUR_REPO/dev/`

### 3. Configure `dev/config.js`

Edit this file and update:

```js
PASSWORD_HASH: '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9',
// Default password is "admin123"
// To change: go to https://emn178.github.io/online-tools/sha256.html
// Type your password → copy the hash → paste it here

GITHUB_OWNER: 'YOUR_GITHUB_USERNAME',     // Your GitHub username
GITHUB_REPO: 'YOUR_REPO_NAME',            // Repository name

RAW_DATA_URL: 'https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/data/links.json'
```

### 4. Configure `user/index.html`

Find the `DATA_URLS` array near the top of the `<script>` and update the first URL:

```js
const DATA_URLS = [
    'https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/data/links.json',
    '../data/links.json'
];
```

### 5. Commit and Push

After configuring, commit and push all files to GitHub.

## How to Add Apps (Workflow)

**No API keys or tokens needed.** The workflow is simple:

1. Go to your Dev Portal (`/dev/`) and enter your password
2. Add / edit / delete apps — all data saves automatically in your browser
3. When ready to publish, click **"Publish to GitHub"**
4. A modal opens with two buttons:
   - **"Copy Data"** — copies all your apps as JSON to clipboard
   - **"Open GitHub Editor"** — opens `data/links.json` on GitHub.com
5. In GitHub: **select all existing content → paste → click "Commit changes"**
6. User Store updates instantly (allow 1-2 min for CDN cache)

## Features

### User Store (Public)
- Ultra-modern dark theme with glassmorphism
- spaceInDown and swap animations, particle effects
- App search, category filtering, detail modal with screenshots
- Ad gateway support (5-sec countdown before redirect)
- Responsive, works on low-end devices
- Anti-copy protections (no right-click, no F12, anti-devtools)

### Developer Portal (Password Protected)
- SHA-256 password gate
- Add / Edit / Delete apps with form
- Dashboard stats (total apps, categories, ad count)
- Local auto-save (no data loss)
- Publish to GitHub via clipboard + editor (no API tokens)
- JSON export/import for backup

## Security

- Dev password is SHA-256 hashed in `config.js`
- No GitHub tokens or API keys stored anywhere
- Anti-copy measures throughout both sites
- GitHub Pages provides free HTTPS encryption

## Customization

- **Theme colors**: Edit `#6c5ce7` (purple) and `#00cec9` (teal) in the CSS
- **Ad timer**: Change `let count = 5;` in `user/index.html`
- **Password**: Generate a new SHA-256 hash → update `config.js`

## Low-End Device Optimization

- Vanilla JS (no frameworks)
- GPU-accelerated CSS animations
- Lazy-loaded images
- Only Font Awesome as external dependency
- Tiny file sizes
