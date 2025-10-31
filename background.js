// Background service worker for the Page Replica Generator extension
console.log('Page Replica Generator background script loaded');

// Handle extension installation and updates
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('Extension installed successfully');
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
        return true;
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

    return false;
});

// Monitor storage changes
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes.geminiApiKey) {
        console.log('Gemini API key updated');

        if (changes.geminiApiKey.newValue) {
            chrome.action.setBadgeText({ text: '✓' });
            chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
            setTimeout(() => {
                chrome.action.setBadgeText({ text: '' });
            }, 2000);
        }
    }
});

console.log('Background script initialization complete');   