/**
 * theme.js — Shared Dark/Light Mode Toggle Logic
 * Loaded by all pages via script tag or injected.
 */
(function () {
  const STORAGE_KEY = 'dfia-theme';

  function getPreferredTheme() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.body && document.body.setAttribute && document.body.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);

    // Update toggle button state if exists
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) {
      btn.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
      btn.title = theme === 'light' ? 'Ganti ke Mode Gelap 🌙' : 'Ganti ke Mode Terang ☀️';
    }
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  }

  // Apply on load immediately
  applyTheme(getPreferredTheme());

  // Setup toggle button click
  document.addEventListener('DOMContentLoaded', function () {
    applyTheme(getPreferredTheme()); // re-apply after DOM ready

    const btn = document.getElementById('theme-toggle-btn');
    if (btn) {
      btn.addEventListener('click', toggleTheme);
    }
  });

  // Expose to global in case needed
  window.difotoinajaTheme = { toggle: toggleTheme, apply: applyTheme };
})();
