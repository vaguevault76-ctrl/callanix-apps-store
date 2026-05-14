// ============================================================
// CALLANIX STORE - Developer Portal Configuration
// ============================================================
// EDIT THESE VALUES before uploading to GitHub
// ============================================================

const CONFIG = {

    // --- Password ---
    // Default: "admin123" (SHA-256 hashed below)
    // To change: go to https://emn178.github.io/online-tools/sha256.html
    // Type your password, copy the hash, paste it here
    PASSWORD_HASH: '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9',

    // --- GitHub Repository (for publishing data) ---
    GITHUB_OWNER: 'YOUR_GITHUB_USERNAME',
    GITHUB_REPO: 'YOUR_REPO_NAME',

    // --- Raw Data URL for User Store ---
    // This is where the user store fetches the app list from
    RAW_DATA_URL: 'https://raw.githubusercontent.com/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME/main/data/links.json'

};
