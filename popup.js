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
  chrome.storage.sync.set({ geminiApiKey: apiKeyInput.value });
  showStatus('API key saved', 'success');
  setTimeout(() => {
    status.style.display = 'none';
  }, 2000);
});

function showStatus(message, type) {
  status.textContent = message;
  status.className = type;
}

function showProgress(text) {
  progress.textContent = text;
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
    showProgress('');

    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Inject content script to capture page data
    showProgress('Analyzing page structure...');
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: capturePage
    });

    if (!result.result) {
      throw new Error('Failed to capture page data');
    }

    const pageData = result.result;
    
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
    }, 2000);

  } catch (error) {
    console.error('Error:', error);
    showStatus(`Error: ${error.message}`, 'error');
    showProgress('');
    captureBtn.disabled = false;
  }
});

// Function injected into page to capture data
function capturePage() {
  const elements = [];
  
  function getElementData(el) {
    const rect = el.getBoundingClientRect();
    const styles = window.getComputedStyle(el);
    
    // Get inner text for specific element only
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
  }

  // Capture structural elements first
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
  
  const seenElements = new Set();
  
  selectors.forEach(selector => {
    document.querySelectorAll(selector).forEach(el => {
      if (el.offsetParent !== null && !seenElements.has(el)) {
        seenElements.add(el);
        elements.push(getElementData(el));
      }
    });
  });

  // Get color scheme
  const bodyStyles = window.getComputedStyle(document.body);
  const htmlStyles = window.getComputedStyle(document.documentElement);

  return {
    title: document.title,
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
    elements: elements.slice(0, 80) // Limit for API
  };
}

async function generateReplicaWithGemini(pageData, apiKey) {
  const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
  
  // Build a concise summary of the page
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
${headings.slice(0, 10).map((h, i) => `${i+1}. <${h.tag}> ${h.text}`).join('\n')}

Images: ${images.length} images found
Buttons: ${buttons.length} buttons (${buttons.slice(0, 3).map(b => `"${b.text}"`).join(', ')})
Links: ${links.length} links

REQUIREMENTS:
1. Use Tailwind CSS v3.4 via CDN
2. Create a modern, responsive design (mobile-first)
3. Use semantic HTML5 elements
4. Include proper header/nav/main/footer structure based on the layout
5. Use placeholder images from https://placehold.co/WIDTHxHEIGHT
6. Create a visually appealing layout with proper spacing
7. Use similar color scheme
8. Make all interactive elements functional (buttons, links)
9. Add smooth transitions and hover effects
10. Ensure proper contrast and readability

Return ONLY the complete HTML code with embedded CSS (using Tailwind classes), no explanations or markdown.`;

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
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to generate replica');
  }

  const data = await response.json();
  let htmlContent = data.candidates[0].content.parts[0].text;
  
  // Clean up markdown code blocks if present
  htmlContent = htmlContent.replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();
  
  return htmlContent;
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
    .substring(0, 50);
  a.download = `replica-${filename}-${Date.now()}.html`;
  a.click();
  URL.revokeObjectURL(url);
}