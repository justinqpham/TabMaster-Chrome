// DOM elements
const searchInput = document.getElementById('searchInput');
const resultsList = document.getElementById('resultsList');
const currentWindowRadio = document.getElementById('currentWindow');
const allWindowsRadio = document.getElementById('allWindows');
const dedupCurrentBtn = document.getElementById('dedupCurrent');
const dedupAllBtn = document.getElementById('dedupAll');
const closeUnbookmarkedCurrentBtn = document.getElementById('closeUnbookmarkedCurrent');
const closeUnbookmarkedAllBtn = document.getElementById('closeUnbookmarkedAll');
const undoLastCloseBtn = document.getElementById('undoLastClose');
const statusEl = document.getElementById('status');

let allTabs = [];
let currentWindowId = null;
let duplicateUrls = new Set();
let bookmarkedUrlsCache = null;
let lastClosedTabs = [];

// ---- Chrome API helpers ---------------------------------------------------
function withRuntimeError(reject) {
  const err = chrome.runtime.lastError;
  if (err) {
    reject(new Error(err.message || String(err)));
    return true;
  }
  return false;
}

function getCurrentWindow() {
  return new Promise((resolve, reject) => {
    chrome.windows.getCurrent({}, (window) => {
      if (withRuntimeError(reject)) return;
      resolve(window);
    });
  });
}

function queryTabs(queryInfo = {}) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      if (withRuntimeError(reject)) return;
      resolve(tabs || []);
    });
  });
}

function focusWindow(windowId) {
  return new Promise((resolve, reject) => {
    chrome.windows.update(windowId, { focused: true }, (window) => {
      if (withRuntimeError(reject)) return;
      resolve(window);
    });
  });
}

function activateTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, { active: true }, (tab) => {
      if (withRuntimeError(reject)) return;
      resolve(tab);
    });
  });
}

function removeTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.remove(tabId, () => {
      if (withRuntimeError(reject)) return;
      resolve();
    });
  });
}

function createTab(createProperties) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(createProperties, (tab) => {
      if (withRuntimeError(reject)) return;
      resolve(tab);
    });
  });
}

function getWindow(windowId) {
  return new Promise((resolve, reject) => {
    chrome.windows.get(windowId, {}, (window) => {
      if (withRuntimeError(reject)) return;
      resolve(window);
    });
  });
}

function createWindow(createData) {
  return new Promise((resolve, reject) => {
    chrome.windows.create(createData, (window) => {
      if (withRuntimeError(reject)) return;
      resolve(window);
    });
  });
}

function getBookmarksTree() {
  return new Promise((resolve, reject) => {
    if (!chrome.bookmarks || !chrome.bookmarks.getTree) {
      reject(new Error('Bookmarks permission is missing.'));
      return;
    }
    chrome.bookmarks.getTree((nodes) => {
      if (withRuntimeError(reject)) return;
      resolve(nodes || []);
    });
  });
}

function normalizeUrlForBookmarkLookup(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const u = new URL(url);
    // Fragments are rarely meaningful for "saved vs not saved" behavior.
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

function collectBookmarkedUrls(bookmarkTreeNodes) {
  const urls = new Set();
  const stack = Array.isArray(bookmarkTreeNodes) ? [...bookmarkTreeNodes] : [];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;

    if (node.url) {
      const normalized = normalizeUrlForBookmarkLookup(node.url);
      if (normalized) urls.add(normalized);
    }

    if (Array.isArray(node.children) && node.children.length > 0) {
      stack.push(...node.children);
    }
  }

  return urls;
}

async function getBookmarkedUrlSet() {
  if (bookmarkedUrlsCache) return bookmarkedUrlsCache;
  const tree = await getBookmarksTree();
  bookmarkedUrlsCache = collectBookmarkedUrls(tree);
  return bookmarkedUrlsCache;
}

function canUndo() {
  return Array.isArray(lastClosedTabs) && lastClosedTabs.length > 0;
}

function updateUndoButtonLabel() {
  if (!undoLastCloseBtn) return;
  if (!canUndo()) {
    undoLastCloseBtn.textContent = 'Undo Last Close';
    return;
  }
  const n = lastClosedTabs.length;
  undoLastCloseBtn.textContent = `Undo Last Close (${n})`;
}

function setLastClosedTabs(tabInfos) {
  lastClosedTabs = Array.isArray(tabInfos) ? tabInfos : [];
  updateUndoButtonLabel();
}

// ---- Initialization -------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const currentWindow = await getCurrentWindow();
    currentWindowId = currentWindow?.id ?? null;

    await loadTabs();

    // Set up event listeners
    searchInput.addEventListener('input', handleSearch);
    currentWindowRadio.addEventListener('change', handleSearch);
    allWindowsRadio.addEventListener('change', handleSearch);
    dedupCurrentBtn.addEventListener('click', () => handleDedup('current'));
    dedupAllBtn.addEventListener('click', () => handleDedup('all'));
    closeUnbookmarkedCurrentBtn.addEventListener('click', () => handleCloseUnbookmarked('current'));
    closeUnbookmarkedAllBtn.addEventListener('click', () => handleCloseUnbookmarked('all'));
    undoLastCloseBtn.addEventListener('click', handleUndoLastClose);
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        window.close();
      }
    });

    // Focus search input
    searchInput.focus();
  } catch (error) {
    console.error('Initialization failed:', error);
    setStatus('Unable to load tabs. Please try again.', 'error');
  }
});

// Load all tabs
async function loadTabs() {
  allTabs = await queryTabs({});
  findDuplicates();
  handleSearch();
}

// Find duplicate URLs
function findDuplicates() {
  duplicateUrls.clear();
  const urlCounts = new Map();

  for (const tab of allTabs) {
    if (!tab.url || tab.pinned || isProtectedUrl(tab.url)) continue;
    urlCounts.set(tab.url, (urlCounts.get(tab.url) || 0) + 1);
  }

  for (const [url, count] of urlCounts.entries()) {
    if (count > 1) {
      duplicateUrls.add(url);
    }
  }
}

// Handle search
function handleSearch() {
  const query = searchInput.value.toLowerCase().trim();
  const searchScope = document.querySelector('input[name=\"scope\"]:checked').value;

  // Filter tabs based on scope
  let tabsToSearch = allTabs;
  if (searchScope === 'current' && currentWindowId != null) {
    tabsToSearch = allTabs.filter(tab => tab.windowId === currentWindowId);
  }

  // Filter tabs based on search query
  let filteredTabs = tabsToSearch;
  if (query) {
    filteredTabs = tabsToSearch.filter(tab => {
      const title = (tab.title || '').toLowerCase();
      const url = (tab.url || '').toLowerCase();
      return title.includes(query) || url.includes(query);
    });
  }

  displayResults(filteredTabs, query);
}

// Display results
function displayResults(tabs, query) {
  resultsList.innerHTML = '';

  if (tabs.length === 0) {
    resultsList.innerHTML = `
      <div class="no-results">
        <div class="no-results-icon">🔍</div>
        <div class="no-results-text">No tabs found</div>
      </div>
    `;
    return;
  }

  tabs.forEach(tab => {
    const tabItem = createTabItem(tab, query);
    resultsList.appendChild(tabItem);
  });
}

// Create tab item element
function createTabItem(tab, query) {
  const div = document.createElement('div');
  div.className = 'tab-item';

  // Mark as duplicate if URL is duplicated
  if (tab.url && duplicateUrls.has(tab.url)) {
    div.classList.add('duplicate');
  }

  // Favicon
  const favicon = document.createElement('img');
  favicon.className = 'tab-favicon';
  favicon.src = tab.favIconUrl || 'icons/default-favicon.png';
  favicon.onerror = () => {
    favicon.src = 'data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><text y=\"12\" font-size=\"12\">📄</text></svg>';
  };

  // Tab info
  const tabInfo = document.createElement('div');
  tabInfo.className = 'tab-info';

  const title = document.createElement('div');
  title.className = 'tab-title';
  title.innerHTML = highlightText(tab.title || 'Untitled', query);

  const url = document.createElement('div');
  url.className = 'tab-url';
  url.innerHTML = highlightText(tab.url || '', query);

  tabInfo.appendChild(title);
  tabInfo.appendChild(url);

  div.appendChild(favicon);
  div.appendChild(tabInfo);

  // Add duplicate badge if this is a duplicate
  if (tab.url && duplicateUrls.has(tab.url)) {
    const dupBadge = document.createElement('span');
    dupBadge.className = 'duplicate-badge';
    dupBadge.textContent = 'Duplicate';
    div.appendChild(dupBadge);
  }

  // Add window badge if searching all windows
  const searchScope = document.querySelector('input[name=\"scope\"]:checked').value;
  if (searchScope === 'all' && currentWindowId != null && tab.windowId !== currentWindowId) {
    const badge = document.createElement('span');
    badge.className = 'tab-window-badge';
    badge.textContent = `Window ${getWindowNumber(tab.windowId)}`;
    div.appendChild(badge);
  }

  // Click handler - single click to switch
  div.addEventListener('click', async () => {
    await switchToTab(tab);
  });

  // Double click handler (also switches, for redundancy)
  div.addEventListener('dblclick', async () => {
    await switchToTab(tab);
  });

  return div;
}

// Switch to a tab
async function switchToTab(tab) {
  try {
    // Switch to the tab's window first
    await focusWindow(tab.windowId);
    // Then activate the tab
    await activateTab(tab.id);
    // Close the popup
    window.close();
  } catch (error) {
    console.error('Error switching to tab:', error);
  }
}

// Highlight matching text
function highlightText(text, query) {
  if (!query) return escapeHtml(text);

  const escapedText = escapeHtml(text);
  const escapedQuery = escapeRegex(query);
  const regex = new RegExp(`(${escapedQuery})`, 'gi');

  return escapedText.replace(regex, '<span class=\"highlight\">$1</span>');
}

// Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Escape regex special characters
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Get window number for display
function getWindowNumber(windowId) {
  const uniqueWindowIds = [...new Set(allTabs.map(tab => tab.windowId))].sort();
  return uniqueWindowIds.indexOf(windowId) + 1;
}

function toTabRestoreInfo(tab) {
  if (!tab) return null;
  const url = tab.url || '';
  if (!url) return null;

  return {
    url,
    windowId: tab.windowId,
    index: typeof tab.index === 'number' ? tab.index : null
  };
}

// Handle deduplication
async function handleDedup(scope) {
  setActionButtonsDisabled(true);
  setStatus('Scanning for duplicate tabs...', 'info');

  try {
    const tabs = await getTabs(scope);
    const result = await closeDuplicateTabs(tabs);

    if (Array.isArray(result.closedTabs) && result.closedTabs.length > 0) {
      setLastClosedTabs(result.closedTabs);
    }

    if (result.closed === 0) {
      let note = 'No duplicate tabs found.';
      if (result.skippedPinned > 0 || result.skippedProtected > 0) {
        note += describeSkips(result);
      }
      setStatus(note, 'success');
    } else {
      let message = `Closed ${result.closed} duplicate tab${result.closed === 1 ? '' : 's'}.`;
      if (result.failed > 0 || result.skippedPinned > 0 || result.skippedProtected > 0) {
        message += describeSkips(result);
      }
      setStatus(message, 'success');

      // Reload tabs to update the display
      await loadTabs();
    }
  } catch (error) {
    const readable = error && error.message ? error.message : String(error);
    setStatus(`Error: ${readable}`, 'error');
    console.error('Deduplication failed:', error);
  } finally {
    setActionButtonsDisabled(false);
  }
}

// Handle closing tabs that are not saved in Bookmarks
async function handleCloseUnbookmarked(scope) {
  setActionButtonsDisabled(true);
  setStatus('Loading bookmarks...', 'info');

  try {
    const tabs = await getTabs(scope);
    const bookmarkedUrls = await getBookmarkedUrlSet();

    setStatus('Closing unbookmarked tabs...', 'info');
    const result = await closeUnbookmarkedTabs(tabs, bookmarkedUrls);

    if (Array.isArray(result.closedTabs) && result.closedTabs.length > 0) {
      setLastClosedTabs(result.closedTabs);
    }

    if (result.closed === 0) {
      let note = 'No unbookmarked tabs found.';
      const details = describeUnbookmarkedDetails(result);
      if (details) note += details;
      setStatus(note, 'success');
    } else {
      let message = `Closed ${result.closed} unbookmarked tab${result.closed === 1 ? '' : 's'}.`;
      const details = describeUnbookmarkedDetails(result);
      if (details) message += details;
      setStatus(message, 'success');

      await loadTabs();
    }
  } catch (error) {
    const readable = error && error.message ? error.message : String(error);
    setStatus(`Error: ${readable}`, 'error');
    console.error('Close unbookmarked failed:', error);
  } finally {
    setActionButtonsDisabled(false);
  }
}

async function handleUndoLastClose() {
  if (!canUndo()) {
    setStatus('Nothing to undo.', 'info');
    return;
  }

  setActionButtonsDisabled(true);

  const toRestore = [...lastClosedTabs];
  const label = `Restoring ${toRestore.length} tab${toRestore.length === 1 ? '' : 's'}...`;
  setStatus(label, 'info');

  try {
    const result = await restoreClosedTabs(toRestore);
    const restored = result.restored ?? 0;
    const failedTabs = Array.isArray(result.failedTabs) ? result.failedTabs : [];
    const failed = failedTabs.length;

    if (restored === 0 && failed > 0) {
      setStatus(`Unable to restore tabs (${failed} failed).`, 'error');
    } else if (failed > 0) {
      setStatus(`Restored ${restored} tab${restored === 1 ? '' : 's'} (${failed} failed).`, 'success');
    } else {
      setStatus(`Restored ${restored} tab${restored === 1 ? '' : 's'}.`, 'success');
    }

    // Allow retry for the subset that failed to restore.
    setLastClosedTabs(failedTabs);

    await loadTabs();
  } catch (error) {
    const readable = error && error.message ? error.message : String(error);
    setStatus(`Error: ${readable}`, 'error');
    console.error('Undo failed:', error);
  } finally {
    setActionButtonsDisabled(false);
  }
}

async function restoreClosedTabs(tabInfos) {
  const valid = (Array.isArray(tabInfos) ? tabInfos : []).filter((info) => info && info.url);
  if (valid.length === 0) {
    return { restored: 0, failedTabs: [] };
  }

  // Group by original windowId so we can recreate a window if it was closed.
  const byWindow = new Map();
  for (const info of valid) {
    const key = info.windowId ?? 'unknown';
    if (!byWindow.has(key)) byWindow.set(key, []);
    byWindow.get(key).push(info);
  }

  let restored = 0;
  const failedTabs = [];

  for (const [origWindowId, infos] of byWindow.entries()) {
    const sorted = [...infos].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

    let targetWindowId = origWindowId;
    let windowExists = true;
    if (typeof origWindowId !== 'number') {
      windowExists = false;
    } else {
      try {
        await getWindow(origWindowId);
      } catch {
        windowExists = false;
      }
    }

    if (!windowExists) {
      try {
        const urls = sorted.map((t) => t.url);
        const win = await createWindow({ url: urls, focused: false });
        if (!win || win.id == null) {
          throw new Error('Failed to create window.');
        }
        restored += urls.length;
        continue;
      } catch (error) {
        // Fall back to restoring tabs individually into a newly created window.
        try {
          const first = sorted[0];
          const win = await createWindow({ url: first.url, focused: false });
          if (!win || win.id == null) {
            throw new Error('Failed to create window.');
          }
          targetWindowId = win.id;
          restored += 1;

          for (const info of sorted.slice(1)) {
            try {
              await createTab({ windowId: targetWindowId, url: info.url, active: false });
              restored += 1;
            } catch {
              failedTabs.push(info);
            }
          }
          continue;
        } catch {
          failedTabs.push(...sorted);
          continue;
        }
      }
    }

    for (const info of sorted) {
      const createProps = { windowId: targetWindowId, url: info.url, active: false };
      if (typeof info.index === 'number') {
        createProps.index = info.index;
      }

      try {
        await createTab(createProps);
        restored += 1;
      } catch {
        failedTabs.push(info);
      }
    }
  }

  return { restored, failedTabs };
}

// Get tabs based on scope
async function getTabs(scope) {
  if (scope === 'current') {
    return allTabs.filter(tab => tab.windowId === currentWindowId);
  }
  if (scope === 'all') {
    return allTabs;
  }
  throw new Error(`Unsupported scope: ${scope}`);
}

// Close tabs not present in the bookmarks tree
async function closeUnbookmarkedTabs(tabs, bookmarkedUrls) {
  if (!Array.isArray(tabs) || tabs.length === 0) {
    return {
      closed: 0,
      failed: 0,
      keptBookmarked: 0,
      skippedPinned: 0,
      skippedProtected: 0,
      skippedNoUrl: 0,
      closedTabs: []
    };
  }

  const toCloseTabs = [];
  let keptBookmarked = 0;
  let skippedPinned = 0;
  let skippedProtected = 0;
  let skippedNoUrl = 0;

  for (const tab of tabs) {
    if (!tab || tab.id == null) continue;

    const url = tab.url || '';
    if (!url) {
      skippedNoUrl++;
      continue;
    }

    if (tab.pinned) {
      skippedPinned++;
      continue;
    }

    if (isProtectedUrl(url)) {
      skippedProtected++;
      continue;
    }

    const normalized = normalizeUrlForBookmarkLookup(url);
    if (bookmarkedUrls.has(normalized)) {
      keptBookmarked++;
      continue;
    }

    toCloseTabs.push(tab);
  }

  if (toCloseTabs.length === 0) {
    return {
      closed: 0,
      failed: 0,
      keptBookmarked,
      skippedPinned,
      skippedProtected,
      skippedNoUrl,
      closedTabs: []
    };
  }

  const results = await Promise.allSettled(toCloseTabs.map((tab) => removeTab(tab.id)));
  const closedTabs = results
    .map((entry, idx) => (entry.status === 'fulfilled' ? toTabRestoreInfo(toCloseTabs[idx]) : null))
    .filter(Boolean);

  const closed = closedTabs.length;
  const failed = results.length - closed;

  return {
    closed,
    failed,
    keptBookmarked,
    skippedPinned,
    skippedProtected,
    skippedNoUrl,
    closedTabs
  };
}

// Close duplicate tabs
async function closeDuplicateTabs(tabs) {
  if (!Array.isArray(tabs) || tabs.length === 0) {
    return { closed: 0, failed: 0, skippedPinned: 0, skippedProtected: 0, closedTabs: [] };
  }

  const sortedTabs = [...tabs].sort((a, b) => {
    if (a.windowId === b.windowId) {
      return (a.index ?? 0) - (b.index ?? 0);
    }
    return (a.windowId ?? 0) - (b.windowId ?? 0);
  });

  const seenUrls = new Map();
  const duplicateTabs = [];
  let skippedPinned = 0;
  let skippedProtected = 0;

  for (const tab of sortedTabs) {
    if (!tab || tab.id == null) {
      continue;
    }

    const url = tab.url || '';

    if (!url) {
      continue;
    }

    if (tab.pinned) {
      skippedPinned++;
      continue;
    }

    if (isProtectedUrl(url)) {
      skippedProtected++;
      continue;
    }

    if (seenUrls.has(url)) {
      duplicateTabs.push(tab);
    } else {
      seenUrls.set(url, tab.id);
    }
  }

  if (duplicateTabs.length === 0) {
    return { closed: 0, failed: 0, skippedPinned, skippedProtected, closedTabs: [] };
  }

  const results = await Promise.allSettled(duplicateTabs.map((tab) => removeTab(tab.id)));
  const closedTabs = results
    .map((entry, idx) => (entry.status === 'fulfilled' ? toTabRestoreInfo(duplicateTabs[idx]) : null))
    .filter(Boolean);

  const closed = closedTabs.length;
  const failed = results.length - closed;

  return { closed, failed, skippedPinned, skippedProtected, closedTabs };
}

// Check if URL is protected
function isProtectedUrl(url) {
  const lowered = url.toLowerCase();
  return lowered.startsWith('chrome://') ||
    lowered.startsWith('edge://') ||
    lowered.startsWith('about:') ||
    lowered.startsWith('devtools://') ||
    lowered.startsWith('chrome-extension://') ||
    lowered.startsWith('moz-extension://');
}

// Describe skipped tabs
function describeSkips({ failed = 0, skippedPinned = 0, skippedProtected = 0 }) {
  const notes = [];
  if (skippedPinned > 0) {
    notes.push(`${skippedPinned} pinned`);
  }
  if (skippedProtected > 0) {
    notes.push(`${skippedProtected} protected`);
  }
  if (failed > 0) {
    notes.push(`${failed} failed`);
  }
  return notes.length ? ` (skipped ${notes.join(', ')})` : '';
}

function describeUnbookmarkedDetails({
  failed = 0,
  keptBookmarked = 0,
  skippedPinned = 0,
  skippedProtected = 0,
  skippedNoUrl = 0
}) {
  const parts = [];

  if (keptBookmarked > 0) {
    parts.push(`kept ${keptBookmarked} bookmarked`);
  }

  const skipped = [];
  if (skippedPinned > 0) skipped.push(`${skippedPinned} pinned`);
  if (skippedProtected > 0) skipped.push(`${skippedProtected} protected`);
  if (skippedNoUrl > 0) skipped.push(`${skippedNoUrl} no URL`);
  if (skipped.length > 0) {
    parts.push(`skipped ${skipped.join(', ')}`);
  }

  if (failed > 0) {
    parts.push(`${failed} failed`);
  }

  return parts.length ? ` (${parts.join('; ')})` : '';
}

function setActionButtonsDisabled(disabled) {
  dedupCurrentBtn.disabled = disabled;
  dedupAllBtn.disabled = disabled;
  closeUnbookmarkedCurrentBtn.disabled = disabled;
  closeUnbookmarkedAllBtn.disabled = disabled;
  undoLastCloseBtn.disabled = disabled || !canUndo();
}

// Set status message
function setStatus(message, tone) {
  statusEl.textContent = message;
  statusEl.classList.remove('error', 'success', 'info');
  if (tone === 'error' || tone === 'success' || tone === 'info') {
    statusEl.classList.add(tone);
  }
}
