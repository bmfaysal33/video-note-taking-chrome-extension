// Format time as MM:SS
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// State management
let currentView = 'notes'; // 'notes' or 'dashboard'
let currentVideoId = null;

// Get video ID from current tab
async function getCurrentVideoId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.url) return null;
  
  try {
    // Ask content script for page info
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'getPageInfo' });
    if (response && response.pageId && response.hasVideo) {
      return response.pageId;
    }
  } catch (error) {
    console.log('Could not get page info from content script');
  }
  
  return null;
}

// Open video in current or new tab
async function openVideo(pageId, pageUrl) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (pageUrl) {
    // Open the stored URL
    if (tab.url && (tab.url.includes('youtube.com') || tab.url.includes('vimeo.com') || tab.url.includes('dailymotion.com'))) {
      await chrome.tabs.update(tab.id, { url: pageUrl });
    } else {
      await chrome.tabs.create({ url: pageUrl });
    }
  }
  
  setTimeout(() => {
    currentVideoId = pageId;
    currentView = 'notes';
    renderNotes();
  }, 500);
}

// Get video title from stored data or page
async function getVideoTitle(pageId) {
  try {
    // Get from storage first
    const result = await chrome.storage.local.get(pageId);
    const notes = result[pageId];
    if (notes && notes.length > 0 && notes[0].pageTitle) {
      return notes[0].pageTitle;
    }
    
    // Try to fetch from current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.url) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'getPageInfo' });
        if (response && response.pageTitle) {
          return response.pageTitle;
        }
      } catch (error) {
        console.log('Could not get title from tab');
      }
    }
  } catch (error) {
    console.log('Could not fetch title');
  }
  
  // Fallback
  return `Video: ${pageId.substring(0, 15)}...`;
}

// Get all videos with notes
async function getAllVideosWithNotes() {
  const allData = await chrome.storage.local.get(null);
  const videos = [];
  
  for (const [pageId, notes] of Object.entries(allData)) {
    if (Array.isArray(notes) && notes.length > 0) {
      const title = notes[0].pageTitle || await getVideoTitle(pageId);
      const pageUrl = notes[0].pageUrl || '';
      
      // Get thumbnail based on site
      let thumbnail = '';
      if (pageId.startsWith('yt_')) {
        const videoId = pageId.replace('yt_', '');
        thumbnail = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
      } else if (pageId.startsWith('vimeo_')) {
        thumbnail = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 68"><rect fill="%2300adef" width="120" height="68"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Arial" font-size="24" fill="white">Vimeo</text></svg>';
      } else {
        thumbnail = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 68"><rect fill="%23333" width="120" height="68"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Arial" font-size="20" fill="white">Video</text></svg>';
      }
      
      videos.push({
        pageId,
        title,
        pageUrl,
        noteCount: notes.length,
        lastModified: Math.max(...notes.map(n => new Date(n.createdAt).getTime())),
        thumbnail
      });
    }
  }
  
  // Sort by last modified
  videos.sort((a, b) => b.lastModified - a.lastModified);
  
  return videos;
}

// Jump to timestamp in video
async function jumpToTimestamp(timestamp) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (time) => {
        const video = document.querySelector('video');
        if (video) {
          video.currentTime = time;
          video.play();
        }
      },
      args: [timestamp]
    });
  } catch (error) {
    console.error('Error jumping to timestamp:', error);
    // Fallback: Send message to content script
    chrome.tabs.sendMessage(tab.id, { 
      action: 'jumpToTime', 
      timestamp: timestamp 
    });
  }
}

// Save note
async function saveNote(videoId, noteId, noteText) {
  const result = await chrome.storage.local.get(videoId);
  const notes = result[videoId] || [];
  
  const noteIndex = notes.findIndex(n => n.id === noteId);
  if (noteIndex !== -1) {
    notes[noteIndex].note = noteText;
    await chrome.storage.local.set({ [videoId]: notes });
  }
}

// Delete note
async function deleteNote(videoId, noteId) {
  const result = await chrome.storage.local.get(videoId);
  const notes = result[videoId] || [];
  
  const filteredNotes = notes.filter(n => n.id !== noteId);
  await chrome.storage.local.set({ [videoId]: filteredNotes });
  
  renderNotes();
}

// Render notes list
async function renderNotes() {
  const content = document.getElementById('content');
  const headerTitle = document.getElementById('header-title');
  const toggleBtn = document.getElementById('toggle-view');
  
  headerTitle.textContent = 'Current Video Notes';
  toggleBtn.innerHTML = `
    <svg viewBox="0 0 24 24" width="20" height="20" fill="white">
      <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>
    </svg>
  `;
  toggleBtn.title = 'View all videos';
  
  const videoId = await getCurrentVideoId();
  currentVideoId = videoId;

  if (!videoId) {
    content.innerHTML = `
      <div class="not-youtube">
        <p>Open a page with a video to view notes.</p>
        <p style="font-size: 12px; margin-top: 8px;">Or <a href="#" id="view-all-link" style="color: #065fd4;">view all videos with notes</a></p>
      </div>
    `;
    
    document.getElementById('view-all-link').addEventListener('click', (e) => {
      e.preventDefault();
      currentView = 'dashboard';
      renderDashboard();
    });
    return;
  }

  const result = await chrome.storage.local.get(videoId);
  const notes = result[videoId] || [];

  // Sort by timestamp
  notes.sort((a, b) => a.timestamp - b.timestamp);

  if (notes.length === 0) {
    content.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 36 36">
          <path d="M18,11 L18,17 L24,17 L24,19 L18,19 L18,25 L16,25 L16,19 L10,19 L10,17 L16,17 L16,11 Z M18,4 C10.268,4 4,10.268 4,18 C4,25.732 10.268,32 18,32 C25.732,32 32,25.732 32,18 C32,10.268 25.732,4 18,4 Z"></path>
        </svg>
        <p>No notes yet!</p>
        <p style="font-size: 12px; margin-top: 8px;">Click the + button on the video player to add notes.</p>
      </div>
    `;
    return;
  }

  const notesList = document.createElement('div');
  notesList.className = 'notes-list';

  notes.forEach(note => {
    const noteItem = document.createElement('div');
    noteItem.className = 'note-item';
    noteItem.id = `note-${note.id}`;

    noteItem.innerHTML = `
      <div class="note-header">
        <div class="timestamp" data-time="${note.timestamp}">${formatTime(note.timestamp)}</div>
        <div class="note-actions">
          <button class="btn edit" data-id="${note.id}" title="Edit note">
            <svg viewBox="0 0 24 24">
              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
            </svg>
          </button>
          <button class="btn delete" data-id="${note.id}" title="Delete note">
            <svg viewBox="0 0 24 24">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="note-content">
        <div class="note-text">${note.note || '<i style="color: #999;">Click edit to add a note...</i>'}</div>
      </div>
    `;

    notesList.appendChild(noteItem);
  });

  content.innerHTML = '';
  content.appendChild(notesList);

  // Add event listeners
  document.querySelectorAll('.timestamp').forEach(el => {
    el.addEventListener('click', () => {
      const time = parseInt(el.dataset.time);
      jumpToTimestamp(time);
    });
  });

  document.querySelectorAll('.btn.edit').forEach(el => {
    el.addEventListener('click', () => {
      const noteId = el.dataset.id;
      enterEditMode(videoId, noteId);
    });
  });

  document.querySelectorAll('.btn.delete').forEach(el => {
    el.addEventListener('click', () => {
      const noteId = el.dataset.id;
      if (confirm('Delete this note?')) {
        deleteNote(videoId, noteId);
      }
    });
  });
}

// Enter edit mode for a note
function enterEditMode(videoId, noteId) {
  chrome.storage.local.get(videoId).then(result => {
    const notes = result[videoId] || [];
    const note = notes.find(n => n.id === noteId);
    if (!note) return;

    const noteItem = document.getElementById(`note-${noteId}`);
    const noteContent = noteItem.querySelector('.note-content');

    noteContent.innerHTML = `
      <textarea class="note-input" placeholder="Add your note here...">${note.note}</textarea>
      <div class="edit-actions">
        <button class="btn-cancel">Cancel</button>
        <button class="btn-save">Save</button>
      </div>
    `;

    const textarea = noteContent.querySelector('.note-input');
    const saveBtn = noteContent.querySelector('.btn-save');
    const cancelBtn = noteContent.querySelector('.btn-cancel');

    textarea.focus();

    saveBtn.addEventListener('click', async () => {
      await saveNote(videoId, noteId, textarea.value);
      renderNotes();
    });

    cancelBtn.addEventListener('click', () => {
      renderNotes();
    });

    // Save on Ctrl+Enter
    textarea.addEventListener('keydown', async (e) => {
      if (e.ctrlKey && e.key === 'Enter') {
        await saveNote(videoId, noteId, textarea.value);
        renderNotes();
      }
    });
  });
}

// Initialize
renderNotes();

// Toggle between notes and dashboard
document.getElementById('toggle-view').addEventListener('click', () => {
  if (currentView === 'notes') {
    currentView = 'dashboard';
    renderDashboard();
  } else {
    currentView = 'notes';
    renderNotes();
  }
});

// Render dashboard with all videos
async function renderDashboard() {
  const content = document.getElementById('content');
  const headerTitle = document.getElementById('header-title');
  const toggleBtn = document.getElementById('toggle-view');
  
  headerTitle.textContent = 'All Videos';
  toggleBtn.innerHTML = `
    <svg viewBox="0 0 24 24" width="20" height="20" fill="white">
      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/>
    </svg>
  `;
  toggleBtn.title = 'Back to current video';
  
  const videos = await getAllVideosWithNotes();
  
  if (videos.length === 0) {
    content.innerHTML = `
      <div class="dashboard-empty">
        <svg viewBox="0 0 24 24">
          <path fill="#ddd" d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12.5v-9l6 4.5-6 4.5z"/>
        </svg>
        <p>No videos with notes yet</p>
        <p style="font-size: 12px; margin-top: 8px; color: #aaa;">Start watching YouTube videos and add notes!</p>
      </div>
    `;
    return;
  }
  
  const dashboard = document.createElement('div');
  dashboard.className = 'dashboard';
  
  videos.forEach(video => {
    const card = document.createElement('div');
    card.className = 'video-card';
    card.dataset.pageId = video.pageId;
    
    card.innerHTML = `
      <div class="video-card-header">
        <img src="${video.thumbnail}" alt="Thumbnail" class="video-thumbnail" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 120 68%22><rect fill=%22%23333%22 width=%22120%22 height=%2268%22/></svg>'" />
        <div class="video-info">
          <div class="video-title-text">${video.title}</div>
          <div class="video-meta">
            <div class="note-count">
              <svg viewBox="0 0 24 24">
                <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
              </svg>
              ${video.noteCount} note${video.noteCount !== 1 ? 's' : ''}
            </div>
          </div>
        </div>
      </div>
    `;
    
    card.addEventListener('click', () => {
      openVideo(video.pageId, video.pageUrl);
      window.close();
    });
    
    dashboard.appendChild(card);
  });
  
  content.innerHTML = '';
  content.appendChild(dashboard);
}