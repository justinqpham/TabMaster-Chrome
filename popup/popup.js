// DOM elements
const searchInput = document.getElementById('searchInput');
const resultsList = document.getElementById('resultsList');
const currentWindowRadio = document.getElementById('currentWindow');
const allWindowsRadio = document.getElementById('allWindows');
const dedupCurrentBtn = document.getElementById('dedupCurrent');
const dedupAllBtn = document.getElementById('dedupAll');
const statusEl = document.getElementById('status');

let allTabs = [];
let currentWindowId = null;
let duplicateUrls = new Set();

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

// Handle deduplication
async function handleDedup(scope) {
  setDedupButtonsDisabled(true);
  setStatus('Scanning for duplicate tabs...', 'info');

  try {
    const tabs = await getTabs(scope);
    const result = await closeDuplicateTabs(tabs);

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
    setDedupButtonsDisabled(false);
  }
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

// Close duplicate tabs
async function closeDuplicateTabs(tabs) {
  if (!Array.isArray(tabs) || tabs.length === 0) {
    return { closed: 0, failed: 0, skippedPinned: 0, skippedProtected: 0 };
  }

  const sortedTabs = [...tabs].sort((a, b) => {
    if (a.windowId === b.windowId) {
      return (a.index ?? 0) - (b.index ?? 0);
    }
    return (a.windowId ?? 0) - (b.windowId ?? 0);
  });

  const seenUrls = new Map();
  const duplicateIds = [];
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
      duplicateIds.push(tab.id);
    } else {
      seenUrls.set(url, tab.id);
    }
  }

  if (duplicateIds.length === 0) {
    return { closed: 0, failed: 0, skippedPinned, skippedProtected };
  }

  const results = await Promise.allSettled(duplicateIds.map((tabId) => removeTab(tabId)));
  const closed = results.filter((entry) => entry.status === 'fulfilled').length;
  const failed = results.length - closed;

  return { closed, failed, skippedPinned, skippedProtected };
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

// Set dedup buttons disabled state
function setDedupButtonsDisabled(disabled) {
  dedupCurrentBtn.disabled = disabled;
  dedupAllBtn.disabled = disabled;
}

// Set status message
function setStatus(message, tone) {
  statusEl.textContent = message;
  statusEl.classList.remove('error', 'success', 'info');
  if (tone === 'error' || tone === 'success' || tone === 'info') {
    statusEl.classList.add(tone);
  }
}
