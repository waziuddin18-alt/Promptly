/* Promptly — main app logic
   Now with full user-managed content: add / edit / delete prompts,
   custom categories, localStorage persistence, image upload (with automatic
   image compression so localStorage doesn't fill up). */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ---------- Storage keys ----------
  const K_PROMPTS = 'promptly:prompts:v2';
  const K_CATS    = 'promptly:cats:v2';
  const K_THEME   = 'promptly:theme';

  // ---------- Load state ----------
  const state = {
    category: 'all',
    query: '',
    currentId: null,
    theme: localStorage.getItem(K_THEME) || 'light',
    prompts: loadPrompts(),
    cats:    loadCats(),
    editing: null,   // prompt being edited, or null
  };

  function loadPrompts() {
    try {
      const raw = localStorage.getItem(K_PROMPTS);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    // Fresh install: always start empty. Ignore any legacy PROMPTS on window.
    return [];
  }
  function loadCats() {
    let cats = null;
    try {
      const raw = localStorage.getItem(K_CATS);
      if (raw) cats = JSON.parse(raw);
    } catch (e) {}
    if (!cats) cats = (window.CATEGORIES || []).slice();

    // One-time migration: strip premade categories that the user never used.
    // Keeps 'all' + any category that has at least one prompt attached + any
    // custom (non-premade) category the user added.
    const legacy = new Set(window.PROMPTLY_LEGACY_PREMADES || []);
    let usedIds = new Set();
    try {
      const rawP = localStorage.getItem(K_PROMPTS);
      if (rawP) usedIds = new Set(JSON.parse(rawP).map(p => p.category));
    } catch (e) {}
    const before = cats.length;
    cats = cats.filter(c => c.id === 'all' || !legacy.has(c.id) || usedIds.has(c.id));
    if (cats.length !== before) {
      // Persist the cleaned list immediately so the migration is idempotent.
      try { localStorage.setItem(K_CATS, JSON.stringify(cats)); } catch (e) {}
    }
    return cats;
  }
  function savePrompts() { localStorage.setItem(K_PROMPTS, JSON.stringify(state.prompts)); }
  function saveCats()    { localStorage.setItem(K_CATS,    JSON.stringify(state.cats)); }

  // ---------- Elements ----------
  const els = {
    cats:         $('#cats'),
    masonry:      $('#masonry'),
    search:       $('#search-input'),
    scrim:        $('#scrim'),

    sheet:        $('#sheet'),
    sheetClose:   $('#sheet-close'),
    sheetImg:     $('#sheet-img'),
    sheetCat:     $('#sheet-cat'),
    sheetTitle:   $('#sheet-title'),
    sheetScroll:  $('#sheet-scroll'),
    sheetEdit:    $('#sheet-edit'),
    sheetDelete:  $('#sheet-delete'),
    copyCta:      $('#copy-cta'),
    promptText:   $('#prompt-text'),
    similarRail:  $('#similar-rail'),
    similarWrap:  $('#similar-wrap'),

    profile:      $('#profile'),
    profileBtn:   $('#profile-btn'),
    profileClose: $('#profile-close'),
    profileGrid:  $('#profile-grid'),
    profileCount: $('#profile-count'),
    profileCats:  $('#profile-cats'),

    themeToggle:  $('#theme-toggle'),
    addBtn:       $('#add-btn'),
    addBtnMobile: $('#add-btn-mobile'),

    editor:       $('#editor'),
    editorClose:  $('#editor-close'),
    editorTitle:  $('#editor-title-h'),
    editorForm:   $('#editor-form'),
    fTitle:       $('#f-title'),
    fPrompt:      $('#f-prompt'),
    fCat:         $('#f-cat'),
    fCatNew:      $('#f-cat-new'),
    fDrop:        $('#f-drop'),
    fFile:        $('#f-file'),
    fPreview:     $('#f-preview'),
    fPreviewImg:  $('#f-preview-img'),
    fPreviewClear:$('#f-preview-clear'),
    fSave:        $('#f-save'),
    fDelete:      $('#f-delete'),

    toast:        $('#toast'),
    toastText:    $('#toast-text'),
  };

  // ---------- Theme ----------
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    state.theme = t;
    localStorage.setItem(K_THEME, t);
  }
  applyTheme(state.theme);
  els.themeToggle.addEventListener('click', () => applyTheme(state.theme === 'dark' ? 'light' : 'dark'));

  // ---------- Categories ----------
  function renderCats() {
    els.cats.innerHTML = state.cats.map(c => `
      <button class="cat-pill" data-cat="${escapeAttr(c.id)}" data-active="${state.category === c.id}">
        <span class="emoji">${c.emoji || '•'}</span>
        <span>${escapeHtml(c.name)}</span>
        <span class="cat-count">${countInCat(c.id)}</span>
      </button>
    `).join('');
    $$('.cat-pill', els.cats).forEach(btn => {
      btn.addEventListener('click', () => {
        state.category = btn.dataset.cat;
        renderCats();
        renderMasonry();
      });
    });
  }
  function countInCat(id) {
    if (id === 'all') return state.prompts.length;
    return state.prompts.filter(p => p.category === id).length;
  }

  // ---------- Masonry ----------
  function filtered() {
    return state.prompts.filter(p => {
      const catOk = state.category === 'all' || p.category === state.category;
      if (!catOk) return false;
      if (!state.query) return true;
      const q = state.query.toLowerCase();
      return (
        (p.title || '').toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q) ||
        (p.prompt || '').toLowerCase().includes(q)
      );
    });
  }

  function cardHTML(p, i) {
    const ar = p.aspect || 1;
    return `
      <article class="card" data-id="${p.id}" style="--ar: ${ar}; animation-delay: ${Math.min(i * 40, 480)}ms;" tabindex="0" role="button" aria-label="Open prompt: ${escapeAttr(p.title)}">
        <div class="thumb">
          <img loading="lazy" src="${p.img}" alt="${escapeAttr(p.title)}" />
        </div>
        <span class="card-cat">${escapeHtml(p.category)}</span>
        <div class="card-overlay">
          <div class="card-title">${escapeHtml(p.title)}</div>
          <button class="card-copy-mini" data-mini-copy="${p.id}" aria-label="Copy prompt">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            Copy
          </button>
        </div>
      </article>
    `;
  }

  function renderMasonry() {
    const list = filtered();

    if (state.prompts.length === 0) {
      els.masonry.innerHTML = `
        <div class="empty-state grand" style="column-span: all;">
          <div class="empty-illo">
            <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="3"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <path d="m21 15-5-5L5 21"></path>
            </svg>
          </div>
          <h2 class="serif">Your gallery is empty</h2>
          <p>Add your first prompt — upload an image, paste your prompt, pick a category. It's yours.</p>
          <button class="btn-primary" id="empty-add-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"></path></svg>
            Add your first prompt
          </button>
        </div>
      `;
      $('#empty-add-btn').addEventListener('click', () => openEditor());
      return;
    }

    if (list.length === 0) {
      els.masonry.innerHTML = `
        <div class="empty-state" style="column-span: all;">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>
          <div>No prompts ${state.query ? `matching "${escapeHtml(state.query)}"` : 'in this category yet'}</div>
        </div>
      `;
      return;
    }

    els.masonry.innerHTML = list.map(cardHTML).join('');
    $$('.card', els.masonry).forEach(card => {
      card.addEventListener('click', (e) => {
        const mini = e.target.closest('[data-mini-copy]');
        if (mini) {
          e.stopPropagation();
          const p = state.prompts.find(x => x.id === mini.dataset.miniCopy);
          if (p) copyPrompt(p.prompt, `Copied "${(p.title || '').slice(0, 24)}${(p.title || '').length > 24 ? '…' : ''}"`);
          return;
        }
        openSheet(card.dataset.id);
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSheet(card.dataset.id); }
      });
    });
  }

  // ---------- Sheet ----------
  function openSheet(id) {
    const p = state.prompts.find(x => x.id === id);
    if (!p) return;
    state.currentId = id;
    els.sheetImg.src = p.img;
    els.sheetImg.alt = p.title || '';
    els.sheetCat.textContent = p.category;
    els.sheetTitle.textContent = p.title || 'Untitled';
    els.promptText.textContent = p.prompt || '';
    els.copyCta.dataset.copied = 'false';

    // Similar — same category, other prompts
    const similar = state.prompts.filter(x => x.category === p.category && x.id !== p.id).slice(0, 8);
    if (similar.length > 0) {
      els.similarWrap.style.display = '';
      els.similarRail.innerHTML = similar.map(x => `
        <div class="similar-thumb" data-similar="${x.id}" role="button" tabindex="0">
          <img loading="lazy" src="${x.img}" alt="${escapeAttr(x.title)}" />
          <span class="st-label">${escapeHtml(x.category)}</span>
        </div>
      `).join('');
      $$('.similar-thumb', els.similarRail).forEach(t => {
        t.addEventListener('click', () => {
          els.sheetScroll.scrollTop = 0;
          openSheet(t.dataset.similar);
        });
      });
    } else {
      els.similarWrap.style.display = 'none';
    }

    els.sheetScroll.scrollTop = 0;
    els.sheet.dataset.open = 'true';
    els.scrim.dataset.open = 'true';
    document.body.style.overflow = 'hidden';
  }
  function closeSheet() {
    els.sheet.dataset.open = 'false';
    if (els.profile.dataset.open !== 'true' && els.editor.dataset.open !== 'true') {
      els.scrim.dataset.open = 'false';
      document.body.style.overflow = '';
    }
    state.currentId = null;
  }
  els.sheetClose.addEventListener('click', closeSheet);
  els.scrim.addEventListener('click', () => { closeSheet(); closeProfile(); closeEditor(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeSheet(); closeProfile(); closeEditor(); }
  });

  // Edit / delete from sheet
  els.sheetEdit.addEventListener('click', () => {
    if (!state.currentId) return;
    const p = state.prompts.find(x => x.id === state.currentId);
    closeSheet();
    setTimeout(() => openEditor(p), 200);
  });
  els.sheetDelete.addEventListener('click', () => {
    if (!state.currentId) return;
    const p = state.prompts.find(x => x.id === state.currentId);
    if (!p) return;
    if (!confirm(`Delete "${p.title || 'this prompt'}"? This can't be undone.`)) return;
    state.prompts = state.prompts.filter(x => x.id !== p.id);
    savePrompts();
    closeSheet();
    renderCats(); renderMasonry();
    showToast('Prompt deleted');
  });

  // Swipe-down to close on mobile
  (function attachSwipe(el) {
    let startY = null, dy = 0, dragging = false;
    el.addEventListener('touchstart', (e) => {
      if (els.sheetScroll.scrollTop > 0) return;
      startY = e.touches[0].clientY; dy = 0; dragging = true;
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      if (!dragging || startY == null) return;
      dy = e.touches[0].clientY - startY;
      if (dy > 0) el.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    el.addEventListener('touchend', () => {
      if (!dragging) return;
      dragging = false;
      el.style.transform = '';
      if (dy > 120) closeSheet();
      startY = null; dy = 0;
    });
  })(els.sheet);

  // ---------- Copy ----------
  els.copyCta.addEventListener('click', () => {
    if (!state.currentId) return;
    const p = state.prompts.find(x => x.id === state.currentId);
    if (!p) return;
    copyPrompt(p.prompt, 'Prompt copied ✨');
    els.copyCta.dataset.copied = 'true';
    setTimeout(() => { els.copyCta.dataset.copied = 'false'; }, 2400);
  });

  function copyPrompt(text, toastMsg) {
    const done = () => showToast(toastMsg);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else fallback();
    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      done();
    }
  }

  let toastTimer = null;
  function showToast(msg) {
    els.toastText.textContent = msg || 'Copied!';
    els.toast.dataset.open = 'true';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.dataset.open = 'false'; }, 1900);
  }

  // ---------- Profile ----------
  function openProfile() {
    els.profileCount.textContent = state.prompts.length;
    els.profileCats.textContent = state.cats.filter(c => c.id !== 'all').length;

    if (state.prompts.length === 0) {
      els.profileGrid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1; padding: 24px 8px;">
          <div>No prompts yet.<br/>Tap “+ Add prompt” to get started.</div>
        </div>`;
    } else {
      els.profileGrid.innerHTML = state.prompts.slice().reverse().map(cardHTML).join('');
      $$('.card', els.profileGrid).forEach(card => {
        card.addEventListener('click', () => {
          closeProfile();
          setTimeout(() => openSheet(card.dataset.id), 200);
        });
      });
    }
    els.profile.dataset.open = 'true';
    els.scrim.dataset.open = 'true';
    document.body.style.overflow = 'hidden';
  }
  function closeProfile() {
    els.profile.dataset.open = 'false';
    if (els.sheet.dataset.open !== 'true' && els.editor.dataset.open !== 'true') {
      els.scrim.dataset.open = 'false';
      document.body.style.overflow = '';
    }
  }
  els.profileBtn.addEventListener('click', openProfile);
  els.profileClose.addEventListener('click', closeProfile);
  $$('.profile-tab').forEach(t => {
    t.addEventListener('click', () => {
      $$('.profile-tab').forEach(x => x.dataset.active = 'false');
      t.dataset.active = 'true';
    });
  });

  // ---------- Editor (Add / Edit prompt) ----------
  function openEditor(prompt = null) {
    state.editing = prompt;
    els.editorTitle.textContent = prompt ? 'Edit prompt' : 'Add a prompt';
    els.fSave.textContent = prompt ? 'Save changes' : 'Save prompt';
    els.fDelete.style.display = prompt ? '' : 'none';

    // Populate category select
    refreshEditorCats(prompt ? prompt.category : '');

    els.fTitle.value  = prompt ? (prompt.title || '') : '';
    els.fPrompt.value = prompt ? (prompt.prompt || '') : '';
    els.fCatNew.value = '';

    if (prompt && prompt.img) {
      els.fPreviewImg.src = prompt.img;
      els.fDrop.dataset.filled = 'true';
      els.fDrop.dataset.aspect = prompt.aspect || 1;
    } else {
      els.fPreviewImg.src = '';
      els.fDrop.dataset.filled = 'false';
      els.fDrop.dataset.aspect = '';
    }

    els.editor.dataset.open = 'true';
    els.scrim.dataset.open = 'true';
    document.body.style.overflow = 'hidden';
    setTimeout(() => els.fTitle.focus(), 250);
  }
  function closeEditor() {
    els.editor.dataset.open = 'false';
    if (els.sheet.dataset.open !== 'true' && els.profile.dataset.open !== 'true') {
      els.scrim.dataset.open = 'false';
      document.body.style.overflow = '';
    }
    state.editing = null;
  }
  function refreshEditorCats(selected) {
    const opts = state.cats.filter(c => c.id !== 'all');
    els.fCat.innerHTML = `<option value="">— pick a category —</option>` +
      opts.map(c => `<option value="${escapeAttr(c.id)}" ${c.id === selected ? 'selected' : ''}>${c.emoji || ''} ${escapeHtml(c.name)}</option>`).join('') +
      `<option value="__new__">＋ Create new category…</option>`;
  }

  els.addBtn.addEventListener('click', () => openEditor());
  els.addBtnMobile.addEventListener('click', () => openEditor());
  els.editorClose.addEventListener('click', closeEditor);

  // Show/hide the "new category" input
  els.fCat.addEventListener('change', () => {
    if (els.fCat.value === '__new__') {
      els.fCatNew.style.display = '';
      els.fCatNew.focus();
    } else {
      els.fCatNew.style.display = 'none';
    }
  });

  // Image upload — the drop zone is a <label for="f-file">, so plain clicks
  // open the native file picker automatically (most reliable, works in every
  // sandboxed iframe). We only intercept clicks on the "clear" button so it
  // doesn't ALSO trigger the picker.
  // Prevent the clear-button click from bubbling to the <label> (would re-open the picker)
  els.fPreviewClear.addEventListener('click', (e) => {
    e.stopPropagation();
  }, true);
  // Keyboard: Enter/Space on the label fires a click which triggers the label,
  // but some browsers don't do this for <label>. Explicitly click the input.
  els.fDrop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      els.fFile.click();
    }
  });
  els.fFile.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    console.log('[upload] change fired, file:', f && { name: f.name, type: f.type, size: f.size });
    if (f) handleImageFile(f);
    els.fFile.value = '';
  });
  els.fDrop.addEventListener('dragover', (e) => { e.preventDefault(); els.fDrop.dataset.drag = 'true'; });
  els.fDrop.addEventListener('dragleave', () => { els.fDrop.dataset.drag = 'false'; });
  els.fDrop.addEventListener('drop', (e) => {
    e.preventDefault(); els.fDrop.dataset.drag = 'false';
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleImageFile(f);
  });
  // Paste from clipboard (works when the modal is open)
  document.addEventListener('paste', (e) => {
    if (els.editor.dataset.open !== 'true') return;
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) handleImageFile(f);
        e.preventDefault();
        return;
      }
    }
  });
  els.fPreviewClear.addEventListener('click', (e) => {
    e.stopPropagation();
    els.fPreviewImg.src = '';
    els.fDrop.dataset.filled = 'false';
    els.fDrop.dataset.aspect = '';
  });

  async function handleImageFile(file) {
    console.log('[upload] handleImageFile', file && file.name, file && file.type);
    if (!file.type.startsWith('image/')) {
      showToast('Please pick an image file');
      return;
    }
    try {
      const { dataUrl, aspect } = await compressImage(file, 1600, 0.85);
      console.log('[upload] compressed OK, dataUrl length:', dataUrl.length, 'aspect:', aspect);
      els.fPreviewImg.src = dataUrl;
      els.fDrop.dataset.filled = 'true';
      els.fDrop.dataset.aspect = aspect;
      console.log('[upload] preview filled ✓');
    } catch (err) {
      console.error('[upload] compress failed', err);
      showToast('Couldn\'t load that image');
    }
  }

  /* Resize + JPEG-compress in a canvas so localStorage stays healthy.
     Returns a data URL and the (width/height) aspect ratio for the masonry. */
  function compressImage(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const w0 = img.naturalWidth, h0 = img.naturalHeight;
          const scale = Math.min(1, maxDim / Math.max(w0, h0));
          const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = c.toDataURL('image/jpeg', quality);
          URL.revokeObjectURL(url);
          resolve({ dataUrl, aspect: +(w / h).toFixed(3) });
        } catch (e) { reject(e); }
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  // Submit
  els.editorForm.addEventListener('submit', (e) => {
    e.preventDefault();
    saveFromEditor();
  });

  function saveFromEditor() {
    const title  = els.fTitle.value.trim();
    const prompt = els.fPrompt.value.trim();
    let category = els.fCat.value;
    const newCat = els.fCatNew.value.trim();
    const img    = els.fDrop.dataset.filled === 'true' ? els.fPreviewImg.src : '';
    const aspect = parseFloat(els.fDrop.dataset.aspect) || 1;

    if (!img)    { showToast('Add an image first'); els.fDrop.focus(); return; }
    if (!prompt) { showToast('Paste the prompt text'); els.fPrompt.focus(); return; }

    // Create a new category if requested
    if (category === '__new__') {
      if (!newCat) { showToast('Name the new category'); els.fCatNew.focus(); return; }
      const id = newCat;
      if (!state.cats.some(c => c.id === id)) {
        state.cats.push({ id, name: id, emoji: '•' });
        saveCats();
      }
      category = id;
    }
    if (!category) { showToast('Pick a category'); els.fCat.focus(); return; }

    if (state.editing) {
      // Update existing
      const idx = state.prompts.findIndex(p => p.id === state.editing.id);
      if (idx >= 0) {
        state.prompts[idx] = {
          ...state.prompts[idx],
          title: title || 'Untitled',
          prompt, category, img, aspect,
        };
      }
      showToast('Prompt updated');
    } else {
      // New prompt
      state.prompts.unshift({
        id: 'u_' + Math.random().toString(36).slice(2, 10),
        title: title || 'Untitled',
        prompt, category, img, aspect,
        createdAt: Date.now(),
      });
      showToast('Prompt saved ✨');
    }

    try { savePrompts(); }
    catch (err) {
      showToast('Storage full — try a smaller image');
      console.error(err);
      return;
    }
    closeEditor();
    renderCats(); renderMasonry();
  }

  els.fDelete.addEventListener('click', () => {
    if (!state.editing) return;
    if (!confirm(`Delete "${state.editing.title || 'this prompt'}"?`)) return;
    state.prompts = state.prompts.filter(p => p.id !== state.editing.id);
    savePrompts();
    closeEditor();
    renderCats(); renderMasonry();
    showToast('Prompt deleted');
  });

  // Cmd/Ctrl+Enter to save
  els.editorForm.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      saveFromEditor();
    }
  });

  // ---------- Search ----------
  els.search.addEventListener('input', (e) => {
    state.query = e.target.value.trim();
    renderMasonry();
  });

  // ---------- Utils ----------
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // ---------- Category rail: wheel-to-horizontal + click-drag scroll ----------
  (function enableRailScroll() {
    const rail = document.getElementById('cats');
    if (!rail) return;

    // Vertical wheel / trackpad → horizontal scroll
    rail.addEventListener('wheel', (e) => {
      // If user is already scrolling horizontally (trackpad two-finger), let it be
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (e.deltaY === 0) return;
      // Only intercept if there's actually something to scroll to
      const canScroll = rail.scrollWidth > rail.clientWidth + 1;
      if (!canScroll) return;
      e.preventDefault();
      rail.scrollBy({ left: e.deltaY, behavior: 'auto' });
    }, { passive: false });

    // Click-and-drag scroll (desktop)
    let down = false, startX = 0, startScroll = 0, moved = 0;
    rail.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return; // native touch scroll handles this
      down = true; moved = 0;
      startX = e.clientX;
      startScroll = rail.scrollLeft;
      rail.setPointerCapture(e.pointerId);
    });
    rail.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - startX;
      moved = Math.max(moved, Math.abs(dx));
      if (moved > 4) rail.classList.add('is-dragging');
      rail.scrollLeft = startScroll - dx;
    });
    const endDrag = (e) => {
      if (!down) return;
      down = false;
      // Delay removing is-dragging so the pill's click doesn't fire after a drag
      setTimeout(() => rail.classList.remove('is-dragging'), 0);
      try { rail.releasePointerCapture(e.pointerId); } catch(_) {}
    };
    rail.addEventListener('pointerup', endDrag);
    rail.addEventListener('pointercancel', endDrag);
    rail.addEventListener('pointerleave', endDrag);

    // Keyboard: left/right arrows when rail is focused
    rail.setAttribute('tabindex', '0');
    rail.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { rail.scrollBy({ left: 200, behavior: 'smooth' }); e.preventDefault(); }
      if (e.key === 'ArrowLeft')  { rail.scrollBy({ left: -200, behavior: 'smooth' }); e.preventDefault(); }
    });
  })();

  // ---------- Init ----------
  renderCats();
  renderMasonry();

  window.__promptly = {
    rerender() { renderCats(); renderMasonry(); },
    applyTheme,
    openEditor,
  };
})();
