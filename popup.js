const captureBtn = document.getElementById('captureBtn');
const status = document.getElementById('status');
const progress = document.getElementById('progress');
const apiKeyInput = document.getElementById('apiKey');

// Load saved API key
chrome.storage.sync.get(['geminiApiKey'], (result) => {
    if (result.geminiApiKey) {
        apiKeyInput.value = result.geminiApiKey;
    }
});

// Save API key when changed
apiKeyInput.addEventListener('change', () => {
    const key = apiKeyInput.value.trim();
    if (key) {
        chrome.storage.sync.set({ geminiApiKey: key });
        showStatus('API key saved', 'success');
        setTimeout(() => {
            status.style.display = 'none';
        }, 2000);
    }
});

function showStatus(message, type) {
    status.textContent = message;
    status.className = type;
    status.style.display = 'block';
}

function showProgress(text) {
    progress.textContent = text;
    progress.style.display = text ? 'block' : 'none';
}

captureBtn.addEventListener('click', async () => {
    try {
        const apiKey = apiKeyInput.value.trim();

        if (!apiKey) {
            showStatus('Please enter your Gemini API key', 'error');
            return;
        }

        captureBtn.disabled = true;
        showStatus('Starting capture...', 'info');
        showProgress('Capturing screenshot...');

        // Get active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab) {
            throw new Error('No active tab found');
        }

        // Check if we can access the page
        if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
            throw new Error('Cannot capture Chrome system pages');
        }

        // Capture screenshot first
        const screenshotData = await new Promise((resolve, reject) => {
            chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(dataUrl);
                }
            });
        });

        showProgress('Analyzing page structure...');

        // Inject and execute the capture script
        let pageData;
        try {
            const [result] = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: capturePage
            });

            if (!result || !result.result) {
                throw new Error('Failed to capture page data');
            }

            pageData = result.result;
        } catch (err) {
            console.error('Script injection error:', err);
            throw new Error('Could not access page. Try refreshing and clicking the extension again.');
        }

        // Generate replica using Gemini API with screenshot
        showProgress('Generating replica with Gemini AI...');
        const replica = await generateReplicaWithGemini(pageData, screenshotData, apiKey);

        // Download the generated HTML
        showProgress('Creating download...');
        downloadHTML(replica, pageData.title);

        showStatus('✓ Replica generated successfully!', 'success');
        showProgress('');

        setTimeout(() => {
            captureBtn.disabled = false;
            status.style.display = 'none';
        }, 3000);

    } catch (error) {
        console.error('Error:', error);
        showStatus(`Error: ${error.message}`, 'error');
        showProgress('');
        captureBtn.disabled = false;
    }
});

// Enhanced function to capture page structure and content
function capturePage() {
    try {
        const elements = [];
        const seenElements = new Set();

        function getElementData(el) {
            try {
                const rect = el.getBoundingClientRect();
                const styles = window.getComputedStyle(el);

                let text = '';
                // Capture direct text content
                if (['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'BUTTON', 'A', 'SPAN', 'LI', 'LABEL', 'DIV'].includes(el.tagName)) {
                    text = Array.from(el.childNodes)
                        .filter(node => node.nodeType === 3)
                        .map(node => node.textContent.trim())
                        .join(' ')
                        .substring(0, 200);
                }

                // Get input attributes
                const inputAttrs = {};
                if (el.tagName === 'INPUT') {
                    inputAttrs.type = el.type || 'text';
                    inputAttrs.placeholder = el.placeholder || '';
                    inputAttrs.value = el.value || '';
                }

                return {
                    tag: el.tagName.toLowerCase(),
                    text: text,
                    src: el.src || el.getAttribute('src') || '',
                    href: el.href || el.getAttribute('href') || '',
                    alt: el.alt || el.getAttribute('alt') || '',
                    title: el.title || el.getAttribute('title') || '',
                    id: el.id || '',
                    classList: Array.from(el.classList).slice(0, 8),
                    ariaLabel: el.getAttribute('aria-label') || '',
                    dataAttrs: Array.from(el.attributes)
                        .filter(attr => attr.name.startsWith('data-'))
                        .reduce((acc, attr) => ({ ...acc, [attr.name]: attr.value }), {}),
                    inputAttrs: inputAttrs,
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
                        margin: styles.margin,
                        borderRadius: styles.borderRadius,
                        border: styles.border,
                        boxShadow: styles.boxShadow
                    }
                };
            } catch (e) {
                return null;
            }
        }

        // Capture structural elements
        const structure = {
            header: document.querySelector('header'),
            nav: document.querySelector('nav'),
            main: document.querySelector('main') || document.querySelector('[role="main"]'),
            footer: document.querySelector('footer'),
            aside: document.querySelector('aside')
        };

        // Enhanced selectors to capture more page elements
        const selectors = [
            'header', 'nav', 'main', 'footer', 'aside', 'section', 'article',
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'p', 'ul', 'ol', 'li',
            'img', 'svg', 'picture',
            'a', 'button', 'input', 'textarea', 'select', 'form', 'label',
            '.logo', '.brand', '.hero', '.banner', '.card', '.container', '.content', '.wrapper',
            '.navbar', '.menu', '.sidebar', '.grid', '.flex', '.search', '.input',
            '[role="search"]', '[role="navigation"]', '[role="banner"]'
        ];

        selectors.forEach(selector => {
            try {
                document.querySelectorAll(selector).forEach(el => {
                    if (el.offsetParent !== null && !seenElements.has(el)) {
                        seenElements.add(el);
                        const data = getElementData(el);
                        if (data) {
                            elements.push(data);
                        }
                    }
                });
            } catch (e) {
                console.warn('Selector error:', selector, e);
            }
        });

        // Get comprehensive color scheme
        const bodyStyles = window.getComputedStyle(document.body);
        const htmlStyles = window.getComputedStyle(document.documentElement);

        // Detect color palette from all elements
        const colorPalette = new Set();
        const bgColorPalette = new Set();
        elements.forEach(el => {
            if (el.styles.color && el.styles.color !== 'rgba(0, 0, 0, 0)') {
                colorPalette.add(el.styles.color);
            }
            if (el.styles.backgroundColor && el.styles.backgroundColor !== 'rgba(0, 0, 0, 0)') {
                bgColorPalette.add(el.styles.backgroundColor);
            }
        });

        // Get meta information
        const metaDescription = document.querySelector('meta[name="description"]')?.content || '';
        const ogImage = document.querySelector('meta[property="og:image"]')?.content || '';

        return {
            title: document.title || 'Untitled Page',
            url: window.location.href,
            metaDescription: metaDescription,
            ogImage: ogImage,
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
                lineHeight: bodyStyles.lineHeight,
                margin: bodyStyles.margin,
                padding: bodyStyles.padding
            },
            htmlStyles: {
                backgroundColor: htmlStyles.backgroundColor
            },
            colorPalette: Array.from(colorPalette).slice(0, 10),
            bgColorPalette: Array.from(bgColorPalette).slice(0, 10),
            structure: {
                hasHeader: !!structure.header,
                hasNav: !!structure.nav,
                hasMain: !!structure.main,
                hasAside: !!structure.aside,
                hasFooter: !!structure.footer
            },
            elements: elements.slice(0, 150),
            capturedAt: new Date().toISOString()
        };
    } catch (error) {
        throw new Error('Failed to analyze page: ' + error.message);
    }
}

async function generateReplicaWithGemini(pageData, screenshotData, apiKey) {
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent`;

    // Organize elements by type
    const headings = pageData.elements.filter(el => el.tag.match(/^h[1-6]$/));
    const images = pageData.elements.filter(el => el.tag === 'img');
    const buttons = pageData.elements.filter(el => el.tag === 'button');
    const links = pageData.elements.filter(el => el.tag === 'a');
    const inputs = pageData.elements.filter(el => el.tag === 'input');

    // Build detailed element descriptions
    const elementDescriptions = [];

    if (headings.length > 0) {
        elementDescriptions.push('HEADINGS:');
        headings.slice(0, 15).forEach((h, i) => {
            elementDescriptions.push(`  ${i + 1}. <${h.tag}> "${h.text}" - Font: ${h.styles.fontSize}, Weight: ${h.styles.fontWeight}, Color: ${h.styles.color}`);
        });
    }

    if (images.length > 0) {
        elementDescriptions.push('\nIMAGES:');
        images.slice(0, 10).forEach((img, i) => {
            elementDescriptions.push(`  ${i + 1}. Size: ${img.rect.width}x${img.rect.height}px, Alt: "${img.alt}"`);
        });
    }

    if (buttons.length > 0) {
        elementDescriptions.push('\nBUTTONS:');
        buttons.slice(0, 8).forEach((btn, i) => {
            elementDescriptions.push(`  ${i + 1}. "${btn.text}" - BG: ${btn.styles.backgroundColor}, Color: ${btn.styles.color}, Border Radius: ${btn.styles.borderRadius}`);
        });
    }

    if (inputs.length > 0) {
        elementDescriptions.push('\nINPUT FIELDS:');
        inputs.slice(0, 8).forEach((inp, i) => {
            elementDescriptions.push(`  ${i + 1}. Type: ${inp.inputAttrs.type}, Placeholder: "${inp.inputAttrs.placeholder}"`);
        });
    }

    if (links.length > 0) {
        elementDescriptions.push('\nLINKS:');
        links.slice(0, 15).forEach((link, i) => {
            if (link.text) {
                elementDescriptions.push(`  ${i + 1}. "${link.text}"`);
            }
        });
    }

    const prompt = `You are an expert frontend developer. Create a COMPLETE, RESPONSIVE HTML page that is a pixel-perfect replica of the provided screenshot.

CRITICAL REQUIREMENTS:
1. MUST include Tailwind CSS CDN in <head>: <link href="https://cdn.jsdelivr.net/npm/tailwindcss@3.4.0/dist/tailwind.min.css" rel="stylesheet">
2. Use ONLY Tailwind utility classes for ALL styling (bg-*, text-*, p-*, m-*, flex, grid, etc.)
3. NEVER use inline styles or style attributes - ONLY use Tailwind classes and custom CSS classes
4. Add custom <style> ONLY for exact RGB colors that Tailwind doesn't have
5. Make it FULLY RESPONSIVE with mobile-first Tailwind breakpoints (sm:, md:, lg:, xl:, 2xl:)
6. Use semantic HTML5 tags (<header>, <nav>, <main>, <footer>, <section>, <article>)
7. Ensure proper UTF-8 encoding for all special characters and international text
8. Add proper aria-labels and accessibility attributes
9. IMPORTANT: Use standard Tailwind classes like bg-gray-900, text-white, p-4, flex, etc.
10. Test that the Tailwind CDN link is the FIRST stylesheet in <head>

PAGE DATA:
Title: ${pageData.title}

STRUCTURE:
- Header: ${pageData.structure.hasHeader ? 'YES' : 'NO'}
- Navigation: ${pageData.structure.hasNav ? 'YES' : 'NO'}
- Main Content: ${pageData.structure.hasMain ? 'YES' : 'NO'}
- Sidebar: ${pageData.structure.hasAside ? 'YES' : 'NO'}
- Footer: ${pageData.structure.hasFooter ? 'YES' : 'NO'}

COLOR SCHEME:
- Page Background: ${pageData.htmlStyles.backgroundColor}
- Body Background: ${pageData.bodyStyles.backgroundColor}
- Text Color: ${pageData.bodyStyles.color}
- Font Family: ${pageData.bodyStyles.fontFamily}

ADDITIONAL COLORS USED:
${pageData.colorPalette.slice(0, 5).map((c, i) => `${i + 1}. ${c}`).join('\n')}

BACKGROUND COLORS USED:
${pageData.bgColorPalette.slice(0, 5).map((c, i) => `${i + 1}. ${c}`).join('\n')}

${elementDescriptions.join('\n')}

TAILWIND CSS STYLING GUIDE:
- Layout: flex, flex-col, grid, grid-cols-1, md:grid-cols-2, lg:grid-cols-3
- Container: container, mx-auto, max-w-7xl, max-w-4xl
- Responsive classes: sm:*, md:*, lg:*, xl:*, 2xl:* for ALL major elements
- Spacing: p-2 md:p-4 lg:p-6, m-2 md:m-4, gap-2 md:gap-4
- Colors: bg-gray-900, text-white, bg-blue-500, hover:bg-blue-600
- Typography: text-sm md:text-base lg:text-lg, font-bold, leading-tight
- Borders: rounded-lg, border, border-gray-300, shadow-md, shadow-lg
- Hover/Focus: hover:bg-*, hover:scale-105, focus:ring-2, transition-all, duration-300
- Display: hidden md:block, md:hidden, flex md:flex-row flex-col

RESPONSIVE DESIGN REQUIREMENTS:
- Mobile (default): Single column, stacked layout, small text (text-sm)
- Tablet (md:768px): Adjust spacing, medium text (md:text-base)
- Desktop (lg:1024px): Multi-column if applicable, larger text (lg:text-lg)
- Example: <div class="flex flex-col md:flex-row gap-4 p-4 md:p-6 lg:p-8">
- Navigation: <nav class="flex flex-col md:flex-row items-center space-y-2 md:space-y-0 md:space-x-4">
- Headers: <h1 class="text-2xl md:text-4xl lg:text-5xl font-bold">
- Buttons: <button class="w-full md:w-auto px-4 py-2 md:px-6 md:py-3">
- Hide/Show: <div class="hidden md:block"> or <div class="md:hidden">

HTML STRUCTURE TEMPLATE:
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${pageData.title}</title>
    <link href="https://cdn.jsdelivr.net/npm/tailwindcss@3.4.0/dist/tailwind.min.css" rel="stylesheet">
    <style>
        /* Custom colors for exact RGB matches */
        .bg-custom-dark { background-color: ${pageData.bodyStyles.backgroundColor}; }
        .text-custom-light { color: ${pageData.bodyStyles.color}; }
        /* Add more custom color classes as needed */
        
        /* Ensure Tailwind loads properly */
        * { box-sizing: border-box; }
    </style>
</head>
<body class="bg-custom-dark text-custom-light min-h-screen">
    <header class="p-4 md:p-6">
        <!-- Responsive header with mobile menu if needed -->
    </header>
    
    <main class="container mx-auto px-4 md:px-6 lg:px-8 py-8">
        <!-- Main content with responsive grid/flex -->
    </main>
    
    <footer class="p-4 md:p-6 mt-8 border-t">
        <!-- Responsive footer -->
    </footer>

    <script>
        // Verify Tailwind loaded
        console.log('Tailwind CSS loaded:', document.querySelector('link[href*="tailwind"]') !== null);
    </script>
</body>
</html>

IMPORTANT INSTRUCTIONS:
1. Look at the SCREENSHOT carefully and replicate the EXACT visual layout
2. Use placeholder images: https://placehold.co/WIDTHxHEIGHT/BGCOLOR/TEXTCOLOR
3. ALL buttons, inputs, links MUST have proper Tailwind classes with responsive variants
4. Add hover:*, focus:*, active:* states for ALL interactive elements
5. Use transition-all duration-300 for smooth hover effects
6. Ensure proper text contrast and readability on all screen sizes
7. Make navigation mobile-friendly (hamburger menu or collapsible if needed)
8. Use proper spacing that scales: space-y-2 md:space-y-4 lg:space-y-6
9. Ensure UTF-8 encoding: Keep all special characters and international text exactly as is
10. Test layout at different breakpoints: mobile (default), tablet (md:), desktop (lg:)
11. Add container and max-w-* classes to prevent content from stretching too wide
12. Use relative/absolute positioning sparingly, prefer Flexbox/Grid

MOBILE OPTIMIZATION:
- Stack elements vertically on mobile (flex-col)
- Use full width buttons on mobile (w-full md:w-auto)
- Reduce padding/margins on mobile (p-2 md:p-4 lg:p-6)
- Make text readable on small screens (text-sm md:text-base)
- Ensure touch targets are at least 44px (p-3 for buttons)
- Hide non-essential elements on mobile if space is limited (hidden md:block)

OUTPUT:
Return ONLY the complete HTML code. NO explanations. NO markdown code blocks. Just pure HTML starting with <!DOCTYPE html>.
The HTML must be valid, complete, and ready to use immediately.`;

    try {
        // Convert screenshot to base64 without data URL prefix
        const base64Image = screenshotData.split(',')[1];

        const response = await fetch(`${API_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        {
                            text: prompt
                        },
                        {
                            inline_data: {
                                mime_type: 'image/png',
                                data: base64Image
                            }
                        }
                    ]
                }],
                generationConfig: {
                    temperature: 0.3,
                    maxOutputTokens: 8000,
                }
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const errorMsg = errorData.error?.message || `API error: ${response.status}`;

            if (response.status === 400) {
                throw new Error('Invalid API key. Please check your Gemini API key.');
            } else if (response.status === 429) {
                throw new Error('Rate limit exceeded. Please try again later.');
            }

            throw new Error(errorMsg);
        }

        const data = await response.json();

        if (!data.candidates || !data.candidates[0]?.content?.parts?.[0]?.text) {
            throw new Error('Invalid response from Gemini API');
        }

        let htmlContent = data.candidates[0].content.parts[0].text;

        // Clean up markdown code blocks if present
        htmlContent = htmlContent.replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();

        // Ensure we have valid HTML with Tailwind CDN
        if (!htmlContent.includes('<html')) {
            throw new Error('Generated content is not valid HTML');
        }

        // Verify Tailwind CDN is included
        if (!htmlContent.includes('tailwindcss')) {
            // Inject Tailwind CDN if missing
            if (htmlContent.includes('</head>')) {
                htmlContent = htmlContent.replace(
                    '</head>',
                    '    <link href="https://cdn.jsdelivr.net/npm/tailwindcss@3.4.0/dist/tailwind.min.css" rel="stylesheet">\n</head>'
                );
            } else {
                // If no proper head tag, rebuild the HTML structure
                const bodyContent = htmlContent.match(/<body[^>]*>([\s\S]*)<\/body>/i);
                if (bodyContent) {
                    htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${pageData.title}</title>
    <link href="https://cdn.jsdelivr.net/npm/tailwindcss@3.4.0/dist/tailwind.min.css" rel="stylesheet">
</head>
<body>
${bodyContent[1]}
</body>
</html>`;
                }
            }
        }

        // Ensure viewport meta tag exists
        if (!htmlContent.includes('viewport')) {
            htmlContent = htmlContent.replace(
                '<head>',
                '<head>\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">'
            );
        }

        return htmlContent;
    } catch (error) {
        if (error.message) {
            throw error;
        }
        throw new Error('Failed to connect to Gemini API. Check your internet connection.');
    }
}

function downloadHTML(htmlContent, pageTitle) {
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const filename = pageTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 50) || 'page';
    a.download = `replica-${filename}-${Date.now()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
}