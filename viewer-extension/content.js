// Notify the web app that the Viewer Extension is installed (CSP Safe)
document.documentElement.dataset.onedeskViewerReady = "true";

// Listen for messages from the web app
window.addEventListener('message', (event) => {
  // We only accept messages from ourselves
  if (event.source !== window) return;

  if (event.data && event.data.type === 'ONEDESK_OPEN_NATIVE_BROWSER') {
    // Forward the request to the background service worker
    chrome.runtime.sendMessage({
      type: 'OPEN_NATIVE',
      url: event.data.url,
      cookies: event.data.cookies
    });
  }
});
