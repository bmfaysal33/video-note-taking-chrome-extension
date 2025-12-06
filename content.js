// Wait for element to appear
function waitForElement(selector, callback, timeout = 10000) {
  const startTime = Date.now();
  const observer = new MutationObserver((mutations, obs) => {
    const element = document.querySelector(selector);
    if (element) {
      obs.disconnect();
      callback(element);
    } else if (Date.now() - startTime > timeout) {
      obs.disconnect();
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  // Check immediately
  const element = document.querySelector(selector);
  if (element) callback(element);
}

// Get unique page identifier
function getPageId() {
  const url = window.location.href;
  
  // For YouTube
  if (url.includes('youtube.com/watch')) {
    const urlParams = new URLSearchParams(window.location.search);
    return `yt_${urlParams.get('v')}`;
  }
  
  // For Vimeo
  if (url.includes('vimeo.com/')) {
    const match = url.match(/vimeo\.com\/(\d+)/);
    return match ? `vimeo_${match[1]}` : `url_${btoa(url).substring(0, 50)}`;
  }
  
  // For Dailymotion
  if (url.includes('dailymotion.com/video/')) {
    const match = url.match(/video\/([^_?]+)/);
    return match ? `dm_${match[1]}` : `url_${btoa(url).substring(0, 50)}`;
  }
  
  // For other sites - use URL hash
  return `url_${btoa(url).substring(0, 50)}`;
}

// Get page title
function getPageTitle() {
  // Try YouTube specific title
  const ytTitle = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, h1.title');
  if (ytTitle) return ytTitle.textContent.trim();
  
  // Try Vimeo title
  const vimeoTitle = document.querySelector('.player-title');
  if (vimeoTitle) return vimeoTitle.textContent.trim();
  
  // Fall back to page title
  return document.title || 'Video';
}

// Find video element on page
function findVideoElement() {
  // Try to find the main video
  const videos = document.querySelectorAll('video');
  if (videos.length === 0) return null;
  
  // If multiple videos, find the largest one (likely the main video)
  if (videos.length === 1) return videos[0];
  
  let largestVideo = videos[0];
  let maxArea = 0;
  
  videos.forEach(video => {
    const rect = video.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > maxArea) {
      maxArea = area;
      largestVideo = video;
    }
  });
  
  return largestVideo;
}

// Get current video time
function getCurrentTime() {
  const video = findVideoElement();
  return video ? Math.floor(video.currentTime) : 0;
}

// Format time as HH:MM:SS or MM:SS
function formatTime(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Create integrated button for non-YouTube video players (like YouTube style)
function createIntegratedButton() {
  const existingBtn = document.getElementById('video-note-integrated-btn');
  if (existingBtn) return;
  
  const video = findVideoElement();
  if (!video) return;
  
  // Find video container
  let videoContainer = video.parentElement;
  while (videoContainer && !videoContainer.querySelector('video')) {
    videoContainer = videoContainer.parentElement;
  }
  
  if (!videoContainer) {
    videoContainer = video.parentElement;
  }
  
  // Create button container
  const btnContainer = document.createElement('div');
  btnContainer.id = 'video-note-integrated-btn';
  btnContainer.className = 'video-note-integrated-container';
  
  const floatingBtn = document.createElement('button');
  floatingBtn.className = 'video-note-integrated-btn';
  floatingBtn.title = 'Add note at current timestamp (Alt+N)';
  floatingBtn.innerHTML = `
    <svg viewBox="0 0 36 36" width="36" height="36">
      <path fill="#fff" d="M18,11 L18,17 L24,17 L24,19 L18,19 L18,25 L16,25 L16,19 L10,19 L10,17 L16,17 L16,11 Z M18,4 C10.268,4 4,10.268 4,18 C4,25.732 10.268,32 18,32 C25.732,32 32,25.732 32,18 C32,10.268 25.732,4 18,4 Z"></path>
    </svg>
  `;
  
  floatingBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const pageId = getPageId();
    const timestamp = getCurrentTime();
    const pageTitle = getPageTitle();
    
    if (!pageId) return;
    
    // Visual feedback
    floatingBtn.style.transform = 'scale(0.9)';
    setTimeout(() => floatingBtn.style.transform = 'scale(1)', 200);
    
    // Save timestamp
    const result = await chrome.storage.local.get(pageId);
    const notes = result[pageId] || [];
    
    notes.push({
      id: Date.now().toString(),
      timestamp: timestamp,
      note: '',
      createdAt: new Date().toISOString(),
      pageTitle: pageTitle,
      pageUrl: window.location.href
    });
    
    await chrome.storage.local.set({ [pageId]: notes });
    
    // Show success message
    showNotification('Note timestamp saved!');
  });
  
  btnContainer.appendChild(floatingBtn);
  videoContainer.appendChild(btnContainer);
  
  // Show/hide with video controls
  let hideTimeout;
  let isVisible = true;
  
  function showButton() {
    btnContainer.classList.add('visible');
    isVisible = true;
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
      if (!video.paused) {
        btnContainer.classList.remove('visible');
        isVisible = false;
      }
    }, 2000);
  }
  
  function hideButton() {
    clearTimeout(hideTimeout);
    btnContainer.classList.remove('visible');
    isVisible = false;
  }
  
  // Show button on mouse move over video
  videoContainer.addEventListener('mousemove', showButton);
  videoContainer.addEventListener('mouseenter', showButton);
  videoContainer.addEventListener('mouseleave', hideButton);
  
  // Show when paused, hide when playing
  video.addEventListener('play', () => {
    hideTimeout = setTimeout(() => {
      if (!isVisible) hideButton();
    }, 2000);
  });
  
  video.addEventListener('pause', showButton);
  
  // Show initially
  showButton();
  
  // Keyboard shortcut Alt+N
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === 'n') {
      e.preventDefault();
      floatingBtn.click();
    }
  });
}

// Show notification
function showNotification(message) {
  const existing = document.getElementById('video-note-notification');
  if (existing) existing.remove();
  
  const notification = document.createElement('div');
  notification.id = 'video-note-notification';
  notification.className = 'video-note-notification';
  notification.textContent = message;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.classList.add('show');
  }, 10);
  
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 2000);
}

// Inject button for YouTube
function injectYouTubeButton() {
  const existing = document.getElementById('yt-note-btn');
  if (existing) existing.remove();
  
  const settingsBtn = document.querySelector('.ytp-settings-button');
  if (!settingsBtn) {
    setTimeout(injectYouTubeButton, 1000);
    return;
  }
  
  const noteBtn = document.createElement('button');
  noteBtn.id = 'yt-note-btn';
  noteBtn.className = 'ytp-button';
  noteBtn.title = 'Add note at current timestamp';
  noteBtn.innerHTML = `
    <svg height="90%" version="1.1" viewBox="11 4 40 40" width="100%">
      <path fill="#fff" d="M18,11 L18,17 L24,17 L24,19 L18,19 L18,25 L16,25 L16,19 L10,19 L10,17 L16,17 L16,11 Z M18,4 C10.268,4 4,10.268 4,18 C4,25.732 10.268,32 18,32 C25.732,32 32,25.732 32,18 C32,10.268 25.732,4 18,4 Z"></path>
    </svg>
  `;
  
  noteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const pageId = getPageId();
    const timestamp = getCurrentTime();
    const pageTitle = getPageTitle();
    
    if (!pageId) return;
    
    noteBtn.style.opacity = '0.5';
    setTimeout(() => noteBtn.style.opacity = '1', 200);
    
    const result = await chrome.storage.local.get(pageId);
    const notes = result[pageId] || [];
    
    notes.push({
      id: Date.now().toString(),
      timestamp: timestamp,
      note: '',
      createdAt: new Date().toISOString(),
      pageTitle: pageTitle,
      pageUrl: window.location.href
    });
    
    await chrome.storage.local.set({ [pageId]: notes });
  });
  
  settingsBtn.parentElement.insertBefore(noteBtn, settingsBtn);
}

// Initialize based on site
function initializeExtension() {
  const video = findVideoElement();
  if (!video) return;
  
  if (window.location.href.includes('youtube.com/watch')) {
    // YouTube - inject into player controls
    waitForElement('.ytp-settings-button', () => {
      injectYouTubeButton();
    });
  } else {
    // Other sites - create integrated button (YouTube style)
    createIntegratedButton();
  }
}

// Start monitoring for videos
function startMonitoring() {
  // Check for videos every 2 seconds
  const checkInterval = setInterval(() => {
    const video = findVideoElement();
    if (video) {
      initializeExtension();
      clearInterval(checkInterval);
    }
  }, 2000);
  
  // Stop checking after 30 seconds
  setTimeout(() => clearInterval(checkInterval), 30000);
}

// Initialize on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startMonitoring);
} else {
  startMonitoring();
}

// Handle YouTube navigation (SPA)
if (window.location.href.includes('youtube.com')) {
  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      if (url.includes('youtube.com/watch')) {
        setTimeout(() => {
          injectYouTubeButton();
        }, 1000);
      }
    }
  }).observe(document, { subtree: true, childList: true });
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'jumpToTime') {
    const video = findVideoElement();
    if (video) {
      video.currentTime = request.timestamp;
      video.play();
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false });
    }
  }
  
  if (request.action === 'getPageInfo') {
    sendResponse({
      pageId: getPageId(),
      pageTitle: getPageTitle(),
      pageUrl: window.location.href,
      hasVideo: !!findVideoElement()
    });
  }
  
  return true;
});