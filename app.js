/* ============================================================
   Promptly — main app logic (Firebase + Cloudinary edition)
   ============================================================
   • Prompts + categories live in Firebase Firestore (cloud DB).
   • Images live in Cloudinary (25 GB free tier).
   • Only the admin (ADMIN_EMAIL) can add / edit / delete.
   • Everyone else sees a read-only gallery with 1-tap copy.
   ============================================================ */
(() => {
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // -----------------------------------------------------------
  // Firebase bootstrap (compat SDK — loaded from index.html)
  // -----------------------------------------------------------
  firebase.initializeApp(window.FIREBASE_CONFIG);
  const auth = firebase.auth();
  const db   = firebase.firestore();
  const PROMPTS_COL = db.collection('prompts');
  const CATS_COL    = db.collection('categories');

  // -----------------------------------------------------------
  // Local, non-secret preferences
  // -----------------------------------------------------------
  const K_THEME = 'promptly:theme';

  // -----------------------------------------------------------
  // App state
  // -----------------------------------------------------------
  const state = {
    category:  'all',
    query:     '',
    currentId: null,
    theme:     localStorage.getItem(K_THEME) || 'light',
    prompts:   [],
    cats:      [{ id: 'all', name: 'All', emoji: '✨' }],
    editing:   null,
    isAdmin:   false,
    user:      null,
    loading:   true,
  };

  // -----------------------------------------------------------
  // DOM refs
  // -----------------------------------------------------------
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
    sheetActions: $('.sheet-actions'),
    copyCta:      $('#copy-cta'),
    promptText:   $('#prompt-text'),
    similarRail:  $('#similar-rail'),
    similarWrap:  $('#similar-wrap'),

    profile:      $('#profile'),
    profileBtn:   $('#profile-btn'),
    profileClose: $('#profile-close'),
    profileCount: $('#profile-count'),
    profileCats:  $('#profile-cats'),
    profileName:  $('#profile-name'),
    profileHandle:$('#profile-handle'),
    profileAvatar:$('#profile-avatar'),
    adminBlock:   $('#admin-block'),
    logoutBtn:    $('#logout-btn'),
    exportBtn:    $('#export-btn'),

    themeToggle:  $('#theme-toggle'),
    addBtn:       $('#add-btn'),
    addBtnMobile: $('#add-btn-mobile'),

    // Login modal
    loginModal:   $('#login-modal'),
    loginForm:    $('#login-form'),
    loginEmail:   $('#login-email'),
    loginPassword:$('#login-password'),
    loginError:   $('#login-error'),
    loginClose:   $('#login-close'),
    loginSubmit:  $('#login-submit'),

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
    uploadProgress: $('#upload-progress'),
    uploadBar:    $('#upload-bar'),
    uploadPct:    $('#upload-pct'),

    toast:        $('#toast'),
    toastText:    $('#toast-text'),
  };

  // -----------------------------------------------------------
  // Theme
  // -----------------------------------------------------------
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    state.theme = t;
    localStorage.setItem(K_THEME, t);
  }
  applyTheme(state.theme);
  els.themeToggle.addEventListener('click',
    () => applyTheme(state.theme === 'dark' ? 'light' : 'dark'));

  // -----------------------------------------------------------
  // Auth state observer — this drives admin vs visitor UI
  // -----------------------------------------------------------
  auth.onAuthStateChanged(user => {
    // Only the configured ADMIN_EMAIL counts as admin.
    if (user && user.email && user.email.toLowerCase() === window.ADMIN_EMAIL.toLowerCase()) {
      state.user = user;
      state.isAdmin = true;
    } else if (user) {
      // Someone else logged in — sign them out.
      auth.signOut();
      state.user = null;
      state.isAdmin = false;
    } else {
      state.user = null;
      state.isAdmin = false;
    }
    updateAdminUI();
  });

  function updateAdminUI() {
    // Add-prompt button: visible only to admin
    const showAdd = state.isAdmin ? '' : 'none';
    els.addBtn.style.display        = showAdd;
    els.addBtnMobile.style.display  = showAdd;

    // Sheet edit/delete icons: admin only
    els.sheetEdit.style.display   = state.isAdmin ? '' : 'none';
    els.sheetDelete.style.display = state.isAdmin ? '' : 'none';

    // Avatar button in top-bar → shows Y for admin, lock icon for visitor
    if (state.isAdmin) {
      els.profileBtn.innerHTML = 'Y';
      els.profileBtn.setAttribute('title', 'Your admin panel');
      els.profileBtn.style.background = '';
    } else {
      els.profileBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>`;
      els.profileBtn.setAttribute('title', 'Admin login');
      els.profileBtn.style.background = 'var(--ink)';
    }

    // Profile-panel admin section
    if (els.adminBlock) els.adminBlock.style.display = state.isAdmin ? '' : 'none';
    if (state.isAdmin) {
      els.profileName.textContent   = 'Admin panel';
      els.profileHandle.textContent = state.user.email;
      els.profileAvatar.textContent = (state.user.email[0] || 'A').toUpperCase();
    } else {
      els.profileName.textContent   = 'Promptly';
      els.profileHandle.textContent = 'Browse & copy prompts';
      els.profileAvatar.textContent = 'P';
    }
  }

  // -----------------------------------------------------------
  // Firestore realtime subscriptions
  // -----------------------------------------------------------
  function startRealtime() {
    // Categories — live
    CATS_COL.orderBy('order', 'asc').onSnapshot(snap => {
      const cats = [{ id: 'all', name: 'All', emoji: '✨' }];
      snap.forEach(doc => {
        const d = doc.data();
        cats.push({ id: doc.id, name: d.name || doc.id, emoji: d.emoji || '•', order: d.order || 0 });
      });
      state.cats = cats;
      renderCats();
    }, err => console.error('[cats]', err));

    // Prompts — live, newest first
    PROMPTS_COL.orderBy('createdAt', 'desc').onSnapshot(snap => {
      state.prompts = [];
      snap.forEach(doc => {
        const d = doc.data();
        state.prompts.push({
          id:        doc.id,
          title:     d.title || 'Untitled',
          prompt:    d.prompt || '',
          category:  d.category || '',
          img:       d.img || '',
          aspect:    d.aspect || 1,
          cloudinaryId: d.cloudinaryId || null,
          createdAt: d.createdAt ? (d.createdAt.toMillis ? d.createdAt.toMillis() : d.createdAt) : Date.now(),
        });
      });
      state.loading = false;
      renderCats();
      renderMasonry();
    }, err => {
      console.error('[prompts]', err);
      state.loading = false;
      renderMasonry();
    });
  }

  // -----------------------------------------------------------
  // Categories rail
  // -----------------------------------------------------------
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

  // -----------------------------------------------------------
  // Masonry gallery
  // -----------------------------------------------------------
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
    // Serve a smaller version from Cloudinary for the grid (faster loading)
    const gridImg = cloudinaryThumb(p.img, 800);
    return `
      <article class="card" data-id="${p.id}" style="--ar: ${ar}; animation-delay: ${Math.min(i * 40, 480)}ms;" tabindex="0" role="button" aria-label="Open prompt: ${escapeAttr(p.title)}">
        <div class="thumb">
          <img loading="lazy" src="${gridImg}" alt="${escapeAttr(p.title)}" />
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

    if (state.loading) {
      els.masonry.innerHTML = `
        <div class="empty-state" style="column-span: all;">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1.2s linear infinite;">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
          </svg>
          <div style="margin-top: 12px;">Loading your gallery…</div>
        </div>
        <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
      `;
      return;
    }

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
          <h2 class="serif">${state.isAdmin ? 'Your gallery is empty' : 'Nothing here yet'}</h2>
          <p>${state.isAdmin
              ? 'Add your first prompt — upload an image, paste your prompt, pick a category.'
              : 'The admin hasn\'t added any prompts yet. Check back soon!'}</p>
          ${state.isAdmin
              ? `<button class="btn-primary" id="empty-add-btn">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"></path></svg>
                  Add your first prompt
                </button>` : ''}
        </div>
      `;
      const btn = $('#empty-add-btn');
      if (btn) btn.addEventListener('click', () => openEditor());
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

  // -----------------------------------------------------------
  // Detail sheet
  // -----------------------------------------------------------
  function openSheet(id) {
    const p = state.prompts.find(x => x.id === id);
    if (!p) return;
    state.currentId = id;
    els.sheetImg.src = cloudinaryThumb(p.img, 1600);
    els.sheetImg.alt = p.title || '';
    els.sheetCat.textContent = p.category;
    els.sheetTitle.textContent = p.title || 'Untitled';
    els.promptText.textContent = p.prompt || '';
    els.copyCta.dataset.copied = 'false';

    const similar = state.prompts.filter(x => x.category === p.category && x.id !== p.id).slice(0, 8);
    if (similar.length > 0) {
      els.similarWrap.style.display = '';
      els.similarRail.innerHTML = similar.map(x => `
        <div class="similar-thumb" data-similar="${x.id}" role="button" tabindex="0">
          <img loading="lazy" src="${cloudinaryThumb(x.img, 400)}" alt="${escapeAttr(x.title)}" />
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
    if (els.profile.dataset.open !== 'true' && els.editor.dataset.open !== 'true' && els.loginModal.dataset.open !== 'true') {
      els.scrim.dataset.open = 'false';
      document.body.style.overflow = '';
    }
    state.currentId = null;
  }
  els.sheetClose.addEventListener('click', closeSheet);
  els.scrim.addEventListener('click', () => { closeSheet(); closeProfile(); closeEditor(); closeLogin(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeSheet(); closeProfile(); closeEditor(); closeLogin(); }
  });

  els.sheetEdit.addEventListener('click', () => {
    if (!state.isAdmin || !state.currentId) return;
    const p = state.prompts.find(x => x.id === state.currentId);
    closeSheet();
    setTimeout(() => openEditor(p), 200);
  });
  els.sheetDelete.addEventListener('click', async () => {
    if (!state.isAdmin || !state.currentId) return;
    const p = state.prompts.find(x => x.id === state.currentId);
    if (!p) return;
    if (!confirm(`Delete "${p.title || 'this prompt'}"? This can't be undone.`)) return;
    try {
      await PROMPTS_COL.doc(p.id).delete();
      closeSheet();
      showToast('Prompt deleted');
    } catch (err) {
      console.error(err);
      showToast('Delete failed — check connection');
    }
  });

  // Swipe-down close on mobile
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

  // -----------------------------------------------------------
  // Copy prompt
  // -----------------------------------------------------------
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

  // -----------------------------------------------------------
  // Profile / Admin panel
  // -----------------------------------------------------------
  function openProfile() {
    // If not admin, clicking the "lock" avatar opens the login modal instead.
    if (!state.isAdmin) {
      openLogin();
      return;
    }
    els.profileCount.textContent = state.prompts.length;
    els.profileCats.textContent  = state.cats.filter(c => c.id !== 'all').length;
    els.profile.dataset.open = 'true';
    els.scrim.dataset.open   = 'true';
    document.body.style.overflow = 'hidden';
  }
  function closeProfile() {
    els.profile.dataset.open = 'false';
    if (els.sheet.dataset.open !== 'true' && els.editor.dataset.open !== 'true' && els.loginModal.dataset.open !== 'true') {
      els.scrim.dataset.open = 'false';
      document.body.style.overflow = '';
    }
  }
  els.profileBtn.addEventListener('click', openProfile);
  els.profileClose.addEventListener('click', closeProfile);

  els.logoutBtn.addEventListener('click', async () => {
    if (!confirm('Log out of admin?')) return;
    try {
      await auth.signOut();
      closeProfile();
      showToast('Logged out');
    } catch (err) {
      console.error(err);
      showToast('Logout failed');
    }
  });

  els.exportBtn.addEventListener('click', () => {
    const dump = {
      exportedAt: new Date().toISOString(),
      prompts:    state.prompts,
      categories: state.cats.filter(c => c.id !== 'all'),
    };
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url; a.download = `promptly-backup-${stamp}.json`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
    showToast(`Exported ${dump.prompts.length} prompts`);
  });

  // -----------------------------------------------------------
  // Login modal
  // -----------------------------------------------------------
  function openLogin() {
    els.loginError.style.display = 'none';
    els.loginError.textContent = '';
    els.loginEmail.value = '';
    els.loginPassword.value = '';
    els.loginModal.dataset.open = 'true';
    els.scrim.dataset.open = 'true';
    document.body.style.overflow = 'hidden';
    setTimeout(() => els.loginEmail.focus(), 200);
  }
  function closeLogin() {
    els.loginModal.dataset.open = 'false';
    if (els.sheet.dataset.open !== 'true' && els.editor.dataset.open !== 'true' && els.profile.dataset.open !== 'true') {
      els.scrim.dataset.open = 'false';
      document.body.style.overflow = '';
    }
  }
  els.loginClose.addEventListener('click', closeLogin);
  els.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = els.loginEmail.value.trim();
    const pw    = els.loginPassword.value;
    if (!email || !pw) return;

    if (email.toLowerCase() !== window.ADMIN_EMAIL.toLowerCase()) {
      showLoginError('Only the admin can sign in.');
      return;
    }

    els.loginSubmit.disabled = true;
    els.loginSubmit.textContent = 'Signing in…';
    try {
      await auth.signInWithEmailAndPassword(email, pw);
      closeLogin();
      showToast('Welcome back, admin ✨');
    } catch (err) {
      console.error('[login]', err);
      let msg = 'Sign-in failed. Check email/password.';
      if (err.code === 'auth/wrong-password') msg = 'Wrong password.';
      if (err.code === 'auth/user-not-found') msg = 'No admin account with that email.';
      if (err.code === 'auth/invalid-credential') msg = 'Invalid email or password.';
      if (err.code === 'auth/too-many-requests') msg = 'Too many attempts. Try again later.';
      if (err.code === 'auth/network-request-failed') msg = 'Network error. Check your connection.';
      showLoginError(msg);
    } finally {
      els.loginSubmit.disabled = false;
      els.loginSubmit.textContent = 'Sign in';
    }
  });
  function showLoginError(msg) {
    els.loginError.textContent = msg;
    els.loginError.style.display = '';
  }

  // -----------------------------------------------------------
  // Editor — add / edit prompt
  // -----------------------------------------------------------
  function openEditor(prompt = null) {
    if (!state.isAdmin) { openLogin(); return; }
    state.editing = prompt;
    els.editorTitle.textContent = prompt ? 'Edit prompt' : 'Add a prompt';
    els.fSave.textContent       = prompt ? 'Save changes' : 'Save prompt';
    els.fDelete.style.display   = prompt ? '' : 'none';

    refreshEditorCats(prompt ? prompt.category : '');

    els.fTitle.value  = prompt ? (prompt.title || '') : '';
    els.fPrompt.value = prompt ? (prompt.prompt || '') : '';
    els.fCatNew.value = '';
    els.fCatNew.style.display = 'none';

    if (prompt && prompt.img) {
      els.fPreviewImg.src = prompt.img;
      els.fDrop.dataset.filled = 'true';
      els.fDrop.dataset.aspect = prompt.aspect || 1;
      els.fDrop.dataset.newFile = 'false';
    } else {
      els.fPreviewImg.src = '';
      els.fDrop.dataset.filled = 'false';
      els.fDrop.dataset.aspect = '';
      els.fDrop.dataset.newFile = 'false';
    }
    // clear any pending upload state
    els.fDrop.dataset.pendingUrl = '';
    els.fDrop.dataset.pendingId  = '';
    hideProgress();

    els.editor.dataset.open = 'true';
    els.scrim.dataset.open  = 'true';
    document.body.style.overflow = 'hidden';
    setTimeout(() => els.fTitle.focus(), 250);
  }
  function closeEditor() {
    els.editor.dataset.open = 'false';
    if (els.sheet.dataset.open !== 'true' && els.profile.dataset.open !== 'true' && els.loginModal.dataset.open !== 'true') {
      els.scrim.dataset.open = 'false';
      document.body.style.overflow = '';
    }
    state.editing = null;
  }
  function refreshEditorCats(selected) {
    const opts = state.cats.filter(c => c.id !== 'all');
    els.fCat.innerHTML =
      `<option value="">— pick a category —</option>` +
      opts.map(c => `<option value="${escapeAttr(c.id)}" ${c.id === selected ? 'selected' : ''}>${c.emoji || ''} ${escapeHtml(c.name)}</option>`).join('') +
      `<option value="__new__">＋ Create new category…</option>`;
  }

  els.addBtn.addEventListener('click', () => openEditor());
  els.addBtnMobile.addEventListener('click', () => openEditor());
  els.editorClose.addEventListener('click', closeEditor);

  els.fCat.addEventListener('change', () => {
    if (els.fCat.value === '__new__') {
      els.fCatNew.style.display = '';
      els.fCatNew.focus();
    } else {
      els.fCatNew.style.display = 'none';
    }
  });

  // File picker
  els.fPreviewClear.addEventListener('click', (e) => { e.stopPropagation(); }, true);
  els.fDrop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.fFile.click(); }
  });
  els.fFile.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
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
    els.fDrop.dataset.newFile = 'false';
    els.fDrop.dataset.pendingUrl = '';
    els.fDrop.dataset.pendingId  = '';
    hideProgress();
  });

  async function handleImageFile(file) {
    if (!file.type.startsWith('image/')) {
      showToast('Please pick an image file');
      return;
    }
    try {
      // 1) Compress on-device (fast preview + upload payload)
      const { dataUrl, aspect, blob } = await compressImage(file, 2000, 0.88);
      els.fPreviewImg.src = dataUrl;
      els.fDrop.dataset.filled = 'true';
      els.fDrop.dataset.aspect = aspect;

      // 2) Upload to Cloudinary right away, show a progress bar
      showProgress();
      const { secureUrl, publicId } = await uploadToCloudinary(blob, pct => {
        els.uploadBar.style.width = pct + '%';
        els.uploadPct.textContent = pct + '%';
      });
      hideProgress();

      els.fDrop.dataset.pendingUrl = secureUrl;
      els.fDrop.dataset.pendingId  = publicId;
      els.fDrop.dataset.newFile    = 'true';
      // swap the local blob preview for the Cloudinary URL so save uses the real one
      els.fPreviewImg.src = secureUrl;
      showToast('Image ready ✓');
    } catch (err) {
      console.error('[image]', err);
      hideProgress();
      showToast('Image upload failed — try again');
    }
  }

  function showProgress() {
    els.uploadProgress.style.display = '';
    els.uploadBar.style.width = '0%';
    els.uploadPct.textContent = '0%';
  }
  function hideProgress() {
    els.uploadProgress.style.display = 'none';
  }

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
          c.toBlob(blob => {
            const dataUrl = c.toDataURL('image/jpeg', quality);
            URL.revokeObjectURL(url);
            resolve({ dataUrl, aspect: +(w / h).toFixed(3), blob });
          }, 'image/jpeg', quality);
        } catch (e) { reject(e); }
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  function uploadToCloudinary(blob, onProgress) {
    return new Promise((resolve, reject) => {
      const cfg = window.CLOUDINARY_CONFIG;
      const url = `https://api.cloudinary.com/v1_1/${cfg.cloudName}/image/upload`;
      const fd = new FormData();
      fd.append('file', blob);
      fd.append('upload_preset', cfg.uploadPreset);
      if (cfg.folder) fd.append('folder', cfg.folder);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () => {
        try {
          const res = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300 && res.secure_url) {
            resolve({ secureUrl: res.secure_url, publicId: res.public_id });
          } else {
            reject(new Error(res.error && res.error.message ? res.error.message : 'Upload failed'));
          }
        } catch (e) { reject(e); }
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(fd);
    });
  }

  // -----------------------------------------------------------
  // Save prompt
  // -----------------------------------------------------------
  els.editorForm.addEventListener('submit', (e) => {
    e.preventDefault();
    saveFromEditor();
  });

  async function saveFromEditor() {
    if (!state.isAdmin) { openLogin(); return; }

    const title  = els.fTitle.value.trim();
    const prompt = els.fPrompt.value.trim();
    let category = els.fCat.value;
    const newCat = els.fCatNew.value.trim();

    const hasImage = els.fDrop.dataset.filled === 'true';
    const imgUrl   = els.fDrop.dataset.pendingUrl || (state.editing ? state.editing.img : '');
    const cldId    = els.fDrop.dataset.pendingId  || (state.editing ? state.editing.cloudinaryId : null);
    const aspect   = parseFloat(els.fDrop.dataset.aspect) || (state.editing ? state.editing.aspect : 1);

    if (!hasImage || !imgUrl) { showToast('Add an image first'); return; }
    if (!prompt)              { showToast('Paste the prompt text'); els.fPrompt.focus(); return; }

    // Create new category if requested
    if (category === '__new__') {
      if (!newCat) { showToast('Name the new category'); els.fCatNew.focus(); return; }
      const id = newCat.trim();
      const exists = state.cats.some(c => c.id === id);
      if (!exists) {
        try {
          await CATS_COL.doc(id).set({
            name:  id,
            emoji: '•',
            order: Date.now(),
          });
        } catch (err) {
          console.error(err);
          showToast('Could not create category');
          return;
        }
      }
      category = id;
    }
    if (!category) { showToast('Pick a category'); els.fCat.focus(); return; }

    els.fSave.disabled = true;
    const prevLabel = els.fSave.textContent;
    els.fSave.textContent = state.editing ? 'Saving…' : 'Publishing…';

    try {
      if (state.editing) {
        await PROMPTS_COL.doc(state.editing.id).update({
          title: title || 'Untitled',
          prompt, category,
          img: imgUrl,
          cloudinaryId: cldId,
          aspect,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        showToast('Prompt updated ✓');
      } else {
        await PROMPTS_COL.add({
          title: title || 'Untitled',
          prompt, category,
          img: imgUrl,
          cloudinaryId: cldId,
          aspect,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        showToast('Prompt saved ✨');
      }
      closeEditor();
    } catch (err) {
      console.error(err);
      showToast('Save failed — check connection');
    } finally {
      els.fSave.disabled = false;
      els.fSave.textContent = prevLabel;
    }
  }

  els.fDelete.addEventListener('click', async () => {
    if (!state.editing) return;
    if (!confirm(`Delete "${state.editing.title || 'this prompt'}"?`)) return;
    try {
      await PROMPTS_COL.doc(state.editing.id).delete();
      closeEditor();
      showToast('Prompt deleted');
    } catch (err) {
      console.error(err);
      showToast('Delete failed');
    }
  });

  els.editorForm.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      saveFromEditor();
    }
  });

  // -----------------------------------------------------------
  // Search
  // -----------------------------------------------------------
  els.search.addEventListener('input', (e) => {
    state.query = e.target.value.trim();
    renderMasonry();
  });

  // -----------------------------------------------------------
  // Cloudinary URL helper — inject on-the-fly transformations
  //   In:  https://res.cloudinary.com/CLOUD/image/upload/v123/foo.jpg
  //   Out: https://res.cloudinary.com/CLOUD/image/upload/f_auto,q_auto,w_800/v123/foo.jpg
  // -----------------------------------------------------------
  function cloudinaryThumb(url, w) {
    if (!url || typeof url !== 'string') return url || '';
    // Only rewrite our Cloudinary URLs; leave everything else untouched.
    if (!url.includes('/image/upload/')) return url;
    if (url.includes('/upload/f_auto')) return url; // already transformed
    return url.replace('/image/upload/', `/image/upload/f_auto,q_auto,w_${w}/`);
  }

  // -----------------------------------------------------------
  // Utils
  // -----------------------------------------------------------
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // -----------------------------------------------------------
  // Category rail: wheel → horizontal + click-drag
  // -----------------------------------------------------------
  (function enableRailScroll() {
    const rail = document.getElementById('cats');
    if (!rail) return;
    rail.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (e.deltaY === 0) return;
      const canScroll = rail.scrollWidth > rail.clientWidth + 1;
      if (!canScroll) return;
      e.preventDefault();
      rail.scrollBy({ left: e.deltaY, behavior: 'auto' });
    }, { passive: false });

    let down = false, startX = 0, startScroll = 0, moved = 0;
    rail.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
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
      setTimeout(() => rail.classList.remove('is-dragging'), 0);
      try { rail.releasePointerCapture(e.pointerId); } catch(_) {}
    };
    rail.addEventListener('pointerup', endDrag);
    rail.addEventListener('pointercancel', endDrag);
    rail.addEventListener('pointerleave', endDrag);

    rail.setAttribute('tabindex', '0');
    rail.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { rail.scrollBy({ left: 200, behavior: 'smooth' }); e.preventDefault(); }
      if (e.key === 'ArrowLeft')  { rail.scrollBy({ left: -200, behavior: 'smooth' }); e.preventDefault(); }
    });
  })();

  // -----------------------------------------------------------
  // Boot
  // -----------------------------------------------------------
  updateAdminUI();
  renderCats();
  renderMasonry();     // shows loading state
  startRealtime();     // wires up Firestore listeners

  window.__promptly = {
    rerender() { renderCats(); renderMasonry(); },
    applyTheme, openEditor, openLogin,
    state,
  };
})();
