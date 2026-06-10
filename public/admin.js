// Konfigurasi URL Backend (Kosongkan jika dihosting dalam satu server yang sama, misalnya: "https://difotoinaja-backend.onrender.com")
const BACKEND_URL = "https://difotoinaja-production.up.railway.app";

function getApiUrl(path) {
  if (!BACKEND_URL) return path;
  const base = BACKEND_URL.endsWith('/') ? BACKEND_URL.slice(0, -1) : BACKEND_URL;
  const p = path.startsWith('/') ? path : '/' + path;
  return base + p;
}

function getWsUrl() {
  if (!BACKEND_URL) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}`;
  }
  const url = new URL(BACKEND_URL);
  const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${url.host}`;
}

function getAssetUrl(path) {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) {
    return path;
  }
  if (!BACKEND_URL) return path;
  const base = BACKEND_URL.endsWith('/') ? BACKEND_URL.slice(0, -1) : BACKEND_URL;
  const p = path.startsWith('/') ? path : '/' + path;
  return base + p;
}

let adminState = {
  config: {},
  events: [],
  templates: [],
  printQueue: [],
  localPrintingEnabled: localStorage.getItem('dfia_local_print') !== 'false'
};

// Helper wrapper untuk fetch dengan proteksi PIN Admin
async function adminFetch(url, options = {}) {
  const pin = sessionStorage.getItem('adminPin') || '';
  
  // Pastikan headers diinisialisasi
  options.headers = options.headers || {};
  if (!(options.body instanceof FormData)) {
    options.headers['Content-Type'] = options.headers['Content-Type'] || 'application/json';
  }
  options.headers['X-Admin-PIN'] = pin;

  const translatedUrl = getApiUrl(url);
  const res = await fetch(translatedUrl, options);
  
  if (res.status === 401) {
    // PIN tidak valid atau sesi kedaluwarsa
    sessionStorage.removeItem('adminPin');
    showLockScreen();
    throw new Error('Sesi tidak terautentikasi atau PIN salah.');
  }
  
  return res;
}

// Lock Screen & Auth state
let currentPinInput = "";
let isLockSetupMode = false;

function showLockScreen(setupMode = false) {
  const lockScreen = document.getElementById('admin-lock-screen');
  const lockTitle = document.getElementById('lock-title');
  const lockDesc = document.getElementById('lock-desc');
  const submitBtn = document.getElementById('btn-submit-pin');
  
  isLockSetupMode = setupMode;
  currentPinInput = "";
  document.getElementById('pin-input').value = "";
  
  if (setupMode) {
    lockTitle.textContent = "Buat PIN Baru 🔒";
    lockDesc.textContent = "Buat PIN baru (4 - 6 digit) untuk mengamankan Dashboard Admin.";
    submitBtn.textContent = "Simpan PIN 💾";
  } else {
    lockTitle.textContent = "Area Terbatas 🔒";
    lockDesc.textContent = "Masukkan PIN untuk membuka Dashboard Admin.";
    submitBtn.textContent = "Masuk 🔑";
  }
  
  lockScreen.style.display = 'flex';
}

function hideLockScreen() {
  document.getElementById('admin-lock-screen').style.display = 'none';
}

function isPageReloaded() {
  try {
    const navigation = performance.getEntriesByType("navigation")[0];
    if (navigation) {
      return navigation.type === "reload";
    }
  } catch (e) {}
  
  try {
    return performance.navigation && performance.navigation.type === 1;
  } catch (e) {}
  
  return false;
}

async function checkAdminAuthentication() {
  try {
    // 1. Cek status PIN di server
    const statusRes = await fetch(getApiUrl('/api/admin/status'));
    const statusData = await statusRes.json();
    
    const groupOldPin = document.getElementById('group-old-pin');
    if (!statusData.hasPin) {
      // PIN belum dibuat, munculkan setup mode
      if (groupOldPin) groupOldPin.style.display = 'none';
      showLockScreen(true);
    } else {
      // PIN sudah dibuat
      if (groupOldPin) groupOldPin.style.display = 'flex';
      
      const pin = sessionStorage.getItem('adminPin');
      const isReload = isPageReloaded();
      
      if (isReload && pin) {
        // Jika halaman di-refresh dan PIN sudah terverifikasi sebelumnya,
        // pertahankan sesi dan bypass lock screen.
        hideLockScreen();
        await refreshAllData();
      } else {
        // Jika navigasi dari halaman lain (booth/galeri), bersihkan sesi
        // dan tampilkan lock screen untuk autentikasi ulang.
        sessionStorage.removeItem('adminPin');
        showLockScreen(false);
      }
    }
  } catch (err) {
    console.error('Error saat autentikasi:', err);
    showCustomAlert("Kesalahan Sistem", "Gagal memverify status keamanan server.", "error");
  }
}

function setupLockScreenKeypad() {
  const pinInput = document.getElementById('pin-input');
  const keypadButtons = document.querySelectorAll('.keypad-btn');
  const submitBtn = document.getElementById('btn-submit-pin');
  
  keypadButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.getAttribute('data-val');
      if (val === 'del') {
        currentPinInput = currentPinInput.slice(0, -1);
      } else if (val === 'clear') {
        currentPinInput = "";
      } else {
        if (currentPinInput.length < 6) {
          currentPinInput += val;
        }
      }
      pinInput.value = currentPinInput;
    });
  });
  
  submitBtn.addEventListener('click', handlePinSubmit);
}

async function handlePinSubmit() {
  if (currentPinInput.length < 4 || currentPinInput.length > 6) {
    showCustomAlert("Input Tidak Valid", "PIN harus terdiri dari 4 sampai 6 digit angka.", "warning");
    return;
  }
  
  try {
    if (isLockSetupMode) {
      // Panggil setup PIN baru
      const res = await fetch(getApiUrl('/api/admin/setup-pin'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: currentPinInput })
      });
      
      if (res.ok) {
        sessionStorage.setItem('adminPin', currentPinInput);
        hideLockScreen();
        showCustomAlert("PIN Berhasil Dibuat", "PIN admin berhasil dikonfigurasi. Sesi Anda aktif.", "success");
        await checkAdminAuthentication();
      } else {
        const err = await res.json();
        showCustomAlert("Gagal Membuat PIN", err.error, "error");
      }
    } else {
      // Panggil verifikasi PIN
      const res = await fetch(getApiUrl('/api/admin/verify-pin'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: currentPinInput })
      });
      
      if (res.ok) {
        sessionStorage.setItem('adminPin', currentPinInput);
        hideLockScreen();
        await refreshAllData();
      } else {
        currentPinInput = "";
        document.getElementById('pin-input').value = "";
        showCustomAlert("Akses Ditolak", "PIN yang Anda masukkan salah.", "error");
      }
    }
  } catch (err) {
    console.error('Error memproses PIN:', err);
    showCustomAlert("Kesalahan Sistem", "Gagal memproses verifikasi PIN.", "error");
  }
}

// DOM Elements
const tabBtns = document.querySelectorAll('.admin-tab-btn');
const tabContents = document.querySelectorAll('.admin-tab-content');

// Forms & Cards
const addEventCard = document.getElementById('add-event-card');
const btnShowAddEvent = document.getElementById('btn-show-add-event');
const btnCancelAddEvent = document.getElementById('btn-cancel-add-event');
const formCreateEvent = document.getElementById('form-create-event');
const eventsTableBody = document.getElementById('events-table-body');
const eventTemplateSelect = document.getElementById('event-template');

const addTemplateCard = document.getElementById('add-template-card');
const btnShowAddTemplate = document.getElementById('btn-show-add-template');
const btnCancelAddTemplate = document.getElementById('btn-cancel-add-template');
const formUploadTemplate = document.getElementById('form-upload-template');
const templatesListGrid = document.getElementById('templates-list-grid');

const templateLayout = document.getElementById('template-layout');
const templateWidth = document.getElementById('template-width');
const templateHeight = document.getElementById('template-height');
const templateSlotsContainer = document.getElementById('template-slots-container');
const btnAddSlotInput = document.getElementById('btn-add-slot-input');
const templateLayering = document.getElementById('template-layering');
const btnCopySlot = document.getElementById('btn-copy-slot');
const btnPasteSlot = document.getElementById('btn-paste-slot');

// Copy-Paste State
let selectedSlotIndex = -1;
let copiedSlot = null;

const formConfig = document.getElementById('form-config');
const dslrEnabledCheckbox = document.getElementById('config-dslr-enabled');
const dslrFolderInput = document.getElementById('config-dslr-folder');
const dslrFolderGroup = document.getElementById('config-dslr-folder-group');
const driveEnabledCheckbox = document.getElementById('config-drive-enabled');
const driveDetails = document.getElementById('config-drive-details');
const driveFolderInput = document.getElementById('config-drive-folder');
const driveEmailInput = document.getElementById('config-drive-email');
const driveKeyInput = document.getElementById('config-drive-key');

// Sesi Kiosk Elements
const sessionLockEnabledCheckbox = document.getElementById('config-session-lock-enabled');
const sessionDurationInput = document.getElementById('config-session-duration');
const sessionDurationGroup = document.getElementById('config-session-duration-group');
const sessionPinsTableBody = document.getElementById('session-pins-table-body');
const btnGenerateSessionPin = document.getElementById('btn-generate-session-pin');
const customSessionPinInput = document.getElementById('custom-session-pin');
const btnAddCustomSessionPin = document.getElementById('btn-add-custom-session-pin');

// Background Image Elements
const inputBgFile = document.getElementById('input-bg-file');
const btnSelectBg = document.getElementById('btn-select-bg');
const btnResetBg = document.getElementById('btn-reset-bg');
const bgPreviewImg = document.getElementById('bg-preview-img');
const bgPreviewPlaceholder = document.getElementById('bg-preview-placeholder');

// Inisialisasi Admin Panel
document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  setupFormToggles();
  setupLockScreenKeypad();
  await checkAdminAuthentication();
  setupEventListeners();
  initWebSocket();
});

// Setup Tab Navigation
function setupTabs() {
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      // Hilangkan kelas active dari semua tombol dan tab content
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      // Aktifkan tab terpilih
      btn.classList.add('active');
      const tabId = btn.getAttribute('data-tab');
      document.getElementById(tabId).classList.add('active');
    });
  });
}

// Setup Toggles untuk input detail DSLR / Drive
function setupFormToggles() {
  dslrEnabledCheckbox.addEventListener('change', (e) => {
    dslrFolderGroup.style.display = e.target.checked ? 'flex' : 'none';
  });

  driveEnabledCheckbox.addEventListener('change', (e) => {
    driveDetails.style.display = e.target.checked ? 'block' : 'none';
  });

  sessionLockEnabledCheckbox.addEventListener('change', (e) => {
    sessionDurationGroup.style.display = e.target.checked ? 'flex' : 'none';
  });

  // Event Card Show/Hide
  btnShowAddEvent.addEventListener('click', () => {
    addEventCard.style.display = 'block';
    populateTemplateDropdown();
    
    // Set default date hari ini
    document.getElementById('event-date').value = new Date().toISOString().split('T')[0];
  });
  
  btnCancelAddEvent.addEventListener('click', () => {
    addEventCard.style.display = 'none';
    formCreateEvent.reset();
  });

  // Template Card Show/Hide
  btnShowAddTemplate.addEventListener('click', () => {
    addTemplateCard.style.display = 'block';
    selectedSlotIndex = -1;
    updateCopyPasteButtons();
    updateDefaultSlots(); // Hitung dan render default slots pertama kali
  });
  
  btnCancelAddTemplate.addEventListener('click', () => {
    addTemplateCard.style.display = 'none';
    formUploadTemplate.reset();
    formSlots = [];
    selectedSlotIndex = -1;
    updateCopyPasteButtons();
    const overlayImg = document.getElementById('visual-editor-overlay-img');
    if (overlayImg) {
      overlayImg.src = '';
      overlayImg.style.display = 'none';
    }
  });

  // Listener untuk memuat gambar overlay di visual workspace secara instan
  const templateFile = document.getElementById('template-file');
  const visualEditorWorkspace = document.getElementById('visual-editor-workspace');
  templateFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const overlayImg = document.getElementById('visual-editor-overlay-img');
        if (overlayImg) {
          overlayImg.src = event.target.result;
          overlayImg.style.display = 'block';
          updateVisualEditorLayering();
        }
      };
      reader.readAsDataURL(file);
    }
  });

  // Listener untuk Kategori Custom
  const templateCategorySelect = document.getElementById('template-category-select');
  const customCategoryGroup = document.getElementById('custom-category-group');
  const templateCategoryCustom = document.getElementById('template-category-custom');

  templateCategorySelect.addEventListener('change', (e) => {
    if (e.target.value === '__custom__') {
      customCategoryGroup.style.display = 'flex';
      templateCategoryCustom.required = true;
      templateCategoryCustom.focus();
    } else {
      customCategoryGroup.style.display = 'none';
      templateCategoryCustom.required = false;
      templateCategoryCustom.value = '';
    }
  });
}

// Mengambil Data terbaru dari API
async function refreshAllData() {
  await loadConfig();
  await loadTemplates();
  await loadEvents();
  await loadSessionPins();
  await loadPrintQueue();
}

async function loadConfig() {
  const res = await adminFetch('/api/config');
  adminState.config = await res.json();

  // Isi form konfigurasi
  dslrEnabledCheckbox.checked = adminState.config.dslrEnabled;
  dslrFolderInput.value = adminState.config.dslrHotFolder || '';
  dslrFolderGroup.style.display = adminState.config.dslrEnabled ? 'flex' : 'none';

  driveEnabledCheckbox.checked = adminState.config.googleDriveEnabled;
  driveFolderInput.value = adminState.config.googleDriveFolderId || '';
  driveEmailInput.value = adminState.config.googleDriveClientEmail || '';
  driveKeyInput.value = adminState.config.googleDrivePrivateKey || '';
  driveDetails.style.display = adminState.config.googleDriveEnabled ? 'block' : 'none';

  sessionLockEnabledCheckbox.checked = adminState.config.sessionLockEnabled;
  sessionDurationInput.value = adminState.config.sessionDuration || 5;
  sessionDurationGroup.style.display = adminState.config.sessionLockEnabled ? 'flex' : 'none';

  // Populate background preview
  if (adminState.config.backgroundImageUrl) {
    bgPreviewImg.src = adminState.config.backgroundImageUrl;
    bgPreviewImg.style.display = 'block';
    bgPreviewPlaceholder.style.display = 'none';
    btnResetBg.style.display = 'inline-flex';
  } else {
    bgPreviewImg.style.display = 'none';
    bgPreviewPlaceholder.style.display = 'block';
    btnResetBg.style.display = 'none';
  }

  // Populate printer config
  document.getElementById('config-printer-auto-print').checked = adminState.config.printerAutoPrint || false;
  document.getElementById('config-printer-paper-size').value = adminState.config.printerPaperSize || '4R';
  document.getElementById('config-printer-copies').value = adminState.config.printerCopies || 1;

  // Baru: Muat list printer
  await loadSystemPrinters();
}

async function loadEvents() {
  const res = await adminFetch('/api/events');
  adminState.events = await res.json();
  renderEventsTable();
}

async function loadTemplates() {
  const res = await adminFetch('/api/templates');
  adminState.templates = await res.json();
  renderTemplatesGrid();
}

// Render Tabel Event
function renderEventsTable() {
  eventsTableBody.innerHTML = '';
  
  if (adminState.events.length === 0) {
    eventsTableBody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: var(--text-muted);">Belum ada event. Buat event pertama Anda!</td>
      </tr>
    `;
    return;
  }

  adminState.events.forEach(event => {
    const tr = document.createElement('tr');
    
    const template = adminState.templates.find(t => t.id === event.templateId);
    const templateName = template ? template.name : 'Tidak Ditemukan';
    
    const isActive = event.id === adminState.config.activeEventId;
    const badge = isActive 
      ? '<span class="badge badge-active">AKTIF</span>' 
      : '<span class="badge badge-inactive">NON-AKTIF</span>';

    const actionBtn = isActive
      ? `<a href="/" class="btn-primary" style="padding: 0.35rem 0.75rem; font-size: 0.8rem; text-decoration: none;">Mulai Booth</a>`
      : `<button class="btn-secondary btn-set-active" data-id="${event.id}" style="padding: 0.35rem 0.75rem; font-size: 0.8rem;">Jadikan Aktif</button>`;

    tr.innerHTML = `
      <td style="font-weight: 600;">${event.name}</td>
      <td><code>${event.slug}</code></td>
      <td>${event.date}</td>
      <td>${templateName}</td>
      <td>${badge}</td>
      <td>
        <div style="display: flex; gap: 8px;">
          ${actionBtn}
          <a href="/gallery.html?event=${event.slug}" class="btn-secondary" style="padding: 0.35rem 0.75rem; font-size: 0.8rem;" target="_blank">Lihat Galeri</a>
        </div>
      </td>
    `;

    eventsTableBody.appendChild(tr);
  });

  // Tambahkan listener untuk tombol Set Active
  document.querySelectorAll('.btn-set-active').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const eventId = e.target.getAttribute('data-id');
      await setActiveEvent(eventId);
    });
  });
}

// Set Event Aktif di Booth
async function setActiveEvent(eventId) {
  try {
    const res = await adminFetch('/api/events/active', {
      method: 'POST',
      body: JSON.stringify({ id: eventId })
    });
    
    if (res.ok) {
      await refreshAllData();
    } else {
      const err = await res.json();
      showCustomAlert("Gagal Mengaktifkan Event", err.error, "error");
    }
  } catch (err) {
    console.error('Error setting active event:', err);
  }
}

// Populate Dropdown Template
function populateTemplateDropdown() {
  eventTemplateSelect.innerHTML = '';
  adminState.templates.forEach(t => {
    const option = document.createElement('option');
    option.value = t.id;
    option.textContent = `${t.name} (${t.layoutType})`;
    eventTemplateSelect.appendChild(option);
  });
}

// Render Grid Template
function renderTemplatesGrid() {
  templatesListGrid.innerHTML = '';
  
  if (adminState.templates.length === 0) {
    templatesListGrid.innerHTML = '<p style="color: var(--text-muted);">Belum ada template yang diunggah.</p>';
    return;
  }

  adminState.templates.forEach(t => {
    const card = document.createElement('div');
    card.className = 'glass-panel';
    card.style.padding = '1rem';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.gap = '8px';

    card.innerHTML = `
      <div style="aspect-ratio: 3/4; background: #1a1a24; border-radius: 12px; overflow: hidden; display: flex; align-items: center; justify-content: center; border: 1px solid var(--glass-border);">
        <img src="${getAssetUrl(t.overlayUrl)}" style="max-width: 100%; max-height: 100%; object-fit: contain;" alt="${t.name}">
      </div>
      <h4 style="font-size: 1rem; margin-top: 5px; color: var(--text-main);">${t.name}</h4>
      <div style="font-size: 0.8rem; color: var(--text-muted); line-height: 1.5; flex-grow: 1;">
        Layout: <code>${t.layoutType}</code><br>
        Ukuran: ${t.width} x ${t.height} px<br>
        Kategori: <span class="badge badge-active" style="display: inline-block; font-size: 0.75rem; padding: 0.15rem 0.5rem; margin-top: 4px; text-transform: capitalize;">${t.category || 'ceria'}</span>
      </div>
      <button class="btn-secondary btn-delete-template" data-id="${t.id}" style="padding: 0.45rem 1rem; font-size: 0.85rem; border-color: #ef4444; color: #ef4444; background: rgba(239, 68, 68, 0.05); border-radius: 12px; margin-top: 10px; width: 100%; justify-content: center;">Hapus 🗑️</button>
    `;

    // Pasang listener untuk tombol hapus
    const btnDelete = card.querySelector('.btn-delete-template');
    btnDelete.addEventListener('click', async () => {
      const confirmed = await showCustomConfirm(
        "Hapus Template?",
        `Apakah Anda yakin ingin menghapus template "${t.name}"? File template ini akan dihapus secara permanen dari disk.`,
        "Ya, Hapus",
        "Batal",
        "🗑️"
      );

      if (confirmed) {
        try {
          const res = await adminFetch(`/api/templates/${t.id}`, {
            method: 'DELETE'
          });

          if (res.ok) {
            showCustomAlert("Template Dihapus", `Template "${t.name}" berhasil dihapus.`, "success");
            await refreshAllData();
          } else {
            const err = await res.json();
            showCustomAlert("Gagal Menghapus", err.error || "Gagal menghapus template dari server.", "error");
          }
        } catch (err) {
          console.error('Error deleting template:', err);
          showCustomAlert("Kesalahan Sistem", "Terjadi kesalahan koneksi saat menghapus template.", "error");
        }
      }
    });

    templatesListGrid.appendChild(card);
  });
}

// Setup Event Listeners untuk Form Submission
function setupEventListeners() {
  
  // Submit Config
  formConfig.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const body = {
      dslrEnabled: dslrEnabledCheckbox.checked,
      dslrHotFolder: dslrFolderInput.value,
      googleDriveEnabled: driveEnabledCheckbox.checked,
      googleDriveFolderId: driveFolderInput.value,
      googleDriveClientEmail: driveEmailInput.value,
      googleDrivePrivateKey: driveKeyInput.value,
      sessionLockEnabled: sessionLockEnabledCheckbox.checked,
      sessionDuration: parseInt(sessionDurationInput.value) || 5,
      printerAutoPrint: document.getElementById('config-printer-auto-print').checked,
      printerPaperSize: document.getElementById('config-printer-paper-size').value,
      printerCopies: parseInt(document.getElementById('config-printer-copies').value) || 1,
      activePrinter: document.getElementById('config-printer-active').value
    };

    try {
      const res = await adminFetch('/api/config', {
        method: 'POST',
        body: JSON.stringify(body)
      });

      if (res.ok) {
        showCustomAlert("Konfigurasi Disimpan", "Konfigurasi perangkat dan sinkronisasi berhasil disimpan!", "success");
        await refreshAllData();
      } else {
        showCustomAlert("Gagal Menyimpan", "Gagal menyimpan data konfigurasi ke server.", "error");
      }
    } catch (err) {
      console.error(err);
      showCustomAlert("Kesalahan Koneksi", "Terjadi kesalahan koneksi ke server.", "error");
    }
  });

  // Submit Create Event
  formCreateEvent.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const body = {
      name: document.getElementById('event-name').value,
      slug: document.getElementById('event-slug').value,
      date: document.getElementById('event-date').value,
      templateId: document.getElementById('event-template').value
    };

    try {
      const res = await adminFetch('/api/events', {
        method: 'POST',
        body: JSON.stringify(body)
      });

      if (res.ok) {
        showCustomAlert("Event Ditambahkan", "Event baru berhasil dibuat dan disimpan!", "success");
        addEventCard.style.display = 'none';
        formCreateEvent.reset();
        await refreshAllData();
      } else {
        const err = await res.json();
        showCustomAlert("Gagal Menyimpan Event", err.error, "error");
      }
    } catch (err) {
      console.error(err);
      showCustomAlert("Kesalahan Koneksi", "Terjadi kesalahan koneksi ke server.", "error");
    }
  });

  // Submit Upload Template
  formUploadTemplate.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Hitung nilai kategori
    const categorySelect = document.getElementById('template-category-select').value;
    const customCategory = document.getElementById('template-category-custom').value;
    const categoryValue = categorySelect === '__custom__' ? customCategory.trim().toLowerCase() : categorySelect;

    const formData = new FormData();
    formData.append('name', document.getElementById('template-name').value);
    formData.append('layoutType', document.getElementById('template-layout').value);
    formData.append('width', document.getElementById('template-width').value);
    formData.append('height', document.getElementById('template-height').value);
    formData.append('overlay', document.getElementById('template-file').files[0]);
    formData.append('slots', JSON.stringify(formSlots));
    formData.append('frameLayering', templateLayering.value);
    formData.append('category', categoryValue || 'ceria');

    try {
      const res = await adminFetch('/api/templates', {
        method: 'POST',
        body: formData
      });

      if (res.ok) {
        showCustomAlert("Template Diunggah", "Template kolase baru berhasil diunggah!", "success");
        addTemplateCard.style.display = 'none';
        formUploadTemplate.reset();
        await refreshAllData();
      } else {
        const err = await res.json();
        showCustomAlert("Gagal Mengunggah Template", err.error, "error");
      }
    } catch (err) {
      console.error(err);
      showCustomAlert("Kesalahan Koneksi", "Terjadi kesalahan koneksi ke server.", "error");
    }
  });

  // Submit Change PIN
  const formChangePin = document.getElementById('form-change-pin');
  formChangePin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const oldPin = document.getElementById('old-pin').value;
    const newPin = document.getElementById('new-pin').value;
    const confirmNewPin = document.getElementById('confirm-new-pin').value;

    if (newPin !== confirmNewPin) {
      showCustomAlert("PIN Tidak Cocok", "Konfirmasi PIN baru tidak cocok.", "warning");
      return;
    }

    try {
      const res = await adminFetch('/api/admin/change-pin', {
        method: 'POST',
        body: JSON.stringify({ oldPin, newPin })
      });

      if (res.ok) {
        sessionStorage.setItem('adminPin', newPin);
        showCustomAlert("PIN Diubah", "PIN Admin Keamanan berhasil diubah!", "success");
        formChangePin.reset();
        await checkAdminAuthentication();
      } else {
        const err = await res.json();
        showCustomAlert("Gagal Mengubah PIN", err.error, "error");
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Logout Button
  const btnLogout = document.getElementById('btn-logout');
  btnLogout.addEventListener('click', (e) => {
    e.preventDefault();
    sessionStorage.removeItem('adminPin');
    window.location.reload();
  });

  // Listener perubahan layout & dimensi template
  templateLayout.addEventListener('change', () => {
    selectedSlotIndex = -1;
    updateCopyPasteButtons();
    updateDefaultSlots();
  });
  templateWidth.addEventListener('input', () => {
    selectedSlotIndex = -1;
    updateCopyPasteButtons();
    updateDefaultSlots();
  });
  templateHeight.addEventListener('input', () => {
    selectedSlotIndex = -1;
    updateCopyPasteButtons();
    updateDefaultSlots();
  });

  // Tambah slot manual
  btnAddSlotInput.addEventListener('click', () => {
    const w = parseInt(templateWidth.value) || 1205;
    const h = parseInt(templateHeight.value) || 1795;
    formSlots.push({ 
      x: 100, 
      y: 100, 
      width: Math.round(w * 0.4), 
      height: Math.round(h * 0.2) 
    });
    selectedSlotIndex = formSlots.length - 1;
    renderSlotInputs();
    updateCopyPasteButtons();
  });

  // Copy Paste button listeners
  btnCopySlot.addEventListener('click', copySlot);
  btnPasteSlot.addEventListener('click', pasteSlot);

  // Layering change listener
  templateLayering.addEventListener('change', updateVisualEditorLayering);

  // Generate random PIN Sesi
  btnGenerateSessionPin.addEventListener('click', async () => {
    try {
      const res = await adminFetch('/api/session/pins', {
        method: 'POST',
        body: JSON.stringify({})
      });
      if (res.ok) {
        const data = await res.json();
        showCustomAlert("PIN Sesi Dibuat", `PIN Sesi: ${data.pin.pin} berhasil dibuat. Silakan salin dan berikan ke pelanggan.`, "success");
        await loadSessionPins();
      } else {
        showCustomAlert("Gagal", "Gagal membuat PIN sesi baru.", "error");
      }
    } catch (err) {
      console.error(err);
      showCustomAlert("Kesalahan Koneksi", "Gagal terhubung ke server.", "error");
    }
  });

  // Tambah custom PIN Sesi
  btnAddCustomSessionPin.addEventListener('click', async () => {
    const pinVal = customSessionPinInput.value.trim();
    if (!/^\d{4,6}$/.test(pinVal)) {
      showCustomAlert("PIN Tidak Valid", "PIN kustom harus berupa 4 sampai 6 digit angka.", "warning");
      return;
    }
    try {
      const res = await adminFetch('/api/session/pins', {
        method: 'POST',
        body: JSON.stringify({ customPin: pinVal })
      });
      if (res.ok) {
        showCustomAlert("PIN Kustom Ditambahkan", `PIN Sesi: ${pinVal} berhasil disimpan.`, "success");
        customSessionPinInput.value = "";
        await loadSessionPins();
      } else {
        const err = await res.json();
        showCustomAlert("Gagal", err.error || "Gagal menambahkan PIN kustom.", "error");
      }
    } catch (err) {
      console.error(err);
      showCustomAlert("Kesalahan Koneksi", "Gagal terhubung ke server.", "error");
    }
  });

  // Background Image Upload & Reset Click Handlers
  btnSelectBg.addEventListener('click', () => inputBgFile.click());

  inputBgFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('backgroundImage', file);

    try {
      const res = await adminFetch('/api/config/background', {
        method: 'POST',
        body: formData
      });

      if (res.ok) {
        showCustomAlert("Berhasil", "Gambar latar belakang kiosk berhasil diperbarui!", "success");
        await refreshAllData();
      } else {
        const err = await res.json();
        showCustomAlert("Gagal", err.error || "Gagal mengunggah gambar latar belakang.", "error");
      }
    } catch (err) {
      console.error(err);
      showCustomAlert("Kesalahan Koneksi", "Gagal menghubungi server.", "error");
    }
  });

  btnResetBg.addEventListener('click', async () => {
    const confirmed = await showCustomConfirm(
      "Reset Latar Belakang?",
      "Apakah Anda yakin ingin menghapus gambar latar belakang kustom dan kembali ke default?",
      "Ya, Reset",
      "Batal",
      "🔄"
    );
    if (!confirmed) return;
    try {
      const res = await adminFetch('/api/config/background', {
        method: 'DELETE'
      });

      if (res.ok) {
        showCustomAlert("Berhasil", "Latar belakang kiosk di-reset ke default.", "success");
        await refreshAllData();
      } else {
        showCustomAlert("Gagal", "Gagal me-reset latar belakang.", "error");
      }
    } catch (err) {
      console.error(err);
      showCustomAlert("Kesalahan Koneksi", "Gagal terhubung ke server.", "error");
    }
  });

  // Listener tombol refresh antrean cetak
  const btnRefreshPrintQueue = document.getElementById('btn-refresh-print-queue');
  if (btnRefreshPrintQueue) {
    btnRefreshPrintQueue.addEventListener('click', async () => {
      await loadPrintQueue();
      showToastNotification("Antrean cetak diperbarui!");
    });
  }

  // Listener checkbox toggle-local-print
  const toggleLocalPrint = document.getElementById('toggle-local-print');
  if (toggleLocalPrint) {
    toggleLocalPrint.checked = adminState.localPrintingEnabled;
    toggleLocalPrint.addEventListener('change', (e) => {
      adminState.localPrintingEnabled = e.target.checked;
      localStorage.setItem('dfia_local_print', e.target.checked);
      showToastNotification(e.target.checked ? "Printer lokal diaktifkan pada perangkat ini" : "Printer lokal dinonaktifkan pada perangkat ini");
    });
  }
}

// ================= HELPER SLOT EDITOR DYNAMIC & VISUAL =================
let formSlots = [];

function renderSlotInputs() {
  templateSlotsContainer.innerHTML = '';
  
  if (formSlots.length === 0) {
    templateSlotsContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem; padding: 10px 0;">Belum ada slot foto yang ditentukan.</p>';
    renderVisualSlots();
    return;
  }

  formSlots.forEach((slot, index) => {
    const row = document.createElement('div');
    row.className = `slot-input-row ${index === selectedSlotIndex ? 'active' : ''}`;

    row.innerHTML = `
      <div style="font-weight: 600; font-size: 0.85rem; color: var(--accent-cyan);">Slot #${index + 1}</div>
      <div class="form-group" style="margin-bottom: 0;">
        <input type="number" class="form-input slot-x" style="padding: 0.5rem;" value="${slot.x}" placeholder="X" required>
      </div>
      <div class="form-group" style="margin-bottom: 0;">
        <input type="number" class="form-input slot-y" style="padding: 0.5rem;" value="${slot.y}" placeholder="Y" required>
      </div>
      <div class="form-group" style="margin-bottom: 0;">
        <input type="number" class="form-input slot-w" style="padding: 0.5rem;" value="${slot.width}" placeholder="Lebar" required>
      </div>
      <div class="form-group" style="margin-bottom: 0;">
        <input type="number" class="form-input slot-h" style="padding: 0.5rem;" value="${slot.height}" placeholder="Tinggi" required>
      </div>
      <button type="button" class="btn-secondary btn-duplicate-slot" style="padding: 0.4rem; font-size: 0.8rem; border-radius: 8px; justify-content: center; width: 100%; border-color: var(--accent-cyan); color: var(--accent-cyan);">Duplikat</button>
      <button type="button" class="btn-danger btn-delete-slot" style="padding: 0.4rem; font-size: 0.8rem; border-radius: 8px; justify-content: center; width: 100%;">X</button>
    `;

    row.addEventListener('click', (e) => {
      if (e.target.classList.contains('btn-delete-slot') || e.target.classList.contains('btn-duplicate-slot')) return;
      
      selectedSlotIndex = index;
      
      document.querySelectorAll('.slot-input-row').forEach((r, idx) => {
        if (idx === index) r.classList.add('active');
        else r.classList.remove('active');
      });
      
      document.querySelectorAll('.editor-slot-box').forEach((box, idx) => {
        if (idx === index) box.classList.add('active');
        else box.classList.remove('active');
      });
      
      updateCopyPasteButtons();
    });

    // Pasang listener untuk update array formSlots ketika input diubah + update editor visual
    row.querySelector('.slot-x').addEventListener('input', (e) => { 
      formSlots[index].x = parseInt(e.target.value) || 0; 
      renderVisualSlots();
    });
    row.querySelector('.slot-y').addEventListener('input', (e) => { 
      formSlots[index].y = parseInt(e.target.value) || 0; 
      renderVisualSlots();
    });
    row.querySelector('.slot-w').addEventListener('input', (e) => { 
      formSlots[index].width = parseInt(e.target.value) || 0; 
      renderVisualSlots();
    });
    row.querySelector('.slot-h').addEventListener('input', (e) => { 
      formSlots[index].height = parseInt(e.target.value) || 0; 
      renderVisualSlots();
    });

    row.querySelector('.btn-duplicate-slot').addEventListener('click', (e) => {
      e.stopPropagation();
      const currentW = parseInt(templateWidth.value) || 1205;
      const currentH = parseInt(templateHeight.value) || 1795;
      formSlots.push({
        x: Math.min(currentW - slot.width, slot.x + 25),
        y: Math.min(currentH - slot.height, slot.y + 25),
        width: slot.width,
        height: slot.height
      });
      selectedSlotIndex = formSlots.length - 1;
      renderSlotInputs();
      updateCopyPasteButtons();
    });

    row.querySelector('.btn-delete-slot').addEventListener('click', (e) => {
      e.stopPropagation();
      formSlots.splice(index, 1);
      if (selectedSlotIndex === index) {
        selectedSlotIndex = -1;
      } else if (selectedSlotIndex > index) {
        selectedSlotIndex--;
      }
      renderSlotInputs();
      updateCopyPasteButtons();
    });

    templateSlotsContainer.appendChild(row);
  });

  // Gambar ulang workspace editor visual
  renderVisualSlots();
}

function updateDefaultSlots() {
  const layout = templateLayout.value;
  const w = parseInt(templateWidth.value) || 1205;
  const h = parseInt(templateHeight.value) || 1795;

  if (layout === 'strip_3') {
    formSlots = [
      { x: Math.round(w * 0.083), y: Math.round(h * 0.044), width: Math.round(w * 0.833), height: Math.round(h * 0.208) },
      { x: Math.round(w * 0.083), y: Math.round(h * 0.28), width: Math.round(w * 0.833), height: Math.round(h * 0.208) },
      { x: Math.round(w * 0.083), y: Math.round(h * 0.516), width: Math.round(w * 0.833), height: Math.round(h * 0.208) }
    ];
  } else if (layout === 'grid_2x2') {
    formSlots = [
      { x: Math.round(w * 0.067), y: Math.round(h * 0.055), width: Math.round(w * 0.4), height: Math.round(h * 0.2) },
      { x: Math.round(w * 0.533), y: Math.round(h * 0.055), width: Math.round(w * 0.4), height: Math.round(h * 0.2) },
      { x: Math.round(w * 0.067), y: Math.round(h * 0.311), width: Math.round(w * 0.4), height: Math.round(h * 0.2) },
      { x: Math.round(w * 0.533), y: Math.round(h * 0.311), width: Math.round(w * 0.4), height: Math.round(h * 0.2) }
    ];
  } else if (layout === 'single') {
    formSlots = [
      { x: Math.round(w * 0.083), y: Math.round(h * 0.055), width: Math.round(w * 0.833), height: Math.round(h * 0.75) }
    ];
  } else {
    // Custom Layout (Berikan slot default tunggal untuk diedit)
    formSlots = [{ x: 100, y: 100, width: Math.round(w * 0.8), height: Math.round(h * 0.5) }];
  }

  renderSlotInputs();
}

function renderVisualSlots() {
  const workspace = document.getElementById('visual-editor-workspace');
  
  // Clear only slot box elements, leave the overlay image intact
  const oldBoxes = workspace.querySelectorAll('.editor-slot-box');
  oldBoxes.forEach(box => box.remove());

  const w = parseInt(templateWidth.value) || 1205;
  const h = parseInt(templateHeight.value) || 1795;

  // Hitung skala workspace agar fit di 320x480
  const maxW = 320;
  const maxH = 480;
  const ratio = w / h;
  let W_work, H_work;

  if (ratio > maxW / maxH) {
    W_work = maxW;
    H_work = maxW / ratio;
  } else {
    H_work = maxH;
    W_work = maxH * ratio;
  }

  workspace.style.width = `${W_work}px`;
  workspace.style.height = `${H_work}px`;
  const scale = W_work / w;

  formSlots.forEach((slot, index) => {
    const box = document.createElement('div');
    box.className = `editor-slot-box ${index === selectedSlotIndex ? 'active' : ''}`;
    box.textContent = `Slot #${index + 1}`;
    
    // Set koordinat visual
    box.style.left = `${Math.round(slot.x * scale)}px`;
    box.style.top = `${Math.round(slot.y * scale)}px`;
    box.style.width = `${Math.round(slot.width * scale)}px`;
    box.style.height = `${Math.round(slot.height * scale)}px`;

    // Handle untuk resize di sudut kanan bawah
    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    box.appendChild(handle);

    // MOUSE DRAG LOGIC (Pindahkan Box)
    box.addEventListener('mousedown', (e) => {
      // Abaikan jika klik berasal dari tombol resize handle
      if (e.target === handle) return;
      
      e.preventDefault();
      
      selectedSlotIndex = index;
      updateCopyPasteButtons();
      
      // Set aktif
      document.querySelectorAll('.editor-slot-box').forEach(b => b.classList.remove('active'));
      box.classList.add('active');

      // Highlight table row
      document.querySelectorAll('.slot-input-row').forEach((r, idx) => {
        if (idx === index) r.classList.add('active');
        else r.classList.remove('active');
      });

      const startX = e.clientX;
      const startY = e.clientY;
      const initialLeft = parseInt(box.style.left) || 0;
      const initialTop = parseInt(box.style.top) || 0;

      const onMouseMove = (moveEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;

        let newLeft = initialLeft + deltaX;
        let newTop = initialTop + deltaY;

        // Batasi di dalam workspace
        newLeft = Math.max(0, Math.min(W_work - parseInt(box.style.width), newLeft));
        newTop = Math.max(0, Math.min(H_work - parseInt(box.style.height), newTop));

        box.style.left = `${newLeft}px`;
        box.style.top = `${newTop}px`;

        // Update data asli & input kolom angka
        slot.x = Math.round(newLeft / scale);
        slot.y = Math.round(newTop / scale);
        
        // Update input secara langsung di UI baris slot
        const row = templateSlotsContainer.children[index];
        if (row) {
          row.querySelector('.slot-x').value = slot.x;
          row.querySelector('.slot-y').value = slot.y;
        }
      };

      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });

    // MOUSE RESIZE LOGIC (Ubah Ukuran Box)
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation(); // Cegah drag terpicu

      selectedSlotIndex = index;
      updateCopyPasteButtons();

      // Set aktif
      document.querySelectorAll('.editor-slot-box').forEach(b => b.classList.remove('active'));
      box.classList.add('active');

      // Highlight table row
      document.querySelectorAll('.slot-input-row').forEach((r, idx) => {
        if (idx === index) r.classList.add('active');
        else r.classList.remove('active');
      });

      const startX = e.clientX;
      const startY = e.clientY;
      const initialWidth = parseInt(box.style.width) || 50;
      const initialHeight = parseInt(box.style.height) || 50;

      const onMouseMove = (moveEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;

        let newWidth = initialWidth + deltaX;
        let newHeight = initialHeight + deltaY;

        // Batasi ukuran minimal
        newWidth = Math.max(30, Math.min(W_work - parseInt(box.style.left), newWidth));
        newHeight = Math.max(30, Math.min(H_work - parseInt(box.style.top), newHeight));

        box.style.width = `${newWidth}px`;
        box.style.height = `${newHeight}px`;

        // Update data asli & input kolom angka
        slot.width = Math.round(newWidth / scale);
        slot.height = Math.round(newHeight / scale);

        // Update input secara langsung di UI baris slot
        const row = templateSlotsContainer.children[index];
        if (row) {
          row.querySelector('.slot-w').value = slot.width;
          row.querySelector('.slot-h').value = slot.height;
        }
      };

      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });

    workspace.appendChild(box);
  });
  
  // Update visual editor layering index
  updateVisualEditorLayering();
}

// ================= COPY & PASTE FUNCTIONS =================

function updateCopyPasteButtons() {
  if (btnCopySlot) {
    btnCopySlot.disabled = (selectedSlotIndex < 0 || selectedSlotIndex >= formSlots.length);
  }
  if (btnPasteSlot) {
    btnPasteSlot.disabled = !copiedSlot;
  }
}

function copySlot() {
  if (selectedSlotIndex >= 0 && selectedSlotIndex < formSlots.length) {
    copiedSlot = JSON.parse(JSON.stringify(formSlots[selectedSlotIndex]));
    updateCopyPasteButtons();
  }
}

function pasteSlot() {
  if (copiedSlot) {
    const w = parseInt(templateWidth.value) || 1205;
    const h = parseInt(templateHeight.value) || 1795;
    const newSlot = {
      x: Math.min(w - copiedSlot.width, copiedSlot.x + 25),
      y: Math.min(h - copiedSlot.height, copiedSlot.y + 25),
      width: copiedSlot.width,
      height: copiedSlot.height
    };
    formSlots.push(newSlot);
    selectedSlotIndex = formSlots.length - 1;
    renderSlotInputs();
    updateCopyPasteButtons();
  }
}

// Keyboard Shortcuts for Copy and Paste
window.addEventListener('keydown', (e) => {
  // Hanya jalankan jika form template sedang aktif / terlihat
  if (addTemplateCard && addTemplateCard.style.display === 'block') {
    // Abaikan jika fokus berada di input teks/angka (agar ketikan biasa tidak memicu shortcut)
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT' || document.activeElement.tagName === 'TEXTAREA')) {
      return;
    }
    
    if (e.ctrlKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      copySlot();
    } else if (e.ctrlKey && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      pasteSlot();
    }
  }
});

// Update visual editor layering dynamically based on selected option
function updateVisualEditorLayering() {
  const visualEditorOverlayImg = document.getElementById('visual-editor-overlay-img');
  if (!visualEditorOverlayImg) return;
  
  const layering = templateLayering.value; // 'behind' or 'front'
  if (layering === 'front') {
    // Foto di depan frame, maka gambar frame/overlay di belakang foto (z-index 1)
    visualEditorOverlayImg.style.zIndex = '1';
    document.querySelectorAll('.editor-slot-box').forEach(box => {
      box.style.zIndex = '2';
    });
  } else {
    // Foto di belakang frame, maka gambar frame/overlay di depan foto (z-index 3)
    visualEditorOverlayImg.style.zIndex = '3';
    document.querySelectorAll('.editor-slot-box').forEach(box => {
      box.style.zIndex = '2';
    });
  }
}

// Elegant Custom Alert Modal System
function showCustomAlert(title, message, type = 'success') {
  // Remove existing custom alert if any
  const existingAlert = document.getElementById('custom-alert-overlay');
  if (existingAlert) {
    existingAlert.remove();
  }

  // Create overlay container
  const overlay = document.createElement('div');
  overlay.id = 'custom-alert-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(5, 5, 8, 0.7);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 99999;
    opacity: 0;
    transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  `;

  // Determine accent color based on type
  let accentColor = 'var(--accent-purple)';
  if (type === 'error' || type === 'danger') accentColor = '#ef4444';
  if (type === 'warning') accentColor = '#f59e0b';
  if (type === 'success') accentColor = '#10b981';

  // Create alert box
  const alertBox = document.createElement('div');
  alertBox.className = 'glass-panel';
  alertBox.style.cssText = `
    max-width: 450px;
    width: 90%;
    padding: 2.5rem 2rem;
    border-radius: 24px;
    text-align: center;
    border: 1px solid var(--glass-border);
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    background: rgba(20, 21, 35, 0.85);
    transform: scale(0.9);
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  `;

  alertBox.innerHTML = `
    <div style="font-size: 3.5rem; margin-bottom: 1rem;">
      ${type === 'success' ? '✨' : type === 'error' || type === 'danger' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️'}
    </div>
    <h3 style="font-family: 'Outfit', sans-serif; font-size: 1.5rem; font-weight: 700; margin-bottom: 0.75rem; background: linear-gradient(to right, #ffffff, ${accentColor}); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">
      ${title}
    </h3>
    <p style="color: var(--text-muted); font-size: 0.95rem; line-height: 1.6; margin-bottom: 1.75rem;">
      ${message}
    </p>
    <button class="btn-primary" style="padding: 0.75rem 2.5rem; font-size: 0.95rem; border-radius: 14px; background: linear-gradient(135deg, ${accentColor} 0%, #6366f1 100%); width: 100%; justify-content: center;">
      Oke
    </button>
  `;

  overlay.appendChild(alertBox);
  document.body.appendChild(overlay);

  // Trigger animation
  setTimeout(() => {
    overlay.style.opacity = '1';
    alertBox.style.transform = 'scale(1)';
  }, 10);

  // Close helper
  const closeAlert = () => {
    overlay.style.opacity = '0';
    alertBox.style.transform = 'scale(0.9)';
    setTimeout(() => {
      overlay.remove();
    }, 300);
  };

  alertBox.querySelector('button').addEventListener('click', closeAlert);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeAlert();
    }
  });
}

// Elegant Custom Confirmation Modal System (Returns Promise)
function showCustomConfirm(title, message, confirmText = "Ya", cancelText = "Batal", emoji = "❓") {
  return new Promise((resolve) => {
    // Remove existing custom overlay if any
    const existingOverlay = document.getElementById('custom-confirm-overlay');
    if (existingOverlay) {
      existingOverlay.remove();
    }

    // Create overlay container
    const overlay = document.createElement('div');
    overlay.id = 'custom-confirm-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(5, 5, 8, 0.7);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 99999;
      opacity: 0;
      transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    `;

    // Create confirm box
    const confirmBox = document.createElement('div');
    confirmBox.className = 'glass-panel';
    confirmBox.style.cssText = `
      max-width: 450px;
      width: 90%;
      padding: 2.5rem 2rem;
      border-radius: 24px;
      text-align: center;
      border: 1px solid var(--glass-border);
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
      background: rgba(20, 21, 35, 0.95);
      transform: scale(0.9);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    `;

    confirmBox.innerHTML = `
      <div style="font-size: 3.5rem; margin-bottom: 1rem; display: inline-block;">
        ${emoji}
      </div>
      <h3 style="font-family: 'Outfit', sans-serif; font-size: 1.5rem; font-weight: 700; margin-bottom: 0.75rem; background: linear-gradient(to right, #ffffff, var(--accent-cyan)); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">
        ${title}
      </h3>
      <p style="color: var(--text-muted); font-size: 0.95rem; line-height: 1.6; margin-bottom: 1.75rem;">
        ${message}
      </p>
      <div style="display: flex; gap: 12px; width: 100%; justify-content: center;">
        <button id="custom-confirm-btn-cancel" class="btn-secondary" style="flex: 1; padding: 0.8rem; font-size: 0.95rem; border-radius: 14px; justify-content: center; border-color: rgba(255,255,255,0.1); margin: 0;">
          ${cancelText}
        </button>
        <button id="custom-confirm-btn-ok" class="btn-primary" style="flex: 1; padding: 0.8rem; font-size: 0.95rem; border-radius: 14px; justify-content: center; background: linear-gradient(135deg, var(--accent-purple) 0%, #6366f1 100%); box-shadow: none; margin: 0;">
          ${confirmText}
        </button>
      </div>
    `;

    overlay.appendChild(confirmBox);
    document.body.appendChild(overlay);

    // Trigger animation
    setTimeout(() => {
      overlay.style.opacity = '1';
      confirmBox.style.transform = 'scale(1)';
    }, 10);

    // Close helper
    const closeConfirm = (result) => {
      overlay.style.opacity = '0';
      confirmBox.style.transform = 'scale(0.9)';
      setTimeout(() => {
        overlay.remove();
        resolve(result);
      }, 300);
    };

    document.getElementById('custom-confirm-btn-cancel').addEventListener('click', () => closeConfirm(false));
    document.getElementById('custom-confirm-btn-ok').addEventListener('click', () => closeConfirm(true));
  });
}

// ================= MANAGING SESSION PINS =================

async function loadSessionPins() {
  try {
    const res = await adminFetch('/api/session/pins');
    const pins = await res.json();
    renderSessionPins(pins);
  } catch (err) {
    console.error('Gagal memuat PIN sesi:', err);
  }
}

function renderSessionPins(pins) {
  sessionPinsTableBody.innerHTML = '';
  
  const activePins = pins.filter(p => p.status === 'unused');
  
  if (activePins.length === 0) {
    sessionPinsTableBody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">Belum ada PIN sesi aktif. Klik 'Buat PIN Sesi Baru' di atas!</td>
      </tr>
    `;
    return;
  }

  activePins.forEach(p => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--glass-border)';
    
    const formattedDate = new Date(p.createdAt).toLocaleString('id-ID', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });

    tr.innerHTML = `
      <td style="padding: 0.75rem 1rem; font-weight: 700; font-family: monospace; font-size: 1.1rem; color: var(--accent-cyan);">${p.pin}</td>
      <td style="padding: 0.75rem 1rem; color: var(--text-secondary);">${formattedDate}</td>
      <td style="padding: 0.75rem 1rem;"><span class="badge badge-active" style="background: rgba(76, 201, 240, 0.12); border-color: rgba(76, 201, 240, 0.25); color: var(--accent-cyan);">AKTIF</span></td>
      <td style="padding: 0.75rem 1rem; text-align: center;">
        <button class="btn-danger btn-delete-session-pin" data-pin="${p.pin}" style="padding: 0.3rem 0.6rem; font-size: 0.75rem; border-radius: 8px;">Hapus 🗑️</button>
      </td>
    `;
    
    sessionPinsTableBody.appendChild(tr);
  });
  
  document.querySelectorAll('.btn-delete-session-pin').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pin = btn.getAttribute('data-pin');
      const confirmed = await showCustomConfirm(
        "Hapus PIN Sesi?",
        `Apakah Anda yakin ingin menghapus PIN sesi "${pin}"? PIN ini tidak akan bisa digunakan lagi.`,
        "Ya, Hapus",
        "Batal",
        "🗑️"
      );
      if (!confirmed) return;
      try {
        const res = await adminFetch(`/api/session/pins/${pin}`, { method: 'DELETE' });
        if (res.ok) {
          showCustomAlert("PIN Dihapus", "PIN sesi berhasil dihapus.", "success");
          await loadSessionPins();
        } else {
          showCustomAlert("Gagal Menghapus", "Terjadi kesalahan saat menghapus PIN.", "error");
        }
      } catch (err) {
        console.error(err);
        showCustomAlert("Kesalahan Koneksi", "Gagal menghubungi server.", "error");
      }
    });
  });
}

// ================= PRINT QUEUE MANAGEMENT & WEBSOCKET =================

async function loadPrintQueue() {
  try {
    const res = await adminFetch('/api/print/queue');
    const queue = await res.json();
    adminState.printQueue = queue;
    renderPrintQueue();
  } catch (err) {
    console.error('Gagal memuat antrean cetak:', err);
  }
}

function renderPrintQueue() {
  const grid = document.getElementById('print-queue-grid');
  const empty = document.getElementById('print-queue-empty');
  const badge = document.getElementById('print-queue-badge');
  
  if (!grid) return;
  
  grid.innerHTML = '';
  const pendingRequests = adminState.printQueue || [];
  
  // Update badge count
  if (badge) {
    if (pendingRequests.length > 0) {
      badge.textContent = pendingRequests.length;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }
  
  if (pendingRequests.length === 0) {
    if (empty) empty.style.display = 'block';
    grid.style.display = 'none';
    return;
  }
  
  if (empty) empty.style.display = 'none';
  grid.style.display = 'grid';
  
  pendingRequests.forEach(req => {
    const card = document.createElement('div');
    card.className = 'glass-panel print-request-card';
    card.style.cssText = `
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 12px;
      position: relative;
      border: 1px solid var(--glass-border);
      transition: transform 0.3s ease, box-shadow 0.3s ease;
    `;
    
    // Format timestamp
    const formattedTime = new Date(req.createdAt).toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    card.innerHTML = `
      <div style="aspect-ratio: 3/4; background: #1a1a24; border-radius: 14px; overflow: hidden; display: flex; align-items: center; justify-content: center; border: 1px solid var(--glass-border); position: relative; cursor: zoom-in;" class="preview-img-container">
        <img src="${req.imageUrl}" style="max-width: 100%; max-height: 100%; object-fit: contain; width: 100%; height: 100%;" alt="Print Preview">
      </div>
      <div>
        <h4 style="font-size: 1rem; color: var(--text-primary); margin-bottom: 2px;">Event: ${req.eventName}</h4>
        <p style="font-size: 0.8rem; color: var(--text-muted);">Request ID: <code>${req.id}</code></p>
        <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">Waktu: ⏳ ${formattedTime}</p>
      </div>
      <div style="display: flex; gap: 10px; margin-top: auto;">
        <button class="btn-primary btn-approve-print" data-id="${req.id}" style="flex: 1; padding: 0.6rem; font-size: 0.88rem; justify-content: center; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 12px; font-weight: 700; border: none; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);">Setujui ✅</button>
        <button class="btn-secondary btn-reject-print" data-id="${req.id}" style="flex: 1; padding: 0.6rem; font-size: 0.88rem; justify-content: center; color: #ef4444; border-color: rgba(239, 68, 68, 0.3); background: rgba(239, 68, 68, 0.05); border-radius: 12px; font-weight: 700;">Tolak ❌</button>
      </div>
    `;
    
    // Zoom/Lightbox preview for image click
    const previewContainer = card.querySelector('.preview-img-container');
    previewContainer.addEventListener('click', () => {
      openPrintLightbox(req.imageUrl, req.eventName);
    });
    
    // Approve Button Listener
    const btnApprove = card.querySelector('.btn-approve-print');
    btnApprove.addEventListener('click', async () => {
      const confirmed = await showCustomConfirm(
        "Setujui Cetak?",
        "Apakah Anda yakin ingin menyetujui permintaan cetak foto ini? Foto akan dicetak di booth.",
        "Ya, Setujui",
        "Batal",
        "🖨️"
      );
      if (!confirmed) return;
      
      try {
        const res = await adminFetch(`/api/print/approve/${req.id}`, { method: 'POST' });
        if (res.ok) {
          showToastNotification("Permintaan cetak disetujui!");
          await loadPrintQueue();
        } else {
          const err = await res.json();
          showCustomAlert("Gagal", err.error || "Gagal menyetujui cetak.", "error");
        }
      } catch (err) {
        console.error(err);
        showCustomAlert("Kesalahan Koneksi", "Gagal menghubungi server.", "error");
      }
    });
    
    // Reject Button Listener
    const btnReject = card.querySelector('.btn-reject-print');
    btnReject.addEventListener('click', async () => {
      const confirmed = await showCustomConfirm(
        "Tolak Cetak?",
        "Apakah Anda yakin ingin menolak permintaan cetak foto ini?",
        "Ya, Tolak",
        "Batal",
        "❌"
      );
      if (!confirmed) return;
      
      try {
        const res = await adminFetch(`/api/print/reject/${req.id}`, { method: 'POST' });
        if (res.ok) {
          showToastNotification("Permintaan cetak ditolak.");
          await loadPrintQueue();
        } else {
          const err = await res.json();
          showCustomAlert("Gagal", err.error || "Gagal menolak cetak.", "error");
        }
      } catch (err) {
        console.error(err);
        showCustomAlert("Kesalahan Koneksi", "Gagal menghubungi server.", "error");
      }
    });
    
    grid.appendChild(card);
  });
}

function openPrintLightbox(imgUrl, title) {
  // Lightbox container
  const lightbox = document.createElement('div');
  lightbox.id = 'admin-print-lightbox';
  lightbox.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(5, 5, 8, 0.85);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    z-index: 100000;
    opacity: 0;
    transition: opacity 0.3s ease;
  `;
  
  lightbox.innerHTML = `
    <div style="position: absolute; top: 20px; right: 20px; z-index: 100001; display: flex; gap: 12px;">
      <button id="lightbox-close-btn" class="btn-secondary" style="padding: 0.6rem; border-radius: 50%; font-size: 1.1rem; width: 44px; height: 44px; justify-content: center; margin: 0; border-color: rgba(255,255,255,0.15); background: rgba(255,255,255,0.05); color: #fff;">✕</button>
    </div>
    <div class="glass-panel" style="max-width: 90%; max-height: 80%; padding: 0.75rem; border-radius: 20px; border: 1px solid var(--glass-border); display: flex; justify-content: center; align-items: center; background: rgba(20,21,35,0.7); box-shadow: 0 20px 50px rgba(0,0,0,0.6); transform: scale(0.95); transition: transform 0.3s ease;">
      <img src="${imgUrl}" style="max-width: 100%; max-height: 70vh; object-fit: contain; border-radius: 12px;" alt="Lightbox Preview">
    </div>
    <div style="margin-top: 1.5rem; color: #fff; font-weight: 700; font-size: 1.1rem; text-align: center; text-shadow: 0 2px 8px rgba(0,0,0,0.5);">${title}</div>
  `;
  
  document.body.appendChild(lightbox);
  
  // Animation triggers
  setTimeout(() => {
    lightbox.style.opacity = '1';
    lightbox.querySelector('.glass-panel').style.transform = 'scale(1)';
  }, 10);
  
  const close = () => {
    lightbox.style.opacity = '0';
    lightbox.querySelector('.glass-panel').style.transform = 'scale(0.95)';
    setTimeout(() => {
      lightbox.remove();
    }, 300);
  };
  
  lightbox.querySelector('#lightbox-close-btn').addEventListener('click', close);
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) close();
  });
}

function showToastNotification(message) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      z-index: 10000;
    `;
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'glass-panel';
  toast.style.cssText = `
    padding: 1rem 1.5rem;
    border-radius: 16px;
    border: 1px solid var(--glass-border);
    background: rgba(20, 21, 35, 0.9);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
    color: var(--text-primary);
    font-size: 0.9rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 10px;
    transform: translateY(100px);
    opacity: 0;
    transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  `;
  toast.innerHTML = `<span>🖨️</span> <span>${message}</span>`;
  container.appendChild(toast);

  // Trigger masuk
  setTimeout(() => {
    toast.style.transform = 'translateY(0)';
    toast.style.opacity = '1';
  }, 50);

  // Auto remove
  setTimeout(() => {
    toast.style.transform = 'translateY(-20px)';
    toast.style.opacity = '0';
    setTimeout(() => {
      toast.remove();
    }, 400);
  }, 4000);
}

function initWebSocket() {
  const wsUrl = getWsUrl();
  adminWs = new WebSocket(wsUrl);

  adminWs.onopen = () => {
    console.log('[WS] Admin terhubung ke WebSocket');
  };

  adminWs.onmessage = async (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'PRINT_REQUEST') {
        console.log('[WS] Print request baru diterima:', message.request);
        await loadPrintQueue();
        showToastNotification(`Permintaan cetak baru dari event: ${message.request.eventName}`);
      } else if (message.type === 'PRINT_APPROVED') {
        await loadPrintQueue();
        if (adminState.localPrintingEnabled) {
          console.log('[WS] Melakukan cetak fisik lokal untuk request:', message.id);
          executePhysicalPrint(message.imageUrl);
        }
      } else if (message.type === 'PRINT_REJECTED') {
        await loadPrintQueue();
      }
    } catch (err) {
      console.error('[WS] Gagal memproses pesan:', err);
    }
  };

  adminWs.onclose = () => {
    console.log('[WS] Koneksi Admin terputus. Rekoneksi dalam 3 detik...');
    setTimeout(initWebSocket, 3000);
  };
}

// Baru: Ambil list printer dari OS Windows
async function loadSystemPrinters() {
  const select = document.getElementById('config-printer-active');
  if (!select) return;

  try {
    const res = await adminFetch('/api/printers');
    const printers = await res.json();
    
    select.innerHTML = '<option value="">-- Gunakan Printer Default OS --</option>';
    
    if (printers.length === 0) {
      const opt = document.createElement('option');
      opt.value = "";
      opt.textContent = "Tidak ada printer terdeteksi (Hanya Windows)";
      select.appendChild(opt);
      return;
    }
    
    printers.forEach(printer => {
      const opt = document.createElement('option');
      opt.value = printer.name;
      const statusLabel = printer.offline ? 'Offline' : 'Ready';
      opt.textContent = `${printer.name} (${statusLabel})`;
      select.appendChild(opt);
    });

    // Pilih printer yang tersimpan di config jika ada
    if (adminState.config && adminState.config.activePrinter) {
      select.value = adminState.config.activePrinter;
    }
  } catch (err) {
    console.error('Gagal memuat printer:', err);
    select.innerHTML = '<option value="">Gagal memuat printer</option>';
  }
}

// Baru: Cetak fisik lokal pada perangkat admin yang terhubung ke printer
async function executePhysicalPrint(imageUrl) {
  let copies = adminState.config.printerCopies || 1;
  
  const img = new Image();
  img.onload = function() {
    const isLandscape = img.width > img.height;
    const finalPaperSize = adminState.config.printerPaperSize === 'A6' 
      ? (isLandscape ? "148mm 105mm" : "105mm 148mm")
      : (isLandscape ? "6in 4in" : "4in 6in");

    // Buat iframe tersembunyi
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.opacity = '0';
    document.body.appendChild(iframe);

    // Buat HTML pages sesuai jumlah salinan (copies)
    let pagesHtml = '';
    for (let i = 0; i < copies; i++) {
      pagesHtml += `<img src="${imageUrl}" class="print-page" />`;
    }

    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Cetak Foto</title>
        <style>
          @page {
            size: ${finalPaperSize};
            margin: 0;
          }
          html, body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            background-color: #ffffff;
          }
          .print-page {
            width: 100vw;
            height: 100vh;
            object-fit: fill;
            display: block;
            page-break-after: always;
          }
          .print-page:last-child {
            page-break-after: avoid;
          }
        </style>
      </head>
      <body>
        ${pagesHtml}
        <script>
          window.addEventListener('load', function() {
            setTimeout(function() {
              window.focus();
              window.print();
            }, 500);
          });
        </script>
      </body>
      </html>
    `);
    doc.close();

    const cleanUp = () => {
      if (iframe.parentNode) {
        document.body.removeChild(iframe);
      }
      window.removeEventListener('focus', cleanUp);
    };
    
    window.addEventListener('focus', cleanUp);
    setTimeout(cleanUp, 60000);
  };

  img.onerror = function() {
    console.error("Gagal memuat gambar untuk dicetak fisik di admin.");
  };

  img.src = imageUrl;
}

