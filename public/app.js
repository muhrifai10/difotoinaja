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

// State Aplikasi
let state = {
  events: [],
  templates: [],
  config: {},
  activeEvent: null,
  activeTemplate: null,
  capturedPhotos: [],
  selectedFilter: 'none',
  stream: null,
  ws: null,
  isCapturing: false,
  isDslrMode: false,
  activeCategory: 'all', // tracking active category filter
  selectedTemplate: null, // selected template in wizard step 1
  uploadedPhotoUrl: null, // uploaded photo url for printing
  pendingPrintRequestId: null // active print approval request id
};

// DOM Elements
const screenHome = document.getElementById('screen-home');
const screenBooth = document.getElementById('screen-booth');
const screenResult = document.getElementById('screen-result');

const eventSelect = null;
const templatesSelectGrid = document.getElementById('templates-select-grid');
const btnCancelBooth = document.getElementById('btn-cancel-booth');
const btnCapture = document.getElementById('btn-capture');
const btnHomeNext = document.getElementById('btn-home-next');
const webcamPreview = document.getElementById('webcam-preview');
const cameraSelect = document.getElementById('camera-select');
const cameraSourceContainer = document.getElementById('camera-source-container');
const dslrStatusIndicator = document.getElementById('dslr-status-indicator');
const dslrStatusText = document.getElementById('dslr-status-text');
const dslrInstructions = document.getElementById('dslr-instructions');

const boothEventTitle = document.getElementById('booth-event-title');
const sidebarEventName = document.getElementById('sidebar-event-name');
const sidebarTemplateName = document.getElementById('sidebar-template-name');
const thumbsGrid = document.getElementById('thumbs-grid');
const capturedCount = document.getElementById('captured-count');
const requiredCount = document.getElementById('required-count');

const countdownOverlay = document.getElementById('countdown-overlay');
const flashOverlay = document.getElementById('flash-overlay');

const collageCanvas = document.getElementById('collage-canvas');
const collagePreview = document.getElementById('collage-preview');
const qrLoading = document.getElementById('qr-loading');
const qrResultContainer = document.getElementById('qr-result-container');
const qrImage = document.getElementById('qr-image');
const btnDownloadDirect = document.getElementById('btn-download-direct');

const btnDone = document.getElementById('btn-done');
const btnRetake = document.getElementById('btn-retake');
const navGalleryLink = document.getElementById('nav-gallery-link');

// Inisialisasi awal
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Setup UI Event Listeners dan Fullscreen secara sinkron (agar langsung aktif tanpa terhambat network)
  setupEventListeners();
  setupBoothLockKeypad();
  setupFullscreenTrigger();

  // 2. Muat data dari API backend secara asinkron
  try {
    await loadConfig();
    await loadEvents();
    await loadTemplates();
  } catch (err) {
    console.error('Gagal memuat data dari server:', err);
  }

  // 3. Inisialisasi WebSocket dan Kunci Sesi setelah konfigurasi didapatkan
  initWebSocket();
  updateGalleryLink();
  checkBoothSessionLock();
});

// Load data dari API
async function loadConfig() {
  try {
    const res = await fetch(getApiUrl('/api/config'));
    state.config = await res.json();
    state.isDslrMode = state.config.dslrEnabled;
    applyKioskBackground();
  } catch (err) {
    console.error('Gagal mengambil konfigurasi:', err);
  }
}

async function loadEvents() {
  try {
    const res = await fetch(getApiUrl('/api/events'));
    state.events = await res.json();
    renderEventSelector();
  } catch (err) {
    console.error('Gagal mengambil events:', err);
  }
}

async function loadTemplates() {
  try {
    const res = await fetch(getApiUrl('/api/templates'));
    state.templates = await res.json();
    renderTemplatesCategoryFilter();
    renderTemplatesSelector();
  } catch (err) {
    console.error('Gagal mengambil templates:', err);
  }
}

// Render pemilih template kustom di halaman utama
function renderTemplatesSelector() {
  templatesSelectGrid.innerHTML = '';
  
  if (state.templates.length === 0) {
    templatesSelectGrid.innerHTML = '<p style="grid-column: 1/-1; color: var(--text-muted); text-align: center;">Tidak ada template tersedia. Silakan unggah di admin panel.</p>';
    return;
  }

  // Saring berdasarkan activeCategory
  const filteredTemplates = state.activeCategory === 'all'
    ? state.templates
    : state.templates.filter(t => (t.category || 'ceria').trim().toLowerCase() === state.activeCategory);

  if (filteredTemplates.length === 0) {
    templatesSelectGrid.innerHTML = '<p style="grid-column: 1/-1; color: var(--text-muted); text-align: center; padding: 2rem;">Tidak ada template dalam kategori ini.</p>';
    return;
  }

  filteredTemplates.forEach(template => {
    const card = document.createElement('div');
    card.className = 'template-select-card';
    
    // Set selected class if active
    if (state.selectedTemplate && state.selectedTemplate.id === template.id) {
      card.classList.add('selected');
    }
    
    card.innerHTML = `
      <div class="preview-box">
        <img src="${getAssetUrl(template.overlayUrl)}" alt="${template.name}">
      </div>
      <div class="title">${template.name}</div>
      <div class="badge-type">${template.layoutType.replace('_', ' ')}</div>
    `;

    card.addEventListener('click', () => {
      // Toggle selection
      document.querySelectorAll('.template-select-card').forEach(c => {
        c.classList.remove('selected');
      });
      
      card.classList.add('selected');
      state.selectedTemplate = template;

      // Enable next button
      if (btnHomeNext) {
        btnHomeNext.disabled = false;
        btnHomeNext.style.opacity = '1';
      }
    });

    templatesSelectGrid.appendChild(card);
  });
}

// Render Tombol Filter Kategori di halaman utama
function renderTemplatesCategoryFilter() {
  const filterContainer = document.getElementById('templates-category-filter');
  if (!filterContainer) return;
  
  filterContainer.innerHTML = '';
  
  // 1. Kumpulkan semua kategori unik dari templates, inisialisasi dengan kategori bawaan
  const categories = new Set(['ceria', 'romantis', 'keluarga', 'teman', 'bestie']);
  state.templates.forEach(t => {
    if (t.category) {
      categories.add(t.category.trim().toLowerCase());
    }
  });
  
  // Urutkan kategori dan tambahkan 'all' di depan
  const categoryList = ['all', ...Array.from(categories).sort()];
  
  // Mapping penulisan teks filter untuk UI agar rapi
  const displayNames = {
    'all': 'Semua',
    'ceria': 'Ceria',
    'romantis': 'Romantis',
    'keluarga': 'Keluarga',
    'teman': 'Teman',
    'bestie': 'Bestie'
  };
  
  categoryList.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = `category-filter-btn${state.activeCategory === cat ? ' active' : ''}`;
    btn.textContent = displayNames[cat] || cat;
    
    btn.addEventListener('click', () => {
      state.activeCategory = cat;
      
      // Update status active pada tombol
      filterContainer.querySelectorAll('.category-filter-btn').forEach(b => {
        b.classList.remove('active');
      });
      btn.classList.add('active');
      
      // Filter ulang grid template
      renderTemplatesSelector();
    });
    
    filterContainer.appendChild(btn);
  });
}

// Render event aktif ke halaman utama
function renderEventSelector() {
  const activeEventNameEl = document.getElementById('active-event-name');
  const activeEventDateEl = document.getElementById('active-event-date');
  
  if (state.events.length === 0) {
    if (activeEventNameEl) activeEventNameEl.textContent = 'Tidak Ada Event Aktif';
    if (activeEventDateEl) activeEventDateEl.textContent = '-';
    state.activeEvent = null;
    return;
  }

  // Cari event yang aktif dari konfigurasi
  let activeEvent = state.events.find(e => e.id === state.config.activeEventId) || state.events[0];
  state.activeEvent = activeEvent;

  if (activeEventNameEl) activeEventNameEl.textContent = activeEvent.name;
  if (activeEventDateEl) activeEventDateEl.textContent = `Tanggal: ${activeEvent.date}`;
  
  updateGalleryLink();
}

// Fungsi ini dihapus karena template dipilih langsung secara visual

function updateGalleryLink() {
  if (state.activeEvent) {
    navGalleryLink.href = `/gallery.html?event=${state.activeEvent.slug}`;
    navGalleryLink.style.display = 'inline-block';
  } else {
    navGalleryLink.style.display = 'none';
  }
}

// Inisialisasi WebSocket untuk DSLR Monitor & Persetujuan Cetak
function initWebSocket() {
  const wsUrl = getWsUrl();
  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
    console.log('[WS] Terkoneksi ke server backend');
  };

  state.ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    
    if (message.type === 'DSLR_CAPTURE') {
      if (state.isCapturing && state.isDslrMode) {
        handleDslrCapture(message.dataUrl);
      }
    } else if (message.type === 'PRINT_APPROVED') {
      if (state.pendingPrintRequestId && state.pendingPrintRequestId === message.id) {
        console.log('[WS] Print request approved! Image:', message.imageUrl);
        const printBtn = document.getElementById('btn-print-result');
        if (printBtn) {
          printBtn.innerHTML = 'Disetujui & Dicetak! 🖨️';
          printBtn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
        }
        showCustomAlert("Cetak Disetujui ✅", "Permintaan cetak foto Anda disetujui oleh Admin dan sedang diproses di printer booth!", "success");
        setTimeout(resetPrintButton, 4000);
      }
    } else if (message.type === 'PRINT_REJECTED') {
      if (state.pendingPrintRequestId && state.pendingPrintRequestId === message.id) {
        console.log('[WS] Print request rejected.');
        showCustomAlert("Cetak Ditolak ❌", "Permintaan cetak foto Anda ditolak oleh Admin.", "error");
        resetPrintButton();
      }
    }
  };

  state.ws.onclose = () => {
    console.log('[WS] Koneksi terputus. Mencoba rekoneksi dalam 3 detik...');
    setTimeout(initWebSocket, 3000);
  };
}

// Setup Event Listeners
function setupEventListeners() {
  // (Pilihan event diubah menjadi otomatis menampilkan event yang aktif di halaman depan)

  const fsToggle = document.getElementById('btn-fullscreen-toggle');
  const lockFsBtn = document.getElementById('btn-lock-fullscreen');
  const handleFsToggle = (e) => {
    e.stopPropagation();
    const elem = document.documentElement;
    if (!document.fullscreenElement && !document.webkitFullscreenElement && !document.msFullscreenElement) {
      if (elem.requestFullscreen) {
        elem.requestFullscreen().catch(err => console.log(err));
      } else if (elem.webkitRequestFullscreen) {
        elem.webkitRequestFullscreen();
      } else if (elem.msRequestFullscreen) {
        elem.msRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      }
    }
  };

  if (fsToggle) {
    fsToggle.addEventListener('click', handleFsToggle);
  }
  if (lockFsBtn) {
    lockFsBtn.addEventListener('click', handleFsToggle);
  }

  if (btnHomeNext) {
    btnHomeNext.addEventListener('click', () => {
      if (state.selectedTemplate) {
        state.activeTemplate = state.selectedTemplate;
        startBoothSession();
      }
    });
  }

  btnCancelBooth.addEventListener('click', stopBoothSession);
  btnCapture.addEventListener('click', () => {
    if (state.isDslrMode) {
      // Dalam mode DSLR tethering, pengambilan foto dipicu dari kamera eksternal
      showCustomAlert("Mode DSLR Tethering", "Mode DSLR Tethering aktif. Silakan memotret langsung lewat Kamera DSLR Anda!", "info");
    } else {
      startWebcamCaptureSequence();
    }
  });

  btnDone.addEventListener('click', () => {
    switchScreen(screenHome);
    stopBoothSession();
    resetTemplateSelection();
  });

  const btnPrintResult = document.getElementById('btn-print-result');
  if (btnPrintResult) {
    btnPrintResult.addEventListener('click', () => {
      if (state.uploadedPhotoUrl) {
        requestPrintApproval(state.uploadedPhotoUrl);
      } else {
        showCustomAlert("Sedang Mempersiapkan", "Foto Anda sedang diunggah ke server, silakan coba cetak beberapa saat lagi.", "info");
      }
    });
  }

  btnRetake.addEventListener('click', () => {
    switchScreen(screenBooth);
    initBoothUI();
  });

  const btnEndSession = document.getElementById('btn-end-session');
  if (btnEndSession) {
    btnEndSession.addEventListener('click', async () => {
      const confirmed = await showCustomConfirm(
        "Akhiri Sesi?",
        "Apakah Anda yakin ingin mengakhiri sesi foto Anda sekarang?",
        "Ya, Akhiri",
        "Batal",
        "🔒"
      );
      if (confirmed) {
        lockBoothSession(true);
      }
    });
  }

  // Event listener untuk Filter
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      state.selectedFilter = e.target.getAttribute('data-filter');
      
      // Render ulang canvas kolase dengan filter terpilih
      drawCollageCanvas();
    });
  });

  // Kamera input select
  cameraSelect.addEventListener('change', (e) => {
    if (state.stream) {
      state.stream.getTracks().forEach(track => track.stop());
    }
    const selectedCameraId = e.target.value;
    localStorage.setItem('dfia_active_camera_id', selectedCameraId);
    startWebcam(selectedCameraId);
  });
}

// Switch Screens
function switchScreen(targetScreen) {
  [screenHome, screenBooth, screenResult].forEach(screen => {
    screen.style.display = 'none';
  });
  targetScreen.style.display = targetScreen === screenBooth ? 'grid' : (targetScreen === screenResult ? 'grid' : 'flex');

  // Update wizard steps based on target screen
  if (targetScreen === screenHome) {
    updateWizardSteps(1);
  } else if (targetScreen === screenBooth) {
    updateWizardSteps(2);
  } else if (targetScreen === screenResult) {
    updateWizardSteps(3);
  }
}

// Update Wizard Steps UI
function updateWizardSteps(stepNumber) {
  const step1 = document.getElementById('step-indicator-1');
  const step2 = document.getElementById('step-indicator-2');
  const step3 = document.getElementById('step-indicator-3');
  
  const divider1 = step1 ? step1.nextElementSibling : null;
  const divider2 = step2 ? step2.nextElementSibling : null;

  // Reset all
  [step1, step2, step3].forEach(step => {
    if (step) {
      step.classList.remove('active', 'completed');
    }
  });
  if (divider1) divider1.classList.remove('completed');
  if (divider2) divider2.classList.remove('completed');

  if (stepNumber === 1) {
    if (step1) step1.classList.add('active');
  } else if (stepNumber === 2) {
    if (step1) step1.classList.add('completed');
    if (divider1) divider1.classList.add('completed');
    if (step2) step2.classList.add('active');
  } else if (stepNumber === 3) {
    if (step1) step1.classList.add('completed');
    if (divider1) divider1.classList.add('completed');
    if (step2) step2.classList.add('completed');
    if (divider2) divider2.classList.add('completed');
    if (step3) step3.classList.add('active');
  }
}

// Reset template selection state
function resetTemplateSelection() {
  state.selectedTemplate = null;
  state.activeTemplate = null;
  if (btnHomeNext) {
    btnHomeNext.disabled = true;
    btnHomeNext.style.opacity = '0.5';
  }
  // Re-render template grid to clear selection
  renderTemplatesSelector();
}

// Memulai Sesi Booth
async function startBoothSession() {
  if (!state.activeEvent || !state.activeTemplate) {
    showCustomAlert("Konfigurasi Diperlukan", "Silakan buat atau pilih event dan template terlebih dahulu di dashboard admin.", "warning");
    return;
  }

  // Perbarui konfigurasi lokal sebelum mulai
  await loadConfig();

  switchScreen(screenBooth);
  initBoothUI();
}

function initBoothUI() {
  state.capturedPhotos = [];
  state.isCapturing = true;
  state.uploadedPhotoUrl = null;
  state.pendingPrintRequestId = null;
  resetPrintButton();

  boothEventTitle.textContent = state.activeEvent.name;
  sidebarEventName.textContent = state.activeEvent.name;
  sidebarTemplateName.textContent = `Template: ${state.activeTemplate.name}`;
  
  capturedCount.textContent = '0';
  requiredCount.textContent = state.activeTemplate.photoSlots.length;

  // Tampilkan preview desain frame terpilih di sidebar secara dinamis
  updateSidebarPreview();

  // Siapkan grid thumbnail
  thumbsGrid.innerHTML = '';
  for (let i = 0; i < state.activeTemplate.photoSlots.length; i++) {
    const slot = document.createElement('div');
    slot.id = `thumb-slot-${i}`;
    slot.className = 'thumb-slot';
    slot.textContent = i + 1;
    thumbsGrid.appendChild(slot);
  }

  // Konfigurasi Input Kamera
  if (state.isDslrMode) {
    // Mode DSLR Tethering
    cameraSourceContainer.style.display = 'none';
    dslrStatusIndicator.style.display = 'flex';
    dslrStatusIndicator.className = 'dslr-indicator';
    dslrStatusText.textContent = `DSLR Tethering Aktif: Memantau folder`;
    dslrInstructions.style.display = 'block';
    
    // Matikan webcam preview
    webcamPreview.style.display = 'none';
    if (state.stream) {
      state.stream.getTracks().forEach(track => track.stop());
      state.stream = null;
    }
    btnCapture.style.display = 'none'; // Dipicu dari kamera DSLR langsung
  } else {
    // Mode Browser Webcam
    cameraSourceContainer.style.display = 'block';
    dslrStatusIndicator.style.display = 'none';
    dslrInstructions.style.display = 'none';
    webcamPreview.style.display = 'block';
    btnCapture.style.display = 'inline-flex';

    initWebcamDevices();
  }
}

// Fungsi untuk menggambar pratinjau kolase secara dinamis pada bilah samping (sidebar)
function updateSidebarPreview() {
  const template = state.activeTemplate;
  if (!template) return;

  const sidebarFramePreviewImg = document.getElementById('sidebar-frame-preview-img');
  if (!sidebarFramePreviewImg) return;

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = template.width;
  tempCanvas.height = template.height;
  const ctx = tempCanvas.getContext('2d');

  // Load overlay image
  const overlayPromise = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `${getAssetUrl(template.overlayUrl)}?t=${Date.now()}`;
  });

  // Load photo images captured so far
  const photoPromises = template.photoSlots.map((slot, index) => {
    return new Promise((resolve) => {
      const photoSrc = state.capturedPhotos[index];
      if (!photoSrc) {
        resolve(null);
        return;
      }
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = photoSrc;
    });
  });

  Promise.all([overlayPromise, ...photoPromises]).then(([overlayImg, ...photoImgs]) => {
    // Bersihkan canvas
    ctx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);

    const drawPhotos = () => {
      template.photoSlots.forEach((slot, index) => {
        const img = photoImgs[index];
        if (img) {
          ctx.save();
          drawImageToSlot(ctx, img, slot.x, slot.y, slot.width, slot.height);
          ctx.restore();
        }
      });
    };

    const drawOverlay = () => {
      if (overlayImg) {
        ctx.drawImage(overlayImg, 0, 0, tempCanvas.width, tempCanvas.height);
      }
    };

    // Layering logic: front vs behind
    const layering = template.frameLayering || 'behind';
    if (layering === 'front') {
      drawOverlay();
      drawPhotos();
    } else {
      drawPhotos();
      drawOverlay();
    }

    // Update src of preview image
    sidebarFramePreviewImg.src = tempCanvas.toDataURL('image/png');
  });
}

// Mematikan Sesi Booth
function stopBoothSession() {
  state.isCapturing = false;
  if (state.stream) {
    state.stream.getTracks().forEach(track => track.stop());
    state.stream = null;
  }
  switchScreen(screenHome);
}

// Inisialisasi Webcam
async function initWebcamDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(device => device.kind === 'videoinput');
    
    cameraSelect.innerHTML = '';
    
    if (videoDevices.length === 0) {
      showCustomAlert("Kamera Tidak Ditemukan", "Kamera tidak ditemukan. Harap pastikan webcam Anda terhubung.", "error");
      return;
    }

    const savedCameraId = localStorage.getItem('dfia_active_camera_id');
    let activeId = videoDevices[0].deviceId;
    
    // Pastikan device ID yang tersimpan masih ada dalam daftar kamera terhubung
    const hasSavedCamera = videoDevices.some(device => device.deviceId === savedCameraId);
    if (savedCameraId && hasSavedCamera) {
      activeId = savedCameraId;
    }

    videoDevices.forEach(device => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `Kamera ${cameraSelect.length + 1}`;
      if (device.deviceId === activeId) {
        option.selected = true;
      }
      cameraSelect.appendChild(option);
    });

    // Mulai webcam aktif
    await startWebcam(activeId);
  } catch (err) {
    console.error('Gagal menginisialisasi input video:', err);
    showCustomAlert("Akses Kamera Ditolak", "Akses kamera ditolak. Berikan izin akses kamera agar Difotoinaja dapat digunakan.", "error");
  }
}

async function startWebcam(deviceId) {
  try {
    if (state.stream) {
      state.stream.getTracks().forEach(track => track.stop());
    }

    const constraints = {
      video: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    };

    state.stream = await navigator.mediaDevices.getUserMedia(constraints);
    webcamPreview.srcObject = state.stream;
  } catch (err) {
    console.error('Gagal memutar webcam:', err);
  }
}

// Trigger Flash Visual Effect
function triggerFlash() {
  flashOverlay.classList.add('active');
  setTimeout(() => {
    flashOverlay.classList.remove('active');
  }, 500);
}

// Sequence Pengambilan Foto dengan Webcam (Countdowns)
async function startWebcamCaptureSequence() {
  if (state.isCapturing && state.capturedPhotos.length < state.activeTemplate.photoSlots.length) {
    btnCapture.disabled = true;
    
    const slotsCount = state.activeTemplate.photoSlots.length;
    
    for (let i = state.capturedPhotos.length; i < slotsCount; i++) {
      await runCountdown(3);
      triggerFlash();
      captureWebcamFrame(i);
      
      // Jeda 1.5 detik antar foto agar orang bisa ganti pose
      if (i < slotsCount - 1) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }

    btnCapture.disabled = false;
    finishCaptureSession();
  }
}

// Jalankan Hitung Mundur Visual
function runCountdown(seconds) {
  return new Promise((resolve) => {
    countdownOverlay.style.display = 'flex';
    countdownOverlay.classList.add('active');
    
    let currentSec = seconds;
    countdownOverlay.textContent = currentSec;

    const interval = setInterval(() => {
      currentSec--;
      if (currentSec <= 0) {
        clearInterval(interval);
        countdownOverlay.classList.remove('active');
        countdownOverlay.style.display = 'none';
        resolve();
      } else {
        countdownOverlay.textContent = currentSec;
      }
    }, 1000);
  });
}

// Menangkap Frame dari Video Stream dengan Deteksi Rasio Asli (Menghindari Foto Gepeng)
function captureWebcamFrame(slotIndex) {
  const videoWidth = webcamPreview.videoWidth || 640;
  const videoHeight = webcamPreview.videoHeight || 480;
  
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = 640;
  tempCanvas.height = 480;
  const tempCtx = tempCanvas.getContext('2d');
  
  // Hitung pemotongan (crop) agar rasio video (misal 16:9) pas masuk ke canvas 4:3 tanpa ditarik/gepeng
  const targetRatio = 640 / 480;
  const sourceRatio = videoWidth / videoHeight;
  
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = videoWidth;
  let sourceHeight = videoHeight;
  
  if (sourceRatio > targetRatio) {
    // Video terlalu lebar (widescreen), potong sisi kanan-kiri
    sourceWidth = videoHeight * targetRatio;
    sourceX = (videoWidth - sourceWidth) / 2;
  } else {
    // Video terlalu tinggi, potong sisi atas-bawah
    sourceHeight = videoWidth / targetRatio;
    sourceY = (videoHeight - sourceHeight) / 2;
  }
  
  // Mirror canvas draw matching webcam mirrored display
  tempCtx.translate(640, 0);
  tempCtx.scale(-1, 1);

  // Terapkan efek cerah & halus bawaan agar wajah pengguna terlihat premium
  tempCtx.filter = 'brightness(108%) contrast(102%) saturate(102%) blur(0.3px)';
  
  // Gambar dengan memotong (crop) video sumber secara proporsional
  tempCtx.drawImage(webcamPreview, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, 640, 480);
  
  // Reset transform
  tempCtx.setTransform(1, 0, 0, 1, 0, 0);
  
  const base64Img = tempCanvas.toDataURL('image/jpeg', 0.95);
  
  addCapturedPhoto(slotIndex, base64Img);
}

// Handling foto masuk dari Hot Folder DSLR
function handleDslrCapture(dataUrl) {
  if (state.capturedPhotos.length < state.activeTemplate.photoSlots.length) {
    triggerFlash();
    const currentSlot = state.capturedPhotos.length;
    addCapturedPhoto(currentSlot, dataUrl);
    
    if (state.capturedPhotos.length === state.activeTemplate.photoSlots.length) {
      finishCaptureSession();
    }
  }
}

// Menyimpan foto ke antrian slot
function addCapturedPhoto(slotIndex, dataUrl) {
  state.capturedPhotos[slotIndex] = dataUrl;
  
  // Update UI slot thumbnail
  const slotEl = document.getElementById(`thumb-slot-${slotIndex}`);
  if (slotEl) {
    slotEl.className = 'thumb-slot captured';
    slotEl.innerHTML = `<img src="${dataUrl}" alt="Photo ${slotIndex + 1}">`;
  }

  capturedCount.textContent = state.capturedPhotos.length;

  // Update pratinjau frame template di sidebar secara real-time
  updateSidebarPreview();
}

// Selesai Sesi Capture & Lanjut ke Hasil
function finishCaptureSession() {
  state.isCapturing = false;
  if (state.stream) {
    state.stream.getTracks().forEach(track => track.stop());
    state.stream = null;
  }
  
  switchScreen(screenResult);
  
  // Set default filter ke Normal
  state.selectedFilter = 'none';
  document.querySelectorAll('.filter-btn').forEach(btn => {
    if (btn.getAttribute('data-filter') === 'none') {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  drawCollageCanvas();
}

// Menggabungkan Foto-Foto ke Template menggunakan HTML5 Canvas
function drawCollageCanvas() {
  const template = state.activeTemplate;
  collageCanvas.width = template.width;
  collageCanvas.height = template.height;
  
  const ctx = collageCanvas.getContext('2d');
  
  // Bersihkan canvas
  ctx.clearRect(0, 0, collageCanvas.width, collageCanvas.height);
  
  // Load overlay image
  const overlayPromise = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `${getAssetUrl(template.overlayUrl)}?t=${Date.now()}`;
  });
  
  // Load photo images
  const photoPromises = template.photoSlots.map((slot, index) => {
    return new Promise((resolve) => {
      const photoSrc = state.capturedPhotos[index];
      if (!photoSrc) {
        resolve(null);
        return;
      }
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = photoSrc;
    });
  });
  
  Promise.all([overlayPromise, ...photoPromises]).then(([overlayImg, ...photoImgs]) => {
    const drawPhotos = () => {
      template.photoSlots.forEach((slot, index) => {
        const img = photoImgs[index];
        if (img) {
          ctx.save();
          applyCanvasFilter(ctx);
          drawImageToSlot(ctx, img, slot.x, slot.y, slot.width, slot.height);
          ctx.restore();
        }
      });
    };

    const drawOverlay = () => {
      if (overlayImg) {
        ctx.drawImage(overlayImg, 0, 0, collageCanvas.width, collageCanvas.height);
      }
    };

    // Layering logic: front vs behind
    const layering = template.frameLayering || 'behind'; // default to behind frame
    if (layering === 'front') {
      // Photo in front of frame: draw overlay (frame) first, then photos
      drawOverlay();
      drawPhotos();
    } else {
      // Photo behind frame: draw photos first, then overlay (frame)
      drawPhotos();
      drawOverlay();
    }

    // Tampilkan di tag img untuk preview
    // Menggunakan JPEG 90% (image/jpeg) agar ukuran file jauh lebih kecil dan proses upload/rendering instan
    const finalDataUrl = collageCanvas.toDataURL('image/jpeg', 0.90);
    collagePreview.src = finalDataUrl;
    
    // Langsung unggah hasil foto ke server untuk generate QR Code
    uploadCollage(finalDataUrl);
  });
}

// Helper: Menghitung aspect ratio crop & draw
function drawImageToSlot(ctx, img, sx, sy, sw, sh) {
  const imgWidth = img.width;
  const imgHeight = img.height;
  
  const targetRatio = sw / sh;
  const sourceRatio = imgWidth / imgHeight;
  
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = imgWidth;
  let sourceHeight = imgHeight;
  
  if (sourceRatio > targetRatio) {
    // Foto terlalu lebar, potong sisi kanan-kiri
    sourceWidth = imgHeight * targetRatio;
    sourceX = (imgWidth - sourceWidth) / 2;
  } else {
    // Foto terlalu tinggi, potong sisi atas-bawah
    sourceHeight = imgWidth / targetRatio;
    sourceY = (imgHeight - sourceHeight) / 2;
  }
  
  ctx.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight, sx, sy, sw, sh);
}

// Terapkan Filter di Canvas
function applyCanvasFilter(ctx) {
  switch (state.selectedFilter) {
    case 'beauty':
      ctx.filter = 'brightness(108%) contrast(102%) saturate(103%) blur(0.4px)';
      break;
    case 'grayscale':
      ctx.filter = 'grayscale(100%)';
      break;
    case 'sepia':
      ctx.filter = 'sepia(100%)';
      break;
    case 'vintage':
      ctx.filter = 'sepia(40%) contrast(120%) saturate(110%) brightness(95%)';
      break;
    case 'none':
    default:
      ctx.filter = 'none';
      break;
  }
}

// Mengunggah Foto Kolase dan Mendapatkan Link Unduh (QR Code)
async function uploadCollage(dataUrl) {
  qrLoading.style.display = 'block';
  qrResultContainer.style.display = 'none';

  try {
    const res = await fetch(getApiUrl('/api/upload'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        image: dataUrl,
        eventSlug: state.activeEvent.slug
      })
    });

    const result = await res.json();
    
    if (result.success) {
      state.uploadedPhotoUrl = result.photoUrl;
      qrLoading.style.display = 'none';
      qrResultContainer.style.display = 'block';
      qrImage.src = result.qrCode;
      btnDownloadDirect.href = result.photoUrl;
      
      // Cetak otomatis jika diaktifkan di konfigurasi
      if (state.config.printerAutoPrint) {
        requestPrintApproval(result.photoUrl);
      }
    } else {
      qrLoading.textContent = "Gagal mengunggah foto.";
    }
  } catch (err) {
    console.error('Gagal upload kolase:', err);
    qrLoading.textContent = "Koneksi ke server terputus. Gagal generate QR Code.";
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

// ================= SESSION PIN & TIMER LOGIC =================

let sessionTimerInterval = null;
let currentBoothPinInput = "";

function showBoothLockScreen(isExpired = false) {
  const lockScreen = document.getElementById('booth-lock-screen');
  const lockTitle = document.getElementById('booth-lock-title');
  const lockDesc = document.getElementById('booth-lock-desc');
  
  currentBoothPinInput = "";
  document.getElementById('booth-pin-input').value = "";
  
  if (isExpired) {
    lockTitle.textContent = "Sesi Habis 🔒";
    lockDesc.textContent = "Sisa waktu sesi Anda telah habis. Silakan masukkan PIN Sesi baru untuk melanjutkan.";
  } else {
    lockTitle.textContent = "Mulai Sesi Baru 📸";
    lockDesc.textContent = "Masukkan PIN Sesi Anda untuk memulai.";
  }
  
  lockScreen.style.display = 'flex';
  document.getElementById('session-timer-container').style.display = 'none';
}

function hideBoothLockScreen() {
  document.getElementById('booth-lock-screen').style.display = 'none';
}

function checkBoothSessionLock() {
  if (state.config.sessionLockEnabled) {
    const sessionExpiry = sessionStorage.getItem('dfia_session_expiry');
    if (!sessionExpiry || Date.now() > parseInt(sessionExpiry)) {
      sessionStorage.removeItem('dfia_session_expiry');
      showBoothLockScreen(false);
    } else {
      hideBoothLockScreen();
      startSessionTimer(parseInt(sessionExpiry) - Date.now());
    }
  } else {
    hideBoothLockScreen();
    document.getElementById('session-timer-container').style.display = 'none';
  }
}

function setupBoothLockKeypad() {
  const pinInput = document.getElementById('booth-pin-input');
  const keypadButtons = document.querySelectorAll('.booth-keypad-btn');
  const submitBtn = document.getElementById('btn-submit-booth-pin');
  
  keypadButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.getAttribute('data-val');
      if (val === 'del') {
        currentBoothPinInput = currentBoothPinInput.slice(0, -1);
      } else if (val === 'clear') {
        currentBoothPinInput = "";
      } else {
        if (currentBoothPinInput.length < 6) {
          currentBoothPinInput += val;
        }
      }
      pinInput.value = currentBoothPinInput;
    });
  });
  
  submitBtn.addEventListener('click', handleBoothPinSubmit);
}

async function handleBoothPinSubmit() {
  if (currentBoothPinInput.length < 4 || currentBoothPinInput.length > 6) {
    showCustomAlert("Input Tidak Valid", "PIN harus terdiri dari 4 sampai 6 digit angka.", "warning");
    return;
  }
  
  try {
    const res = await fetch(getApiUrl('/api/session/unlock'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: currentBoothPinInput })
    });
    
    if (res.ok) {
      const data = await res.json();
      const durationMs = data.duration * 60 * 1000;
      const expiry = Date.now() + durationMs;
      sessionStorage.setItem('dfia_session_expiry', expiry.toString());
      
      hideBoothLockScreen();
      startSessionTimer(durationMs);
      showCustomAlert("Sesi Dimulai", `Sesi foto Anda aktif selama ${data.duration} menit. Selamat berfoto!`, "success");
    } else {
      currentBoothPinInput = "";
      document.getElementById('booth-pin-input').value = "";
      const err = await res.json();
      showCustomAlert("Akses Ditolak", err.error || "PIN Sesi yang Anda masukkan salah.", "error");
    }
  } catch (err) {
    console.error('Error memproses PIN Sesi:', err);
    showCustomAlert("Kesalahan Sistem", "Gagal memproses verifikasi PIN Sesi.", "error");
  }
}

function startSessionTimer(durationMs) {
  if (sessionTimerInterval) {
    clearInterval(sessionTimerInterval);
  }
  
  const timerContainer = document.getElementById('session-timer-container');
  const timerBadge = document.getElementById('session-timer-badge');
  const timerDisplay = document.getElementById('session-time-display');
  
  if (!state.config.sessionLockEnabled) {
    timerContainer.style.display = 'none';
    return;
  }
  
  timerContainer.style.display = 'flex';
  
  let timeRemaining = Math.max(0, Math.floor(durationMs / 1000));
  
  function updateTimerUI() {
    const minutes = Math.floor(timeRemaining / 60).toString().padStart(2, '0');
    const seconds = (timeRemaining % 60).toString().padStart(2, '0');
    timerDisplay.textContent = `${minutes}:${seconds}`;
    
    if (timeRemaining < 60) {
      timerBadge.style.borderColor = '#ef4444';
      timerBadge.style.color = '#ef4444';
      timerBadge.style.boxShadow = '0 0 15px rgba(239, 68, 68, 0.35)';
      const pulseDot = timerBadge.querySelector('.timer-pulse-dot');
      if (pulseDot) pulseDot.style.backgroundColor = '#ef4444';
    } else {
      timerBadge.style.borderColor = 'rgba(76, 201, 240, 0.25)';
      timerBadge.style.color = '#ffffff';
      timerBadge.style.boxShadow = 'var(--shadow-glow-cyan)';
      const pulseDot = timerBadge.querySelector('.timer-pulse-dot');
      if (pulseDot) pulseDot.style.backgroundColor = 'var(--accent-cyan)';
    }
  }
  
  updateTimerUI();
  
  sessionTimerInterval = setInterval(() => {
    timeRemaining--;
    if (timeRemaining <= 0) {
      clearInterval(sessionTimerInterval);
      updateTimerUI();
      lockBoothSession(false);
    } else {
      updateTimerUI();
    }
  }, 1000);
}

function lockBoothSession(isManual = false) {
  if (sessionTimerInterval) {
    clearInterval(sessionTimerInterval);
    sessionTimerInterval = null;
  }

  if (state.stream) {
    state.stream.getTracks().forEach(track => track.stop());
    state.stream = null;
  }
  
  state.isCapturing = false;
  state.capturedPhotos = [];
  
  switchScreen(screenHome);
  resetTemplateSelection();
  sessionStorage.removeItem('dfia_session_expiry');
  showBoothLockScreen(!isManual);
  
  if (isManual) {
    showCustomAlert("Sesi Selesai 🔒", "Sesi foto Anda telah berhasil diakhiri.", "success");
  } else {
    showCustomAlert("Sesi Habis 🔒", "Waktu sesi foto Anda telah habis. Silakan masukkan PIN sesi baru untuk memulai.", "info");
  }
}

function applyKioskBackground() {
  if (state.config.backgroundImageUrl) {
    document.body.style.backgroundImage = `url('${getAssetUrl(state.config.backgroundImageUrl)}')`;
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundPosition = 'center';
    document.body.style.backgroundAttachment = 'fixed';
    document.body.style.backgroundRepeat = 'no-repeat';
  } else {
    document.body.style.backgroundImage = '';
    document.body.style.backgroundSize = '';
    document.body.style.backgroundPosition = '';
    document.body.style.backgroundAttachment = '';
    document.body.style.backgroundRepeat = '';
  }
}

// Setup trigger for entering fullscreen on click/tap gesture (browser security requirement)
function setupFullscreenTrigger() {
  const enterFullscreen = () => {
    // Hanya picu jika belum dalam mode fullscreen
    if (!document.fullscreenElement && !document.webkitFullscreenElement && !document.msFullscreenElement) {
      const elem = document.documentElement;
      if (elem.requestFullscreen) {
        elem.requestFullscreen().catch(err => console.log("Fullscreen request blocked or failed:", err));
      } else if (elem.webkitRequestFullscreen) {
        elem.webkitRequestFullscreen();
      } else if (elem.msRequestFullscreen) {
        elem.msRequestFullscreen();
      }
    }
  };

  // Selalu dengarkan klik dan sentuhan untuk memastikan tetap fullscreen (dipaksa terus)
  document.addEventListener('click', enterFullscreen);
  document.addEventListener('touchstart', enterFullscreen);
}

// Fitur Cetak Foto 4R Borderless via Hidden Iframe
async function printPhoto(imageUrl) {
  const printBtn = document.getElementById('btn-print-result');
  if (printBtn) {
    printBtn.disabled = true;
    printBtn.textContent = '⏳ Menyiapkan...';
  }

  let copies = 1;
  try {
    const res = await fetch(getApiUrl('/api/config'));
    if (res.ok) {
      const config = await res.json();
      copies = config.printerCopies || 1;
    }
  } catch (err) {
    console.error("Gagal memuat konfigurasi printer, default ke 1 salinan:", err);
  }

  // Load image to detect dimensions
  const img = new Image();
  img.onload = function() {
    const isLandscape = img.width > img.height;
    const paperSize = isLandscape ? "6in 4in" : "4in 6in";

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
            size: ${paperSize};
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
          // Tunggu sampai gambar termuat sepenuhnya sebelum mencetak
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
      if (printBtn) {
        printBtn.disabled = false;
        printBtn.textContent = '🖨️ Cetak Foto (4R)';
      }
    };
    
    window.addEventListener('focus', cleanUp);
    setTimeout(cleanUp, 60000);
  };

  img.onerror = function() {
    showCustomAlert("Gagal Cetak", "Gagal memuat gambar foto untuk dicetak.", "error");
    if (printBtn) {
      printBtn.disabled = false;
      printBtn.textContent = '🖨️ Cetak Foto (4R)';
    }
  };

  img.src = imageUrl;
}

// ================= PRINT APPROVAL WORKFLOW =================

async function requestPrintApproval(imageUrl) {
  const printBtn = document.getElementById('btn-print-result');
  if (printBtn) {
    printBtn.disabled = true;
    printBtn.style.background = 'linear-gradient(135deg, var(--accent-pink) 0%, var(--accent-purple) 100%)';
    printBtn.style.color = '#fff';
    printBtn.innerHTML = 'Menunggu Persetujuan Admin... ⏳';
  }
  
  try {
    const res = await fetch(getApiUrl('/api/print/request'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        imageUrl: imageUrl,
        eventSlug: state.activeEvent ? state.activeEvent.slug : 'demo'
      })
    });
    
    if (res.ok) {
      const data = await res.json();
      state.pendingPrintRequestId = data.id;
      console.log('[Print Approval] Request sent. ID:', data.id);
    } else {
      const err = await res.json();
      showCustomAlert("Gagal Mengirim Permintaan", err.error || "Gagal menghubungi antrean cetak admin.", "error");
      resetPrintButton();
    }
  } catch (err) {
    console.error('Gagal mengirim request cetak:', err);
    showCustomAlert("Kesalahan Koneksi", "Gagal menghubungi server untuk meminta persetujuan cetak.", "error");
    resetPrintButton();
  }
}

function resetPrintButton() {
  const printBtn = document.getElementById('btn-print-result');
  if (printBtn) {
    printBtn.disabled = false;
    printBtn.style.background = '';
    printBtn.style.color = '';
    printBtn.innerHTML = '🖨️ Cetak Foto (4R)';
  }
  state.pendingPrintRequestId = null;
}
