// Background service worker for the Page Replica Generator extension
console.log('Page Replica Generator background script loaded');

// Handle extension installation and updates
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('Extension installed successfully');

        // Create context menu on install
        chrome.contextMenus.create({
            id: 'capturePageReplica',
            title: 'Generate Page Replica',
            contexts: ['page']
        });

    } else if (details.reason === 'update') {
        const manifest = chrome.runtime.getManifest();
        console.log('Extension updated to version:', manifest.version);
    }
});

// Handle messages from popup or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Background received message:', request.action);

    // Capture screenshot of visible tab
    if (request.action === 'captureScreenshot') {
        chrome.tabs.captureVisibleTab(
            null,
            { format: 'png', quality: 100 },
            (dataUrl) => {
                if (chrome.runtime.lastError) {
                    console.error('Screenshot error:', chrome.runtime.lastError);
                    sendResponse({
                        success: false,
                        error: chrome.runtime.lastError.message
                    });
                } else {
                    sendResponse({
                        success: true,
                        dataUrl: dataUrl
                    });
                }
            }
        );
        return true; // Keep channel open for async response
    }

    // Get active tab information
    if (request.action === 'getActiveTab') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs.length > 0) {
                sendResponse({
                    success: true,
                    tab: tabs[0]
                });
            } else {
                sendResponse({
                    success: false,
                    error: 'No active tab found'
                });
            }
        });
        return true;
    }

    // Inject content script if needed
    if (request.action === 'injectContentScript') {
        chrome.scripting.executeScript({
            target: { tabId: request.tabId },
            files: ['content.js']
        }).then(() => {
            sendResponse({ success: true });
        }).catch((error) => {
            sendResponse({
                success: false,
                error: error.message
            });
        });
        return true;
    }

    return false;
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'capturePageReplica') {
        console.log('Context menu clicked on tab:', tab.id);
        // User should click extension icon to open popup
    }
});

// Monitor storage changes (e.g., API key updates)
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes.geminiApiKey) {
        console.log('Gemini API key updated');

        // Update badge to show API key is set
        if (changes.geminiApiKey.newValue) {
            chrome.action.setBadgeText({ text: '✓' });
            chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
            setTimeout(() => {
                chrome.action.setBadgeText({ text: '' });
            }, 2000);
        }
    }
});

// Keep service worker alive
let keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {
        // Dummy call to keep service worker alive
    });
}, 20000);

console.log('Background script initialization complete');