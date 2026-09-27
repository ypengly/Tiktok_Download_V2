(() => {
  'use strict';

  // ---------------------------------------------------------------------
  // Theme toggle
  // ---------------------------------------------------------------------
  const root = document.documentElement;
  const themeToggle = document.getElementById('themeToggle');

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    localStorage.setItem('tiksave-theme', theme);
    themeToggle.setAttribute(
      'aria-label',
      theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
    );
  }

  const savedTheme =
    localStorage.getItem('tiksave-theme') ||
    (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  applyTheme(savedTheme);

  themeToggle.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  });

  // ---------------------------------------------------------------------
  // Mobile nav
  // ---------------------------------------------------------------------
  const navToggle = document.getElementById('navToggle');
  const mobileNav = document.getElementById('mobileNav');

  navToggle.addEventListener('click', () => {
    const isOpen = mobileNav.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
    navToggle.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
  });

  mobileNav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      mobileNav.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
      navToggle.setAttribute('aria-label', 'Open menu');
    });
  });

  // ---------------------------------------------------------------------
  // Toasts
  // ---------------------------------------------------------------------
  const toastContainer = document.getElementById('toastContainer');

  function showToast(message, type = 'default', duration = 3200) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-dot" aria-hidden="true"></span><span>${escapeHtml(
      message
    )}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('leaving');
      setTimeout(() => toast.remove(), 220);
    }, duration);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---------------------------------------------------------------------
  // URL validation
  // ---------------------------------------------------------------------
  const TIKTOK_HOST_PATTERN = /^([a-z0-9-]+\.)*tiktok\.com$/i;

  function validateUrl(raw) {
    const value = (raw || '').trim();
    if (!value) return { valid: false, message: 'Paste a TikTok video link to get started.' };

    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      return { valid: false, message: 'That doesn\u2019t look like a valid URL.' };
    }

    if (parsed.protocol !== 'https:') {
      return { valid: false, message: 'Use a secure (https://) TikTok link.' };
    }
    if (!TIKTOK_HOST_PATTERN.test(parsed.hostname)) {
      return {
        valid: false,
        message: 'Enter a TikTok link (tiktok.com, vm.tiktok.com, or vt.tiktok.com).',
      };
    }
    return { valid: true };
  }

  // ---------------------------------------------------------------------
  // Elements
  // ---------------------------------------------------------------------
  const form = document.getElementById('downloadForm');
  const urlInput = document.getElementById('urlInput');
  const fieldMessage = document.getElementById('urlHelp');
  const downloadBtn = document.getElementById('downloadBtn');
  const pasteBtn = document.getElementById('pasteBtn');
  const resetBtn = document.getElementById('resetBtn');
  const skeletonCard = document.getElementById('skeletonCard');
  const previewCard = document.getElementById('previewCard');
  const errorCard = document.getElementById('errorCard');
  const errorText = document.getElementById('errorText');

  const previewThumb = document.getElementById('previewThumb');
  const previewDuration = document.getElementById('previewDuration');
  const previewAuthor = document.getElementById('previewAuthor');
  const previewTitle = document.getElementById('previewTitle');
  const downloadOptions = document.getElementById('downloadOptions');

  // ---------------------------------------------------------------------
  // State helpers
  // ---------------------------------------------------------------------
  function resetStates() {
    skeletonCard.hidden = true;
    previewCard.hidden = true;
    errorCard.hidden = true;
  }

  function setLoading(isLoading) {
    downloadBtn.disabled = isLoading;
    downloadBtn.classList.toggle('loading', isLoading);
    pasteBtn.disabled = isLoading;
  }

  function formatDuration(seconds) {
    const s = Math.max(0, Math.round(Number(seconds) || 0));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${String(rem).padStart(2, '0')}`;
  }

  function renderPreview(video, sourceUrl) {
    previewThumb.onerror = () => {
      previewThumb.removeAttribute('src');
      previewThumb.alt = 'Thumbnail unavailable';
      previewThumb.classList.add('thumbnail-unavailable');
    };
    previewThumb.classList.remove('thumbnail-unavailable');
    previewThumb.src = video.thumbnail || '';
    previewThumb.alt = video.title
      ? `Preview thumbnail for ${video.title}`
      : 'Video preview thumbnail';
    previewDuration.textContent = formatDuration(video.duration);
    previewAuthor.textContent = video.author || 'Unknown creator';
    previewTitle.textContent = video.title || 'Untitled video';

    downloadOptions.innerHTML = '';

    // ------------------------------------------------------------------
    // Download chips — point to OUR /api/file/... proxy.
    // The proxy streams the video with Content-Disposition: attachment,
    // which is what actually forces a save on iOS Safari and Android Chrome.
    // ------------------------------------------------------------------
    (video.downloads || []).forEach((option) => {
      const chip = document.createElement('a');
      chip.className = 'download-chip';
      chip.textContent = `${option.quality} \u00b7 ${option.format}`;
      chip.href = option.downloadUrl || option.url;
      chip.setAttribute('download', option.filename || '');
      chip.rel = 'noopener noreferrer';
      chip.addEventListener('click', () => {
        showToast(`Downloading ${option.quality} ${option.format}\u2026`, 'success');
      });
      downloadOptions.appendChild(chip);
    });

    // Copy-source-link chip
    const copyChip = document.createElement('button');
    copyChip.type = 'button';
    copyChip.className = 'download-chip';
    copyChip.textContent = 'Copy link';
    copyChip.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(sourceUrl);
        showToast('Link copied', 'success');
      } catch {
        showToast('Couldn\u2019t copy the link', 'error');
      }
    });
    downloadOptions.appendChild(copyChip);

    previewCard.hidden = false;
  }

  function showError(message) {
    errorText.textContent = message;
    errorCard.hidden = false;
  }

  // ---------------------------------------------------------------------
  // Live field validation
  // ---------------------------------------------------------------------
  let touched = false;

  urlInput.addEventListener('input', () => {
    resetStates();
    if (!touched) return;
    const result = validateUrl(urlInput.value);
    urlInput.classList.toggle(
      'invalid',
      !result.valid && urlInput.value.trim().length > 0
    );
    fieldMessage.textContent =
      urlInput.value.trim().length > 0 && !result.valid ? result.message : '';
  });

  // ---------------------------------------------------------------------
  // Paste button
  // ---------------------------------------------------------------------
  pasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      urlInput.value = text;
      urlInput.focus();
      touched = true;
      urlInput.dispatchEvent(new Event('input'));
    } catch {
      showToast('Clipboard access isn\u2019t available \u2014 paste manually instead.', 'error');
      urlInput.focus();
    }
  });

  // ---------------------------------------------------------------------
  // Reset / clear
  // ---------------------------------------------------------------------
  resetBtn.addEventListener('click', () => {
    form.reset();
    touched = false;
    urlInput.classList.remove('invalid');
    fieldMessage.textContent = '';
    resetStates();
  });

  // ---------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    touched = true;

    const rawUrl = urlInput.value;
    const result = validateUrl(rawUrl);

    if (!result.valid) {
      urlInput.classList.add('invalid');
      fieldMessage.textContent = result.message;
      urlInput.focus();
      return;
    }

    urlInput.classList.remove('invalid');
    fieldMessage.textContent = '';
    resetStates();
    setLoading(true);
    skeletonCard.hidden = false;

    try {
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: rawUrl.trim() }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Something went wrong. Please try again.');
      }

      skeletonCard.hidden = true;
      renderPreview(data.video, rawUrl.trim());
      showToast('Video found', 'success');
    } catch (err) {
      skeletonCard.hidden = true;
      showError(err.message || 'We couldn\u2019t reach the server. Please try again.');
      showToast('Something went wrong', 'error');
    } finally {
      setLoading(false);
    }
  });

  // ---------------------------------------------------------------------
  // Accordion (FAQ)
  // ---------------------------------------------------------------------
  document.querySelectorAll('.accordion-trigger').forEach((trigger) => {
    const panel = trigger.nextElementSibling;

    trigger.addEventListener('click', () => {
      const isOpen = trigger.getAttribute('aria-expanded') === 'true';

      document.querySelectorAll('.accordion-trigger').forEach((t) => {
        t.setAttribute('aria-expanded', 'false');
        t.nextElementSibling.style.maxHeight = '';
      });

      if (!isOpen) {
        trigger.setAttribute('aria-expanded', 'true');
        panel.style.maxHeight = `${panel.scrollHeight}px`;
      }
    });
  });
})();