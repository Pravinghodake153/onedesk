chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'OPEN_NATIVE') {
    handleOpenNative(message.url, message.cookies);
  }
});

async function handleOpenNative(targetUrl, cookies) {
  console.log(`Received request to open ${targetUrl} natively with ${cookies.length} cookies.`);
  
  // Clean up and format cookies for chrome.cookies.set()
  const setPromises = cookies.map(cookie => {
    let url = (cookie.secure ? 'https://' : 'http://') + cookie.domain.replace(/^\./, '') + cookie.path;
    
    let cookieDetails = {
      url: url,
      name: cookie.name,
      value: cookie.value,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      // Note: Chrome extension cookies API uses expirationDate but sometimes requires omitting session cookies
    };

    if (cookie.expirationDate) {
      cookieDetails.expirationDate = cookie.expirationDate;
    }

    // Host-only cookies and __Host- prefixed cookies MUST NOT have a domain attribute
    if (!cookie.hostOnly && !cookie.name.startsWith('__Host-')) {
      cookieDetails.domain = cookie.domain;
    }

    return new Promise(resolve => {
      chrome.cookies.set(cookieDetails, (result) => {
        if (chrome.runtime.lastError) {
          console.warn('Failed to set cookie', cookieDetails.name, chrome.runtime.lastError);
        }
        resolve();
      });
    });
  });

  // Wait for all cookies to be injected
  await Promise.all(setPromises);
  console.log('All cookies synced locally. Opening Incognito window...');

  // Open the target URL in a new native Incognito window
  chrome.windows.create({
    url: targetUrl,
    incognito: true,
    state: 'maximized'
  });
}
