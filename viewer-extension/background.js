chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'OPEN_NATIVE') {
    handleOpenNative(message.url, message.cookies);
  }
});

async function handleOpenNative(targetUrl, cookies) {
  console.log(`Received request to open ${targetUrl} natively with ${cookies.length} cookies.`);

  // 1. Create the incognito window FIRST to initialize the incognito cookie store
  const newWindow = await new Promise(resolve => {
    chrome.windows.create({
      url: 'about:blank', // Start blank so we can inject cookies before loading the real site
      incognito: true,
      state: 'maximized'
    }, resolve);
  });

  // 2. Find the storeId for this new incognito window
  let storeId = "1"; // Default Chrome incognito storeId
  if (newWindow.tabs && newWindow.tabs.length > 0) {
    const tabId = newWindow.tabs[0].id;
    const stores = await new Promise(resolve => chrome.cookies.getAllCookieStores(resolve));
    const targetStore = stores.find(store => store.tabIds.includes(tabId));
    if (targetStore) {
      storeId = targetStore.id;
    }
  }

  console.log(`Using incognito storeId: ${storeId}`);

  // 3. Inject all cookies into the specific incognito store
  const setPromises = cookies.map(cookie => {
    let url = (cookie.secure ? 'https://' : 'http://') + cookie.domain.replace(/^\./, '') + cookie.path;
    
    let cookieDetails = {
      url: url,
      name: cookie.name,
      value: cookie.value,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      storeId: storeId // CRUCIAL: target the incognito store!
    };

    if (cookie.expirationDate) {
      cookieDetails.expirationDate = cookie.expirationDate;
    }

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

  await Promise.all(setPromises);
  console.log('All cookies synced locally to incognito store. Navigating...');

  // 4. Now that cookies are in, navigate the tab to the actual URL
  if (newWindow.tabs && newWindow.tabs.length > 0) {
    chrome.tabs.update(newWindow.tabs[0].id, { url: targetUrl });
  }
}
