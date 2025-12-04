// Wait for YouTube player to load
function waitForElement(selector, callback) {
  const observer = new MutationObserver((mutations, obs) => {
    const element = document.querySelector(selector);
    if (element) {
      obs.disconnect();
      callback(element);
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Get current video ID
function getVideoId() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('v');
}

// Get current video time
function getCurrentTime() {
  const video = document.querySelector('video');
  return video ? Math.floor(video.currentTime) : 0;
}

// Format time as MM:SS
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Create and inject the note button
function injectNoteButton() {
  // Remove existing button if any
  const existing = document.getElementById('yt-note-btn');
  if (existing) existing.remove();

  // Find the settings button container
  const settingsBtn = document.querySelector('.ytp-settings-button');
  if (!settingsBtn) {
    setTimeout(injectNoteButton, 1000);
    return;
  }

  // Create note button
  const noteBtn = document.createElement('button');
  noteBtn.id = 'yt-note-btn';
  noteBtn.className = 'ytp-button';
  noteBtn.title = 'Add note at current timestamp';
  noteBtn.innerHTML = `
    <svg height="100%" version="1.1" viewBox="0 0 36 36" width="100%">
      <path fill="#fff" d="M18,11 L18,17 L24,17 L24,19 L18,19 L18,25 L16,25 L16,19 L10,19 L10,17 L16,17 L16,11 Z M18,4 C10.268,4 4,10.268 4,18 C4,25.732 10.268,32 18,32 C25.732,32 32,25.732 32,18 C32,10.268 25.732,4 18,4 Z"></path>
    </svg>
  `;

  // Add click handler
  noteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const videoId = getVideoId();
    const timestamp = getCurrentTime();
    
    if (!videoId) return;

    // Show feedback
    noteBtn.style.opacity = '0.5';
    setTimeout(() => noteBtn.style.opacity = '1', 200);

    // Save timestamp
    const result = await chrome.storage.local.get(videoId);
    const notes = result[videoId] || [];
    
    notes.push({
      id: Date.now().toString(),
      timestamp: timestamp,
      note: '',
      createdAt: new Date().toISOString()
    });

    await chrome.storage.local.set({ [videoId]: notes });
  });

  // Insert button before settings
  settingsBtn.parentElement.insertBefore(noteBtn, settingsBtn);
}

// Initialize when on YouTube watch page
if (window.location.href.includes('youtube.com/watch')) {
  waitForElement('.ytp-settings-button', () => {
    injectNoteButton();
  });

  // Re-inject on navigation (YouTube is a SPA)
  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      if (url.includes('youtube.com/watch')) {
        setTimeout(injectNoteButton, 1000);
      }
    }
  }).observe(document, { subtree: true, childList: true });
}

// Listen for messages from popup to jump to timestamp
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'jumpToTime') {
    const video = document.querySelector('video');
    if (video) {
      video.currentTime = request.timestamp;
      video.play();
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false });
    }
  }
  return true;
});