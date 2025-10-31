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
        showProgress('Analyzing page structure...');

        // Get active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab) {
            throw new Error('No active tab found');
        }

        // Check if we can access the page
        if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
            throw new Error('Cannot capture Chrome system pages');
        }

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

        // Generate replica using Gemini API
        showProgress('Generating replica with Gemini AI...');
        const replica = await generateReplicaWithGemini(pageData, apiKey);

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

// Function injected into page to capture data
function capturePage() {
    try {
        const elements = [];
        const seenElements = new Set();

        function getElementData(el) {
            try {
                const rect = el.getBoundingClientRect();
                const styles = window.getComputedStyle(el);

                let text = '';
                if (['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'BUTTON', 'A', 'SPAN', 'LI'].includes(el.tagName)) {
                    text = Array.from(el.childNodes)
                        .filter(node => node.nodeType === 3)
                        .map(node => node.textContent.trim())
                        .join(' ')
                        .substring(0, 150);
                }

                return {
                    tag: el.tagName.toLowerCase(),
                    text: text,
                    src: el.src || el.getAttribute('src') || '',
                    href: el.href || el.getAttribute('href') || '',
                    alt: el.alt || '',
                    id: el.id || '',
                    classList: Array.from(el.classList).slice(0, 5),
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
                        display: styles.display,
                        textAlign: styles.textAlign
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
            footer: document.querySelector('footer')
        };

        // Capture key elements
        const selectors = [
            'header', 'nav', 'main', 'footer', 'section', 'article',
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'p', 'img', 'a', 'button',
            '.hero', '.banner', '.card', '.container', '.content'
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

        // Get color scheme
        const bodyStyles = window.getComputedStyle(document.body);
        const htmlStyles = window.getComputedStyle(document.documentElement);

        return {
            title: document.title || 'Untitled Page',
            url: window.location.href,
            viewport: {
                width: window.innerWidth,
                height: window.innerHeight
            },
            bodyStyles: {
                backgroundColor: bodyStyles.backgroundColor,
                color: bodyStyles.color,
                fontFamily: bodyStyles.fontFamily,
                fontSize: bodyStyles.fontSize
            },
            htmlStyles: {
                backgroundColor: htmlStyles.backgroundColor
            },
            structure: {
                hasHeader: !!structure.header,
                hasNav: !!structure.nav,
                hasMain: !!structure.main,
                hasFooter: !!structure.footer
            },
            elements: elements.slice(0, 80)
        };
    } catch (error) {
        throw new Error('Failed to analyze page: ' + error.message);
    }
}

async function generateReplicaWithGemini(pageData, apiKey) {
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`;

    const headings = pageData.elements.filter(el => el.tag.match(/^h[1-6]$/));
    const images = pageData.elements.filter(el => el.tag === 'img');
    const buttons = pageData.elements.filter(el => el.tag === 'button');
    const links = pageData.elements.filter(el => el.tag === 'a');

    const prompt = `Create a responsive HTML replica of a webpage with these characteristics:

TITLE: ${pageData.title}

LAYOUT STRUCTURE:
- Has Header: ${pageData.structure.hasHeader}
- Has Navigation: ${pageData.structure.hasNav}
- Has Main Content: ${pageData.structure.hasMain}
- Has Footer: ${pageData.structure.hasFooter}

COLOR SCHEME:
- Background: ${pageData.bodyStyles.backgroundColor}
- Text Color: ${pageData.bodyStyles.color}
- Font: ${pageData.bodyStyles.fontFamily}

CONTENT ELEMENTS:
${headings.slice(0, 10).map((h, i) => `${i + 1}. <${h.tag}> ${h.text}`).join('\n')}

Images: ${images.length} images
Buttons: ${buttons.length} buttons${buttons.length > 0 ? ` (${buttons.slice(0, 3).map(b => `"${b.text}"`).join(', ')})` : ''}
Links: ${links.length} links

REQUIREMENTS:
1. Use Tailwind CSS v3.4 via CDN (https://cdn.jsdelivr.net/npm/tailwindcss@3.4.0/dist/tailwind.min.css)
2. Create a modern, responsive design (mobile-first)
3. Use semantic HTML5 elements
4. Include proper header/nav/main/footer structure based on the layout
5. Use placeholder images from https://placehold.co/WIDTHxHEIGHT
6. Create a visually appealing layout with proper spacing
7. Use similar color scheme
8. Make all interactive elements functional
9. Add smooth transitions and hover effects
10. Ensure proper contrast and readability

Return ONLY the complete HTML code, no explanations or markdown code blocks.`;

    try {
        const response = await fetch(`${API_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: prompt
                    }]
                }],
                generationConfig: {
                    temperature: 0.7,
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

        // Ensure we have valid HTML
        if (!htmlContent.includes('<html') && !htmlContent.includes('<!DOCTYPE')) {
            throw new Error('Generated content is not valid HTML');
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