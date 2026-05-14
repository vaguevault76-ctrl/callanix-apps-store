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
