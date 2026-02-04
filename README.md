# TabMaster - Chromium Tab Search & Duplicate Remover

TabMaster is a Manifest V3 extension for Chromium-based browsers (Chrome, Brave, Edge, Vivaldi, etc.). Search all open tabs instantly, jump to the one you need, and clear duplicate tabs with a click.

## Features

### 🔍 Tab Search
- Real-time search across tab titles and URLs
- Scope toggle: current window or all windows
- One-click navigation to any result
- Highlighted matches in titles and URLs

### 🗑️ Duplicate Tab Management
- Automatic duplicate detection
- Clear badges/borders for duplicates
- One-click cleanup in the current window or across all windows
- Skips pinned tabs and protected/internal URLs

### 🔖 Bookmark Cleanup
- Close tabs that are not saved in your Bookmarks
- Works on the current window or all windows
- Skips pinned tabs and protected/internal URLs

### ↩️ Undo
- Undo the most recent close action from the extension (restores the closed tabs)

## Installation

### Load Unpacked (dev/test)
1. Open `chrome://extensions` (or `brave://extensions`, `edge://extensions`, etc.).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder (`TabMaster-Chrome`).

### Build a Zip (for store upload or sharing)
```bash
bash package.sh
```
Creates `tabmaster-chrome.zip` containing the manifest, popup, and icons.

## Usage
1. Click the TabMaster toolbar icon.
2. Type to filter tabs; choose **Current Window** or **All Windows**.
3. Click a result to focus that tab.
4. Use **Close Duplicates** for the current window or all windows. First occurrences stay open; later duplicates close. Pinned/protected URLs are never closed.
5. Use **Close Unbookmarked** to close tabs that are not saved in Bookmarks.
6. Click **Undo Last Close** to restore the tabs closed by your most recent close action.
7. Press `Escape` to close the popup.

## Technical Details
- Manifest V3, `action` popup only (no background service worker).
- Permissions: `tabs` (needed to list, focus, and close tabs), `bookmarks` (needed to check if a URL is bookmarked).
- Icons: 16/32/48/96/128 PNGs plus `icon.svg`.
- Primary files:
  - `manifest.json`
  - `popup/popup.html`, `popup.css`, `popup.js`
  - `icons/` assets
  - `package.sh` (zip packager)

## Browser Compatibility
- Chromium 88+ (Chrome, Brave, Edge, Opera, Vivaldi, and other Chromium-based browsers that support Manifest V3).

## License
MIT License. Created by Justin Pham.
