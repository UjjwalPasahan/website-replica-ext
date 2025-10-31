// Content script - runs in the context of web pages
console.log('Page Replica Generator content script loaded');

// Listen for messages from popup or background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'ping') {
        sendResponse({ status: 'ready' });
    }

    if (request.action === 'analyzePageStructure') {
        try {
            const pageData = analyzeCurrentPage();
            sendResponse({ success: true, data: pageData });
        } catch (error) {
            sendResponse({ success: false, error: error.message });
        }
    }

    return true; // Keep message channel open for async response
});

// Analyze the current page structure
function analyzeCurrentPage() {
    const elements = [];
    const seenElements = new Set();

    function getElementData(el) {
        const rect = el.getBoundingClientRect();
        const styles = window.getComputedStyle(el);

        // Get text content for specific elements only
        let text = '';
        if (['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'BUTTON', 'A', 'SPAN', 'LI'].includes(el.tagName)) {
            text = Array.from(el.childNodes)
                .filter(node => node.nodeType === 3) // Text nodes only
                .map(node => node.textContent.trim())
                .join(' ')
                .substring(0, 150);
        }

        return {
            tag: el.tagName.toLowerCase(),
            text: text,
            src: el.src || el.getAttribute('src') || '',
            href: el.href || el.getAttribute('href') || '',
            alt: el.alt || el.getAttribute('alt') || '',
            title: el.title || el.getAttribute('title') || '',
            id: el.id || '',
            classList: Array.from(el.classList).slice(0, 5),
            ariaLabel: el.getAttribute('aria-label') || '',
            rect: {
                width: Math.round(rect.width),
                height: Math.round(rect.height),
                top: Math.round(rect.top + window.scrollY),
                left: Math.round(rect.left)
            },
            styles: {
                color: styles.color,
                backgroundColor: styles.backgroundColor,
                fontSize: styles.fontSize,
                fontWeight: styles.fontWeight,
                fontFamily: styles.fontFamily,
                display: styles.display,
                textAlign: styles.textAlign,
                padding: styles.padding,
                margin: styles.margin
            }
        };
    }

    // Detect page structure
    const structure = {
        header: document.querySelector('header'),
        nav: document.querySelector('nav'),
        main: document.querySelector('main') || document.querySelector('[role="main"]'),
        aside: document.querySelector('aside'),
        footer: document.querySelector('footer')
    };

    // Priority selectors for capturing important elements
    const selectors = [
        // Structural
        'header', 'nav', 'main', 'footer', 'aside', 'section', 'article',
        // Headings
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        // Content
        'p', 'ul', 'ol', 'li',
        // Media
        'img', 'video', 'picture',
        // Interactive
        'a', 'button', 'input[type="button"]', 'input[type="submit"]',
        // Common classes
        '.hero', '.banner', '.card', '.container', '.content', '.wrapper',
        '.navbar', '.menu', '.sidebar', '.grid', '.flex'
    ];

    // Capture elements
    selectors.forEach(selector => {
        try {
            document.querySelectorAll(selector).forEach(el => {
                // Only capture visible elements and avoid duplicates
                if (el.offsetParent !== null && !seenElements.has(el)) {
                    seenElements.add(el);
                    elements.push(getElementData(el));
                }
            });
        } catch (e) {
            console.warn(`Error capturing selector ${selector}:`, e);
        }
    });

    // Get body and html styles
    const bodyStyles = window.getComputedStyle(document.body);
    const htmlStyles = window.getComputedStyle(document.documentElement);

    // Count different element types
    const counts = {
        headings: elements.filter(el => el.tag.match(/^h[1-6]$/)).length,
        paragraphs: elements.filter(el => el.tag === 'p').length,
        images: elements.filter(el => el.tag === 'img').length,
        links: elements.filter(el => el.tag === 'a').length,
        buttons: elements.filter(el => el.tag === 'button').length,
        sections: elements.filter(el => el.tag === 'section').length
    };

    return {
        title: document.title,
        url: window.location.href,
        viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            scrollHeight: document.documentElement.scrollHeight
        },
        bodyStyles: {
            backgroundColor: bodyStyles.backgroundColor,
            color: bodyStyles.color,
            fontFamily: bodyStyles.fontFamily,
            fontSize: bodyStyles.fontSize,
            lineHeight: bodyStyles.lineHeight
        },
        htmlStyles: {
            backgroundColor: htmlStyles.backgroundColor
        },
        structure: {
            hasHeader: !!structure.header,
            hasNav: !!structure.nav,
            hasMain: !!structure.main,
            hasAside: !!structure.aside,
            hasFooter: !!structure.footer
        },
        counts: counts,
        elements: elements.slice(0, 100), // Limit to first 100 elements
        capturedAt: new Date().toISOString()
    };
}

// Optional: Add visual indicator when capturing
function showCaptureIndicator() {
    const indicator = document.createElement('div');
    indicator.id = 'replica-capture-indicator';
    indicator.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #4f46e5;
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    font-family: system-ui, sans-serif;
    font-size: 14px;
    font-weight: 500;
    z-index: 999999;
    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    animation: slideIn 0.3s ease;
  `;
    indicator.textContent = '📸 Capturing page...';

    const style = document.createElement('style');
    style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;
    document.head.appendChild(style);
    document.body.appendChild(indicator);

    setTimeout(() => {
        indicator.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => indicator.remove(), 300);
    }, 2000);
}