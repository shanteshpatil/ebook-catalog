'use strict';

/* =====================================================================
   Book Catalog - Renderer App
   State-driven, vanilla JS, no framework.
   ===================================================================== */

const api = window.electronAPI;

// ── State ─────────────────────────────────────────────────────────────
const state = {
  books:    [],       // all books from last DB fetch
  filtered: [],       // displayed after search/filter
  view:     'grid',   // 'grid' | 'list'
  sort:     'title',
  dir:      'asc',
  folder:   'all',
  format:   'all',
  status:   'all',    // 'all' | 'reading' | 'read'
  query:    '',
  scanning: false,
  currentBook: null,
};

// ── DOM refs ──────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const els = {
  app:             $('app'),
  welcome:         $('welcome-screen'),
  welcomeNoPath:   $('welcome-no-path'),
  welcomeHasPath:  $('welcome-has-path'),
  welcomePathDisplay: $('welcome-path-display'),
  btnChooseFolder: $('btn-choose-folder'),
  btnChangeFolderWelcome: $('btn-change-folder-welcome'),
  scanOverlay:     $('scan-overlay'),
  scanStatus:      $('scan-status'),
  progressBar:     $('progress-bar'),
  progressText:    $('progress-text'),
  btnStartScan:    $('btn-start-scan'),
  searchInput:     $('search-input'),
  searchClear:     $('search-clear'),
  btnGrid:         $('btn-grid'),
  btnList:         $('btn-list'),
  sortSelect:      $('sort-select'),
  sortDir:         $('sort-dir'),
  btnRescan:       $('btn-rescan'),
  btnSettings:     $('btn-settings'),
  btnExport:       $('btn-export'),
  // Settings modal
  settingsBackdrop:        $('settings-backdrop'),
  settingsClose:           $('settings-close'),
  settingsPathDisplay:     $('settings-path-display'),
  settingsChangeFolder:    $('settings-change-folder'),
  settingsExcluded:        $('settings-excluded'),
  settingsBgImage:         $('settings-bg-image'),
  settingsBgColorEnabled:  $('settings-bg-color-enabled'),
  settingsBgColor:         $('settings-bg-color'),
  settingsTextColorEnabled:$('settings-text-color-enabled'),
  settingsTextColor:       $('settings-text-color'),
  settingsSave:            $('settings-save'),
  settingsCancel:          $('settings-cancel'),
  exportDropdown:  $('export-dropdown'),
  exportCsv:       $('export-csv'),
  exportJson:      $('export-json'),
  statusFilter:    $('status-filter'),
  folderList:      $('folder-list'),
  formatList:      $('format-list'),
  statsText:       $('stats-text'),
  gridView:        $('grid-view'),
  listView:        $('list-view'),
  emptyState:      $('empty-state'),
  // Modal
  modalBackdrop:   $('modal-backdrop'),
  modalCover:      $('modal-cover'),
  modalCoverPlaceholder: $('modal-cover-placeholder'),
  modalTitle:      $('modal-title'),
  modalAuthor:     $('modal-author'),
  modalFormat:     $('modal-format'),
  modalYear:       $('modal-year'),
  modalLang:       $('modal-lang'),
  modalTags:       $('modal-tags'),
  modalSeries:     $('modal-series'),
  modalPublisher:  $('modal-publisher'),
  modalSize:       $('modal-size'),
  modalStars:      $('modal-stars'),
  modalStatusSelector: $('modal-status-selector'),
  modalNotes:      $('modal-notes'),
  modalDesc:       $('modal-desc'),
  modalTitleInput: $('modal-title-input'),
  modalTitleEdit:  $('modal-title-edit'),
  modalAuthorInput:$('modal-author-input'),
  modalAuthorEdit: $('modal-author-edit'),
  modalClose:      $('modal-close'),
  modalRead:       $('modal-read'),
  modalOpen:       $('modal-open'),
  modalShowFolder: $('modal-show-folder'),
  modalRescan:     $('modal-rescan'),
  modalDelete:     $('modal-delete'),
  toastContainer:  $('toast-container'),
  // Reader
  readerOverlay:   $('reader-overlay'),
  readerClose:     $('reader-close'),
  readerTitle:     $('reader-title'),
  readerFrame:     $('reader-frame'),
  readerFormatBadge: $('reader-format-badge'),
};

// ── Init ──────────────────────────────────────────────────────────────
async function init() {
  bindEvents();
  setupIPCListeners();

  try {
    const settings = await api.getSettings();
    applyBackgroundImage(settings.backgroundImageUrl || '');
    applyBackgroundColor(settings.backgroundColor || '');
    applyCardTextColor(settings.cardTextColor || '');
    const hasPath = !!settings.libraryPath;

    if (hasPath) {
      const stats = await api.getStats();
      if (stats && stats.total > 0) {
        showApp();
        await loadBooks();
      } else {
        showWelcome(settings.libraryPath);
      }
    } else {
      showWelcome(null);
    }
  } catch (e) {
    console.error('Init error:', e);
    showWelcome(null);
  }
}

function showWelcome(libraryPath) {
  els.welcome.classList.remove('hidden');
  els.app.classList.add('hidden');
  if (libraryPath) {
    els.welcomeNoPath.classList.add('hidden');
    els.welcomeHasPath.classList.remove('hidden');
    els.welcomePathDisplay.textContent = libraryPath;
  } else {
    els.welcomeNoPath.classList.remove('hidden');
    els.welcomeHasPath.classList.add('hidden');
  }
}

function showApp() {
  els.welcome.classList.add('hidden');
  els.app.classList.remove('hidden');
}

// ── Load books ────────────────────────────────────────────────────────
async function loadBooks() {
  try {
    const books = await api.getBooks({ sort: state.sort, dir: state.dir });
    state.books = books;
    applyFilter();
    renderSidebar();
  } catch (e) {
    console.error('loadBooks error:', e);
    showToast('Failed to load books', 'error');
  }
}

function applyFilter() {
  let result = state.books;

  if (state.folder !== 'all') {
    result = result.filter(b => b.folder === state.folder);
  }
  if (state.format !== 'all') {
    result = result.filter(b => b.format === state.format);
  }
  if (state.status !== 'all') {
    result = result.filter(b => (b.status || 'unread') === state.status);
  }
  if (state.query) {
    const q = state.query.toLowerCase();
    result = result.filter(b =>
      (b.title || '').toLowerCase().includes(q) ||
      (b.author || '').toLowerCase().includes(q) ||
      (b.series || '').toLowerCase().includes(q)
    );
  }

  state.filtered = result;
  renderContent();
  updateStats();
}

// ── Render sidebar ────────────────────────────────────────────────────
function renderSidebar() {
  // Folders
  const folderCounts = {};
  for (const b of state.books) {
    const f = b.folder || 'Unknown';
    folderCounts[f] = (folderCounts[f] || 0) + 1;
  }
  const folders = Object.entries(folderCounts).sort((a, b) => b[1] - a[1]);

  els.folderList.innerHTML = `
    <li class="${state.folder === 'all' ? 'active' : ''}" data-folder="all">
      <span class="sidebar-label">All Books</span>
      <span class="sidebar-count">${state.books.length}</span>
    </li>
    ${folders.map(([name, count]) => `
      <li class="${state.folder === name ? 'active' : ''}" data-folder="${escHtml(name)}">
        <span class="sidebar-label">${escHtml(name)}</span>
        <span class="sidebar-count">${count}</span>
      </li>
    `).join('')}
  `;

  // Formats
  const formatCounts = {};
  for (const b of state.books) {
    const f = b.format || 'other';
    formatCounts[f] = (formatCounts[f] || 0) + 1;
  }
  const formats = Object.entries(formatCounts).sort((a, b) => b[1] - a[1]);

  els.formatList.innerHTML = `
    <li class="${state.format === 'all' ? 'active' : ''}" data-format="all">
      <span class="sidebar-label">All Formats</span>
      <span class="sidebar-count">${state.books.length}</span>
    </li>
    ${formats.map(([name, count]) => `
      <li class="${state.format === name ? 'active' : ''}" data-format="${escHtml(name)}">
        <span class="sidebar-dot ${name}"></span>
        <span class="sidebar-label">${name.toUpperCase()}</span>
        <span class="sidebar-count">${count}</span>
      </li>
    `).join('')}
  `;

  els.folderList.querySelectorAll('li').forEach(li => {
    li.addEventListener('click', () => {
      state.folder = li.dataset.folder;
      applyFilter();
      renderSidebar();
    });
  });
  els.formatList.querySelectorAll('li').forEach(li => {
    li.addEventListener('click', () => {
      state.format = li.dataset.format;
      applyFilter();
      renderSidebar();
    });
  });
}

// ── Render content ────────────────────────────────────────────────────
function renderContent() {
  const books = state.filtered;
  const isEmpty = books.length === 0;

  els.emptyState.classList.toggle('hidden', !isEmpty);
  els.gridView.classList.toggle('hidden', state.view !== 'grid' || isEmpty);
  els.listView.classList.toggle('hidden', state.view !== 'list' || isEmpty);

  if (isEmpty) return;

  if (state.view === 'grid') renderGrid(books);
  else renderList(books);
}

function renderGrid(books) {
  const frag = document.createDocumentFragment();
  for (const book of books) {
    frag.appendChild(buildCard(book));
  }
  els.gridView.innerHTML = '';
  els.gridView.appendChild(frag);
}

function buildCard(book) {
  const card = document.createElement('div');
  card.className = 'book-card';
  card.dataset.id = book.id;

  const titleInitial = (book.title || '?')[0].toUpperCase();
  const hascover = book.cover_data && book.cover_mime;
  const bookStatus = book.status || 'unread';

  card.innerHTML = `
    <div class="book-cover-wrap">
      ${hascover
        ? `<img class="book-cover" src="data:${book.cover_mime};base64,${book.cover_data}" alt="" loading="lazy">`
        : `<div class="book-cover-placeholder">${escHtml(titleInitial)}</div>`
      }
      <span class="format-badge ${book.format} card-format-badge">${(book.format || '').toUpperCase()}</span>
      ${bookStatus === 'reading' ? '<span class="status-badge status-reading">📖</span>' : ''}
      ${bookStatus === 'read'    ? '<span class="status-badge status-read">✓ Read</span>' : ''}
    </div>
    <div class="book-card-info">
      <div class="card-title">${escHtml(book.title || 'Untitled')}</div>
      <div class="card-author">${escHtml(book.author || 'Unknown Author')}</div>
      <div class="card-meta">
        ${book.year ? `<span class="card-year">${book.year}</span>` : ''}
        <div class="card-stars">${renderMiniStars(book.rating || 0)}</div>
      </div>
    </div>
  `;

  card.addEventListener('click', () => openModal(book));
  return card;
}

function renderMiniStars(rating) {
  return [1, 2, 3, 4, 5].map(i =>
    `<span class="card-star ${i <= rating ? 'filled' : ''}">★</span>`
  ).join('');
}

function renderList(books) {
  els.listView.innerHTML = `
    <table>
      <thead>
        <tr>
          <th style="width:40px"></th>
          <th data-sort="title" class="${state.sort === 'title' ? 'sorted' : ''}">Title</th>
          <th data-sort="author_sort" class="${state.sort === 'author_sort' ? 'sorted' : ''}">Author</th>
          <th data-sort="year" class="${state.sort === 'year' ? 'sorted' : ''}">Year</th>
          <th>Format</th>
          <th>Status</th>
          <th>Folder</th>
          <th data-sort="file_size" class="${state.sort === 'file_size' ? 'sorted' : ''}">Size</th>
          <th data-sort="rating" class="${state.sort === 'rating' ? 'sorted' : ''}">Rating</th>
        </tr>
      </thead>
      <tbody>
        ${books.map(b => {
          const bStatus = b.status || 'unread';
          const statusHtml = bStatus === 'reading'
            ? '<span class="status-badge status-reading" style="position:static;display:inline-block">📖</span>'
            : bStatus === 'read'
            ? '<span class="status-badge status-read" style="position:static;display:inline-block">✓</span>'
            : '—';
          return `
          <tr data-id="${b.id}">
            <td>
              ${b.cover_data && b.cover_mime
                ? `<img class="cover-thumb" src="data:${b.cover_mime};base64,${b.cover_data}" alt="" loading="lazy">`
                : `<div class="cover-thumb" style="background:var(--accent-soft);display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--accent);font-size:16px">${escHtml((b.title||'?')[0].toUpperCase())}</div>`
              }
            </td>
            <td title="${escHtml(b.title || '')}">${escHtml(b.title || 'Untitled')}</td>
            <td title="${escHtml(b.author || '')}">${escHtml(b.author || '—')}</td>
            <td>${b.year || '—'}</td>
            <td><span class="format-badge ${b.format}">${(b.format || '').toUpperCase()}</span></td>
            <td>${statusHtml}</td>
            <td>${escHtml(b.folder || '—')}</td>
            <td>${formatSize(b.file_size)}</td>
            <td>${renderMiniStars(b.rating || 0)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;

  els.listView.querySelectorAll('tr[data-id]').forEach(row => {
    row.addEventListener('click', () => {
      const book = books.find(b => b.id == row.dataset.id);
      if (book) openModal(book);
    });
  });

  els.listView.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (state.sort === col) {
        state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort = col;
        state.dir = 'asc';
      }
      els.sortSelect.value = state.sort;
      els.sortDir.textContent = state.dir === 'asc' ? '↑' : '↓';
      reloadSorted();
    });
  });
}

// ── Modal ─────────────────────────────────────────────────────────────
let notesDebounceTimer = null;

function openModal(book) {
  state.currentBook = book;
  const hascover = book.cover_data && book.cover_mime;

  els.modalTitle.textContent = book.title || 'Untitled';
  els.modalAuthor.textContent = book.author || 'Unknown Author';

  els.modalFormat.className = `format-badge ${book.format}`;
  els.modalFormat.textContent = (book.format || '').toUpperCase();

  els.modalYear.textContent = book.year || '';
  els.modalLang.textContent = book.language ? `· ${book.language.toUpperCase()}` : '';

  els.modalTags.innerHTML = book.folder
    ? `<span class="tag">${escHtml(book.folder)}</span>`
    : '';

  if (book.series) {
    els.modalSeries.innerHTML = `<strong>Series:</strong> ${escHtml(book.series)}${book.series_index != null ? ` #${book.series_index}` : ''}`;
    els.modalSeries.style.display = '';
  } else {
    els.modalSeries.style.display = 'none';
  }

  if (book.publisher) {
    els.modalPublisher.innerHTML = `<strong>Publisher:</strong> ${escHtml(book.publisher)}`;
    els.modalPublisher.style.display = '';
  } else {
    els.modalPublisher.style.display = 'none';
  }

  els.modalSize.innerHTML = `<strong>Size:</strong> ${formatSize(book.file_size)}`;

  if (hascover) {
    els.modalCover.src = `data:${book.cover_mime};base64,${book.cover_data}`;
    els.modalCover.classList.remove('hidden');
    els.modalCoverPlaceholder.classList.add('hidden');
  } else {
    els.modalCover.src = '';
    els.modalCover.classList.add('hidden');
    els.modalCoverPlaceholder.textContent = (book.title || '?')[0].toUpperCase();
    els.modalCoverPlaceholder.classList.remove('hidden');
  }

  els.modalDesc.innerHTML = book.description || '';

  // Stars (interactive)
  renderStars(book.rating || 0);

  // Status selector
  const currentStatus = book.status || 'unread';
  els.modalStatusSelector.querySelectorAll('.status-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.status === currentStatus);
    btn.onclick = async () => {
      const newStatus = btn.dataset.status;
      await api.setStatus(book.id, newStatus);
      state.currentBook.status = newStatus;
      const idx = state.books.findIndex(b => b.id === book.id);
      if (idx !== -1) state.books[idx].status = newStatus;
      els.modalStatusSelector.querySelectorAll('.status-opt').forEach(b2 => {
        b2.classList.toggle('active', b2.dataset.status === newStatus);
      });
      applyFilter(); // refresh card badge
    };
  });

  // Notes — populate and wire autosave
  els.modalNotes.value = book.notes || '';
  // Remove old listener by replacing element clone trick isn't needed — we use the timer
  if (notesDebounceTimer) clearTimeout(notesDebounceTimer);
  els.modalNotes.oninput = () => {
    if (notesDebounceTimer) clearTimeout(notesDebounceTimer);
    notesDebounceTimer = setTimeout(async () => {
      const val = els.modalNotes.value;
      await api.setNotes(book.id, val);
      state.currentBook.notes = val;
      const idx = state.books.findIndex(b => b.id === book.id);
      if (idx !== -1) state.books[idx].notes = val;
    }, 500);
  };

  // "Read in App" button — only for EPUB; all others open externally via this button
  const canReadInApp = ['epub', 'epub3'].includes(book.format);
  els.modalRead.textContent = canReadInApp ? 'Read in App' : 'Open File';
  els.modalRead.onclick = () => {
    if (canReadInApp) {
      openReader(book);
    } else {
      api.openFile(book.file_path);
    }
  };

  // "Open File" button — redundant for non-EPUBs since modalRead already opens the file,
  // so hide it for those formats to avoid duplicate buttons
  els.modalOpen.style.display = canReadInApp ? '' : 'none';
  els.modalOpen.onclick = () => api.openFile(book.file_path);
  els.modalShowFolder.onclick = () => api.showInFolder(book.file_path);
  els.modalRescan.onclick = async () => {
    showToast('Rescanning…');
    const updated = await api.rescanFile(book.file_path);
    if (updated) {
      const idx = state.books.findIndex(b => b.id === updated.id);
      if (idx !== -1) state.books[idx] = updated;
      openModal(updated);
      showToast('Rescan complete', 'success');
    }
  };

  els.modalDelete.onclick = async () => {
    const name = book.title || book.file_name;
    if (!confirm(`Permanently delete "${name}" from disk?\n\nThis cannot be undone.`)) return;
    const result = await api.deleteFile(book.file_path);
    if (result && result.success) {
      const idx = state.books.findIndex(b => b.id === book.id);
      if (idx !== -1) state.books.splice(idx, 1);
      closeModal();
      applyFilter();
      renderSidebar();
      showToast(`Deleted: ${name}`);
    } else {
      showToast(`Could not delete file: ${result?.error || 'unknown error'}`, 'error');
    }
  };

  els.modalBackdrop.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  els.modalBackdrop.classList.add('hidden');
  document.body.style.overflow = '';
  state.currentBook = null;
}

function renderStars(currentRating) {
  els.modalStars.innerHTML = [1, 2, 3, 4, 5].map(i =>
    `<span class="star ${i <= currentRating ? 'filled' : ''}" data-val="${i}">★</span>`
  ).join('');

  els.modalStars.querySelectorAll('.star').forEach(star => {
    star.addEventListener('mouseenter', () => {
      const val = parseInt(star.dataset.val);
      els.modalStars.querySelectorAll('.star').forEach((s, idx) => {
        s.classList.toggle('filled', idx < val);
      });
    });
    star.addEventListener('mouseleave', () => {
      const rating = state.currentBook ? (state.currentBook.rating || 0) : 0;
      renderStars(rating);
    });
    star.addEventListener('click', async () => {
      const val = parseInt(star.dataset.val);
      await api.setRating(state.currentBook.id, val);
      state.currentBook.rating = val;
      const idx = state.books.findIndex(b => b.id === state.currentBook.id);
      if (idx !== -1) state.books[idx].rating = val;
      renderStars(val);
      applyFilter();
    });
  });
}

// ── In-app reader ─────────────────────────────────────────────────────
async function openReader(book) {
  closeModal();

  els.readerTitle.textContent = book.title || book.file_name;
  els.readerFormatBadge.className = `format-badge ${book.format}`;
  els.readerFormatBadge.textContent = (book.format || '').toUpperCase();
  els.readerFrame.srcdoc = '';
  els.readerFrame.src = 'about:blank';
  els.readerOverlay.classList.remove('hidden');

  if (book.format === 'epub' || book.format === 'epub3') {
    showToast('Loading book…');
    const result = await api.getEpubContent(book.file_path);
    if (result && result.success) {
      els.readerFrame.srcdoc = result.html;
    } else {
      showToast(`Could not load EPUB: ${result?.error || 'unknown error'}`, 'error');
      els.readerOverlay.classList.add('hidden');
    }
  } else {
    // All other formats (PDF, MOBI, DOCX…) open in external app
    api.openFile(book.file_path);
    els.readerOverlay.classList.add('hidden');
  }
}

function closeReader() {
  els.readerOverlay.classList.add('hidden');
  // Clear frame to stop rendering/network activity
  try { els.readerFrame.srcdoc = ''; } catch {}
  try { els.readerFrame.src = 'about:blank'; } catch {}
}

// ── Stats ─────────────────────────────────────────────────────────────
function updateStats() {
  const total = state.filtered.length;
  const allTotal = state.books.length;
  if (total === allTotal) {
    els.statsText.textContent = `${total.toLocaleString()} books`;
  } else {
    els.statsText.textContent = `${total.toLocaleString()} of ${allTotal.toLocaleString()} books`;
  }
}

// ── Settings modal ────────────────────────────────────────────────────
let _settingsCurrentPath = null;

function applyBackgroundImage(url) {
  const grid = els.gridView;
  if (url) {
    grid.style.backgroundImage = `url('${url}')`;
    grid.classList.add('has-bg-image');
  } else {
    grid.style.backgroundImage = '';
    grid.classList.remove('has-bg-image');
  }
}

function applyBackgroundColor(color) {
  const grid = els.gridView;
  grid.style.backgroundColor = color || '';
}

function applyCardTextColor(color) {
  const grid = els.gridView;
  if (color) {
    grid.style.setProperty('--custom-text-color', color);
    grid.classList.add('has-custom-text');
  } else {
    grid.style.removeProperty('--custom-text-color');
    grid.classList.remove('has-custom-text');
  }
}

async function openSettings() {
  const settings = await api.getSettings();
  _settingsCurrentPath = settings.libraryPath || null;
  els.settingsPathDisplay.textContent = _settingsCurrentPath || 'Not set';
  els.settingsExcluded.value = (settings.excludedFolders || []).join('\n');
  els.settingsBgImage.value = settings.backgroundImageUrl || '';

  const bgColor = settings.backgroundColor || '';
  els.settingsBgColorEnabled.checked = !!bgColor;
  els.settingsBgColor.value = bgColor || '#e8e8e8';
  els.settingsBgColor.disabled = !bgColor;

  const textColor = settings.cardTextColor || '';
  els.settingsTextColorEnabled.checked = !!textColor;
  els.settingsTextColor.value = textColor || '#1a1a1a';
  els.settingsTextColor.disabled = !textColor;

  els.settingsBackdrop.classList.remove('hidden');
}

function closeSettings() {
  els.settingsBackdrop.classList.add('hidden');
  _settingsCurrentPath = null;
}

// ── Events ────────────────────────────────────────────────────────────
function bindEvents() {
  // Welcome — choose folder (first run, no path set)
  els.btnChooseFolder.addEventListener('click', async () => {
    const chosen = await api.pickFolder();
    if (!chosen) return;
    await api.setLibraryPath(chosen);
    showWelcome(chosen);
  });

  // Welcome — change folder button
  els.btnChangeFolderWelcome.addEventListener('click', async () => {
    const chosen = await api.pickFolder();
    if (!chosen) return;
    await api.setLibraryPath(chosen);
    showWelcome(chosen);
  });

  // Welcome scan
  els.btnStartScan.addEventListener('click', startScan);

  // Search
  let searchTimer;
  els.searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = els.searchInput.value.trim();
    els.searchClear.classList.toggle('hidden', !q);
    searchTimer = setTimeout(() => {
      state.query = q;
      applyFilter();
    }, 250);
  });
  els.searchClear.addEventListener('click', () => {
    els.searchInput.value = '';
    els.searchClear.classList.add('hidden');
    state.query = '';
    applyFilter();
  });

  // Status filter pills
  els.statusFilter.querySelectorAll('.status-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      state.status = pill.dataset.status;
      els.statusFilter.querySelectorAll('.status-pill').forEach(p => {
        p.classList.toggle('active', p.dataset.status === state.status);
      });
      applyFilter();
    });
  });

  // View toggle
  els.btnGrid.addEventListener('click', () => {
    state.view = 'grid';
    els.btnGrid.classList.add('active');
    els.btnList.classList.remove('active');
    renderContent();
  });
  els.btnList.addEventListener('click', () => {
    state.view = 'list';
    els.btnList.classList.add('active');
    els.btnGrid.classList.remove('active');
    renderContent();
  });

  // Sort
  els.sortSelect.addEventListener('change', () => {
    state.sort = els.sortSelect.value;
    reloadSorted();
  });
  els.sortDir.addEventListener('click', () => {
    state.dir = state.dir === 'asc' ? 'desc' : 'asc';
    els.sortDir.textContent = state.dir === 'asc' ? '↑' : '↓';
    reloadSorted();
  });

  // Rescan
  els.btnRescan.addEventListener('click', startScan);

  // Export dropdown
  els.btnExport.addEventListener('click', (e) => {
    e.stopPropagation();
    els.exportDropdown.classList.toggle('hidden');
  });
  document.addEventListener('click', () => els.exportDropdown.classList.add('hidden'));

  els.exportCsv.addEventListener('click', async () => {
    const result = await api.exportCsv();
    if (result.success) showToast(`Saved: ${result.path}`, 'success');
  });
  els.exportJson.addEventListener('click', async () => {
    const result = await api.exportJson();
    if (result.success) showToast(`Saved: ${result.path}`, 'success');
  });

  // Settings button
  els.btnSettings.addEventListener('click', (e) => {
    e.stopPropagation();
    openSettings();
  });

  // Settings color toggle checkboxes
  els.settingsBgColorEnabled.addEventListener('change', () => {
    els.settingsBgColor.disabled = !els.settingsBgColorEnabled.checked;
  });
  els.settingsTextColorEnabled.addEventListener('change', () => {
    els.settingsTextColor.disabled = !els.settingsTextColorEnabled.checked;
  });

  // Settings modal — change folder
  els.settingsChangeFolder.addEventListener('click', async () => {
    const chosen = await api.pickFolder();
    if (!chosen) return;
    _settingsCurrentPath = chosen;
    els.settingsPathDisplay.textContent = chosen;
  });

  // Settings modal — save
  els.settingsSave.addEventListener('click', async () => {
    const excluded = els.settingsExcluded.value
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);

    const pathChanged = _settingsCurrentPath !== (await api.getSettings()).libraryPath;
    if (_settingsCurrentPath) {
      await api.setLibraryPath(_settingsCurrentPath);
    }
    await api.setExcludedFolders(excluded);
    const bgUrl = els.settingsBgImage.value.trim();
    await api.setBackgroundImageUrl(bgUrl);
    applyBackgroundImage(bgUrl);

    const bgColor = els.settingsBgColorEnabled.checked ? els.settingsBgColor.value : '';
    await api.setBackgroundColor(bgColor);
    applyBackgroundColor(bgColor);

    const textColor = els.settingsTextColorEnabled.checked ? els.settingsTextColor.value : '';
    await api.setCardTextColor(textColor);
    applyCardTextColor(textColor);

    closeSettings();

    if (pathChanged && _settingsCurrentPath) {
      showToast('Library folder updated. Rescan to apply changes.', 'success');
    } else {
      showToast('Settings saved', 'success');
    }
  });

  // Settings modal — cancel / close
  els.settingsClose.addEventListener('click', closeSettings);
  els.settingsCancel.addEventListener('click', closeSettings);
  els.settingsBackdrop.addEventListener('click', (e) => {
    if (e.target === els.settingsBackdrop) closeSettings();
  });

  // Modal close
  els.modalClose.addEventListener('click', closeModal);
  els.modalBackdrop.addEventListener('click', (e) => {
    if (e.target === els.modalBackdrop) closeModal();
  });

  // Reader close
  els.readerClose.addEventListener('click', closeReader);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!els.readerOverlay.classList.contains('hidden')) {
        closeReader();
      } else if (!els.settingsBackdrop.classList.contains('hidden')) {
        closeSettings();
      } else {
        closeModal();
      }
    }
  });

  // ── Inline metadata editing ────────────────────────────────────────
  function makeFieldEditable({ editBtn, displayEl, inputEl, field }) {
    let editing = false;

    function startEdit() {
      if (editing || !state.currentBook) return;
      editing = true;
      inputEl.value = state.currentBook[field] || '';
      displayEl.classList.add('hidden');
      inputEl.classList.remove('hidden');
      editBtn.classList.add('active');
      inputEl.focus();
      inputEl.select();
    }

    async function commitEdit() {
      if (!editing || !state.currentBook) return;
      editing = false;
      const newVal = inputEl.value.trim() || null;
      displayEl.classList.remove('hidden');
      inputEl.classList.add('hidden');
      editBtn.classList.remove('active');

      if (newVal === (state.currentBook[field] || null)) return; // no change

      const updated = await api.setMetadata(state.currentBook.id, { [field]: newVal });
      if (updated) {
        state.currentBook = updated;
        displayEl.textContent = newVal || (field === 'title' ? state.currentBook.file_name : '');
        // Refresh the grid card if visible
        const card = document.querySelector(`[data-id="${updated.id}"]`);
        if (card) {
          const titleEl = card.querySelector('.card-title');
          const authorEl = card.querySelector('.card-author');
          if (titleEl && field === 'title') titleEl.textContent = newVal || updated.file_name;
          if (authorEl && field === 'author') authorEl.textContent = newVal || '';
        }
        // Also update in state.books array
        const idx = state.books.findIndex(b => b.id === updated.id);
        if (idx !== -1) state.books[idx] = updated;
        showToast('Saved', 'success');
      }
    }

    function cancelEdit() {
      if (!editing) return;
      editing = false;
      displayEl.classList.remove('hidden');
      inputEl.classList.add('hidden');
      editBtn.classList.remove('active');
    }

    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      editing ? commitEdit() : startEdit();
    });
    displayEl.addEventListener('dblclick', startEdit);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
      if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
    });
    inputEl.addEventListener('blur', commitEdit);
  }

  makeFieldEditable({
    editBtn:   els.modalTitleEdit,
    displayEl: els.modalTitle,
    inputEl:   els.modalTitleInput,
    field:     'title',
  });
  makeFieldEditable({
    editBtn:   els.modalAuthorEdit,
    displayEl: els.modalAuthor,
    inputEl:   els.modalAuthorInput,
    field:     'author',
  });

  // ── Sidebar resize ─────────────────────────────────────────────────
  const sidebarResizer = $('sidebar-resizer');
  const sidebar = $('sidebar');
  const SIDEBAR_MIN = 140;
  const SIDEBAR_MAX = 400;
  const SIDEBAR_STORAGE_KEY = 'sidebar-width';

  // Restore saved width
  const savedWidth = parseInt(localStorage.getItem(SIDEBAR_STORAGE_KEY) || '0', 10);
  if (savedWidth >= SIDEBAR_MIN && savedWidth <= SIDEBAR_MAX) {
    sidebar.style.width = savedWidth + 'px';
  }

  let resizing = false;
  let resizeStartX = 0;
  let resizeStartWidth = 0;

  sidebarResizer.addEventListener('mousedown', (e) => {
    resizing = true;
    resizeStartX = e.clientX;
    resizeStartWidth = sidebar.getBoundingClientRect().width;
    sidebarResizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!resizing) return;
    const delta = e.clientX - resizeStartX;
    const newWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, resizeStartWidth + delta));
    sidebar.style.width = newWidth + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!resizing) return;
    resizing = false;
    sidebarResizer.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    // Persist width
    localStorage.setItem(SIDEBAR_STORAGE_KEY, parseInt(sidebar.style.width, 10));
  });
}

// ── IPC listeners ─────────────────────────────────────────────────────
function setupIPCListeners() {
  api.onScanProgress(({ current, total }) => {
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    els.progressBar.style.width = `${pct}%`;
    els.progressText.textContent = `${current.toLocaleString()} / ${total.toLocaleString()} files`;
    els.scanStatus.textContent = `Processing files…`;
  });

  api.onScanDone(async (scanStats) => {
    els.scanOverlay.classList.add('hidden');
    showApp();
    // Reset folder/format filters so newly added books are always visible
    state.folder = 'all';
    state.format = 'all';
    await loadBooks();
    showToast(`Scan complete: ${scanStats.added || 0} new / updated books`, 'success');
  });

  api.onBookAdded((book) => {
    const idx = state.books.findIndex(b => b.id === book.id);
    if (idx !== -1) {
      state.books[idx] = book;
    } else {
      state.books.unshift(book);
      showToast(`Added: ${book.title || book.file_name}`);
    }
    applyFilter();
    renderSidebar();
  });

  api.onBookRemoved((id) => {
    const idx = state.books.findIndex(b => b.id === id);
    if (idx !== -1) {
      const removed = state.books[idx];
      state.books.splice(idx, 1);
      applyFilter();
      renderSidebar();
      showToast(`Removed: ${removed.title || removed.file_name}`);
    }
  });
}

// ── Scan ──────────────────────────────────────────────────────────────
async function startScan() {
  els.scanOverlay.classList.remove('hidden');
  els.progressBar.style.width = '0%';
  els.progressText.textContent = 'Starting…';
  const settings = await api.getSettings();
  els.scanStatus.textContent = `Scanning ${settings.libraryPath || 'library'}…`;
  api.scanAll(); // fire and forget - progress comes via IPC
}

// ── Helpers ───────────────────────────────────────────────────────────
async function reloadSorted() {
  const books = await api.getBooks({ sort: state.sort, dir: state.dir });
  state.books = books;
  applyFilter();
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function showToast(msg, type = '') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  els.toastContainer.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ── Boot ──────────────────────────────────────────────────────────────
init().catch(console.error);
