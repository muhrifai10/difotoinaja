// Konfigurasi URL Backend (Kosongkan jika dihosting dalam satu server yang sama, misalnya: "https://difotoinaja-backend.onrender.com")
const BACKEND_URL = ""; 

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

// DOM Elements
const gallerySelectSection = document.getElementById('gallery-select-section');
const galleryContentSection = document.getElementById('gallery-content-section');
const galleryEventsList = document.getElementById('gallery-events-list');

const galleryTitle = document.getElementById('gallery-title');
const galleryDate = document.getElementById('gallery-date');
const galleryGrid = document.getElementById('gallery-grid');
const galleryEmptyMessage = document.getElementById('gallery-empty-message');
const btnDownloadAll = document.getElementById('btn-download-all');

const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxClose = document.getElementById('lightbox-close');
const lightboxDownload = document.getElementById('lightbox-download');

// New DOM Elements for Sharing & Select Mode
const shareBanner = document.getElementById('share-banner');
const btnClearShare = document.getElementById('btn-clear-share');

const lightboxShareWa = document.getElementById('lightbox-share-wa');
const lightboxShareLink = document.getElementById('lightbox-share-link');
const lightboxShareQr = document.getElementById('lightbox-share-qr');
const lightboxQrContainer = document.getElementById('lightbox-qr-container');
const lightboxQrImg = document.getElementById('lightbox-qr-img');
const lightboxPrint = document.getElementById('lightbox-print');

const floatingShareBar = document.getElementById('floating-share-bar');
const selectionCount = document.getElementById('selection-count');
const floatingDownload = document.getElementById('floating-download');
const floatingShareWa = document.getElementById('floating-share-wa');
const floatingShareLink = document.getElementById('floating-share-link');
const floatingShareQr = document.getElementById('floating-share-qr');
const floatingCancel = document.getElementById('floating-cancel');

const shareQrModal = document.getElementById('share-qr-modal');
const shareQrClose = document.getElementById('share-qr-close');
const shareQrImg = document.getElementById('share-qr-img');
const shareQrOk = document.getElementById('share-qr-ok');

let currentEvent = null;
let currentPhotos = [];
let allEventPhotos = []; // Backup of all photos for clearing filter
let selectedPhotos = new Set(); // Stores selected photo filenames
let activeLightboxPhoto = null; // Tracks photo currently viewed in lightbox

// Membaca URL Query Parameter
function getQueryParam(param) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param);
}

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Setup UI dan Fullscreen secara sinkron (agar langsung aktif)
  setupLightbox();
  setupFullscreenTrigger();
  setupFullscreenToggleButton();
  initWebSocket();

  // 2. Muat data galeri event asinkron
  const eventSlug = getQueryParam('event');
  try {
    if (eventSlug) {
      await loadEventGallery(eventSlug);
    } else {
      await loadEventSelector();
    }
  } catch (err) {
    console.error("Gagal memuat galeri event:", err);
  }
});

// Load Selector Halaman Depan Galeri jika slug kosong
async function loadEventSelector() {
  gallerySelectSection.style.display = 'flex';
  galleryContentSection.style.display = 'none';

  try {
    const res = await fetch(getApiUrl('/api/events'));
    const events = await res.json();

    galleryEventsList.innerHTML = '';

    if (events.length === 0) {
      galleryEventsList.innerHTML = '<p style="text-align: center; color: var(--text-muted);">Tidak ada event yang tersedia saat ini.</p>';
      return;
    }

    events.forEach(event => {
      const card = document.createElement('a');
      card.href = `/gallery.html?event=${event.slug}`;
      card.className = 'glass-panel';
      card.style.display = 'flex';
      card.style.justifyContent = 'space-between';
      card.style.alignItems = 'center';
      card.style.padding = '1.5rem';
      card.style.textDecoration = 'none';
      card.style.color = 'var(--text-main)';
      card.style.transition = 'all 0.3s ease';

      card.innerHTML = `
        <div>
          <h3 style="font-size: 1.25rem; color: var(--accent-cyan);">${event.name}</h3>
          <p style="color: var(--text-muted); font-size: 0.9rem; margin-top: 5px;">Tanggal: ${event.date}</p>
        </div>
        <span style="font-size: 1.5rem;">➡️</span>
      `;

      card.addEventListener('mouseenter', () => {
        card.style.transform = 'translateX(5px)';
        card.style.borderColor = 'var(--accent-purple)';
      });
      
      card.addEventListener('mouseleave', () => {
        card.style.transform = 'translateX(0)';
        card.style.borderColor = 'var(--glass-border)';
      });

      galleryEventsList.appendChild(card);
    });
  } catch (err) {
    console.error('Gagal mengambil daftar event:', err);
  }
}

// Load Halaman Galeri Event Spesifik
async function loadEventGallery(slug) {
  try {
    // 1. Ambil info Event dari list API
    const resEvents = await fetch(getApiUrl('/api/events'));
    const events = await resEvents.json();
    currentEvent = events.find(e => e.slug === slug);

    if (!currentEvent) {
      showCustomAlert("Event Tidak Ditemukan", "Event tersebut tidak dapat ditemukan atau tidak aktif.", "error");
      setTimeout(() => {
        window.location.href = '/gallery.html';
      }, 3000);
      return;
    }

    gallerySelectSection.style.display = 'none';
    galleryContentSection.style.display = 'flex';

    galleryTitle.textContent = `Galeri: ${currentEvent.name}`;
    galleryDate.textContent = `Tanggal Event: ${currentEvent.date}`;

    // 2. Ambil List Foto Event
    const resPhotos = await fetch(getApiUrl(`/api/event/${slug}/photos`));
    allEventPhotos = await resPhotos.json();

    // Cek parameter share di URL
    const shareParam = getQueryParam('share');
    if (shareParam) {
      const sharedNames = shareParam.split(',');
      currentPhotos = allEventPhotos.filter(photo => sharedNames.includes(photo.name));
      shareBanner.style.display = 'flex';
    } else {
      currentPhotos = allEventPhotos;
      shareBanner.style.display = 'none';
    }

    renderPhotosGrid();
    setupShareHandlers();
  } catch (err) {
    console.error('Gagal memuat galeri event:', err);
  }
}

// Render Foto ke Grid Layout
function renderPhotosGrid() {
  galleryGrid.innerHTML = '';
  
  if (currentPhotos.length === 0) {
    galleryGrid.style.display = 'none';
    galleryEmptyMessage.style.display = 'block';
    btnDownloadAll.style.display = 'none';
    return;
  }

  galleryGrid.style.display = 'grid';
  galleryEmptyMessage.style.display = 'none';
  btnDownloadAll.style.display = 'inline-flex';

  currentPhotos.forEach(photo => {
    const item = document.createElement('div');
    const isSelected = selectedPhotos.has(photo.name);
    item.className = `gallery-item${isSelected ? ' selected' : ''}`;
    
    item.innerHTML = `
      <div class="gallery-item-select" title="Tandai Foto">
        <span class="check-mark">✓</span>
      </div>
      <img src="${getAssetUrl(photo.url)}" class="gallery-img" alt="${photo.name}" loading="lazy">
      <div class="gallery-overlay">
        <button class="gallery-btn">🔍 Lihat Detail</button>
      </div>
    `;

    // Klik checkbox seleksi foto
    const selectBtn = item.querySelector('.gallery-item-select');
    selectBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // Mencegah terbukanya lightbox
      togglePhotoSelection(photo.name, item);
    });

    // Klik untuk membuka Lightbox
    item.addEventListener('click', () => {
      openLightbox(getAssetUrl(photo.url));
    });

    galleryGrid.appendChild(item);
  });

  // Setup Download All Button
  btnDownloadAll.onclick = async () => {
    const confirmed = await showCustomConfirm(
      "Unduh Semua Foto?", 
      `Apakah Anda ingin mengunduh semua foto (${currentPhotos.length} file) dari event ini secara otomatis?`,
      "Unduh 📦",
      "Batal ❌"
    );
    if (confirmed) {
      currentPhotos.forEach((photo, index) => {
        setTimeout(() => {
          const a = document.createElement('a');
          a.href = getAssetUrl(photo.url);
          a.download = photo.name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }, index * 350); // Delay 350ms per file untuk mencegah pemblokiran unduhan oleh browser
      });
    }
  };
}

// Setup Lightbox Event Listeners
function setupLightbox() {
  lightboxClose.addEventListener('click', closeLightbox);
  
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) {
      closeLightbox();
    }
  });

  // Menutup dengan menekan tombol Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lightbox.classList.contains('active')) {
      closeLightbox();
    }
  });
}

function openLightbox(imgUrl) {
  const photoName = imgUrl.substring(imgUrl.lastIndexOf('/') + 1);
  activeLightboxPhoto = { url: imgUrl, name: photoName };

  lightboxImg.src = imgUrl;
  lightboxDownload.href = imgUrl;
  lightboxDownload.download = photoName;
  
  // Reset container QR di lightbox ke tersembunyi
  lightboxQrContainer.style.display = 'none';

  lightbox.classList.add('active');
}

function closeLightbox() {
  lightbox.classList.remove('active');
  lightboxImg.src = '';
  activeLightboxPhoto = null;
  resetPrintButton();
}

// Logika Manajemen Seleksi Foto
function togglePhotoSelection(photoName, itemElement) {
  if (selectedPhotos.has(photoName)) {
    selectedPhotos.delete(photoName);
    itemElement.classList.remove('selected');
  } else {
    selectedPhotos.add(photoName);
    itemElement.classList.add('selected');
  }
  updateFloatingShareBar();
}

function updateFloatingShareBar() {
  if (selectedPhotos.size > 0) {
    selectionCount.textContent = `${selectedPhotos.size} foto ditandai`;
    floatingShareBar.style.display = 'flex';
    // Beri jeda sangat singkat agar browser bisa mendeteksi block display sebelum transisi
    setTimeout(() => {
      floatingShareBar.style.bottom = '20px';
    }, 10);
  } else {
    floatingShareBar.style.bottom = '-120px';
    setTimeout(() => {
      floatingShareBar.style.display = 'none';
    }, 400); // Sesuai dengan durasi CSS transition
  }
}

function clearSelection() {
  selectedPhotos.clear();
  document.querySelectorAll('.gallery-item').forEach(item => {
    item.classList.remove('selected');
  });
  updateFloatingShareBar();
}

// Setup Event Handlers untuk Sharing (WhatsApp, Copy Link, QR Code)
function setupShareHandlers() {
  // 1. Tombol Bersihkan Filter Share Banner
  btnClearShare.addEventListener('click', () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('share');
    window.history.replaceState({}, '', url.toString());
    
    currentPhotos = allEventPhotos;
    shareBanner.style.display = 'none';
    renderPhotosGrid();
  });

  // 2. Share WhatsApp (Single Photo)
  lightboxShareWa.addEventListener('click', () => {
    if (!activeLightboxPhoto) return;
    const shareUrl = `${window.location.origin}/gallery.html?event=${currentEvent.slug}&share=${encodeURIComponent(activeLightboxPhoto.name)}`;
    const text = `Lihat dan unduh foto saya dari event ${currentEvent.name} di sini: ${shareUrl}`;
    const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    window.open(waUrl, '_blank');
  });

  // 3. Salin Link Share (Single Photo)
  lightboxShareLink.addEventListener('click', () => {
    if (!activeLightboxPhoto) return;
    const shareUrl = `${window.location.origin}/gallery.html?event=${currentEvent.slug}&share=${encodeURIComponent(activeLightboxPhoto.name)}`;
    navigator.clipboard.writeText(shareUrl)
      .then(() => {
        showCustomAlert("Link Berhasil Disalin", "Link khusus foto ini telah disalin ke clipboard Anda.", "success");
      })
      .catch(err => {
        console.error("Gagal menyalin link:", err);
        showCustomAlert("Gagal Menyalin Link", "Gagal menyalin link ke clipboard.", "error");
      });
  });

  // 4. Toggle Barcode/QR (Single Photo)
  lightboxShareQr.addEventListener('click', () => {
    if (!activeLightboxPhoto) return;
    if (lightboxQrContainer.style.display === 'none' || !lightboxQrContainer.style.display) {
      const shareUrl = `${window.location.origin}/gallery.html?event=${currentEvent.slug}&share=${encodeURIComponent(activeLightboxPhoto.name)}`;
      lightboxQrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(shareUrl)}`;
      lightboxQrContainer.style.display = 'block';
    } else {
      lightboxQrContainer.style.display = 'none';
    }
  });

  // 5. Unduh Terpilih (Multi-Select)
  floatingDownload.addEventListener('click', async () => {
    if (selectedPhotos.size === 0) return;
    const filesToDownload = Array.from(selectedPhotos);
    const confirmed = await showCustomConfirm(
      "Unduh Foto Terpilih?",
      `Apakah Anda ingin mengunduh ${filesToDownload.length} foto yang telah ditandai?`,
      "Unduh 📥",
      "Batal ❌"
    );
    if (confirmed) {
      filesToDownload.forEach((photoName, index) => {
        const photo = allEventPhotos.find(p => p.name === photoName);
        const photoUrl = photo ? getAssetUrl(photo.url) : getAssetUrl(`/uploads/events/${currentEvent.slug}/${photoName}`);
        
        setTimeout(() => {
          const a = document.createElement('a');
          a.href = photoUrl;
          a.download = photoName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }, index * 350); // Delay 350ms per file untuk menghindari pemblokiran unduhan oleh browser
      });
    }
  });

  // 6. Share WhatsApp (Multi-Select)
  floatingShareWa.addEventListener('click', () => {
    if (selectedPhotos.size === 0) return;
    const photoList = Array.from(selectedPhotos).join(',');
    const shareUrl = `${window.location.origin}/gallery.html?event=${currentEvent.slug}&share=${encodeURIComponent(photoList)}`;
    const text = `Lihat dan unduh ${selectedPhotos.size} foto pilihan saya dari event ${currentEvent.name} di sini: ${shareUrl}`;
    const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    window.open(waUrl, '_blank');
  });

  // 7. Salin Link Share (Multi-Select)
  floatingShareLink.addEventListener('click', () => {
    if (selectedPhotos.size === 0) return;
    const photoList = Array.from(selectedPhotos).join(',');
    const shareUrl = `${window.location.origin}/gallery.html?event=${currentEvent.slug}&share=${encodeURIComponent(photoList)}`;
    navigator.clipboard.writeText(shareUrl)
      .then(() => {
        showCustomAlert("Link Berhasil Disalin", `Tautan untuk ${selectedPhotos.size} foto terpilih berhasil disalin ke clipboard.`, "success");
      })
      .catch(err => {
        console.error("Gagal menyalin link:", err);
        showCustomAlert("Gagal Menyalin Link", "Gagal menyalin link ke clipboard.", "error");
      });
  });

  // 8. Tampilkan Barcode/QR (Multi-Select)
  floatingShareQr.addEventListener('click', () => {
    if (selectedPhotos.size === 0) return;
    const photoList = Array.from(selectedPhotos).join(',');
    const shareUrl = `${window.location.origin}/gallery.html?event=${currentEvent.slug}&share=${encodeURIComponent(photoList)}`;
    
    shareQrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(shareUrl)}`;
    shareQrModal.classList.add('active');
  });

  // 9. Batal / Tutup Floating Bar & Modals
  floatingCancel.addEventListener('click', clearSelection);

  shareQrClose.addEventListener('click', () => {
    shareQrModal.classList.remove('active');
  });
  
  shareQrOk.addEventListener('click', () => {
    shareQrModal.classList.remove('active');
  });

  shareQrModal.addEventListener('click', (e) => {
    if (e.target === shareQrModal) {
      shareQrModal.classList.remove('active');
    }
  });

  // 10. Cetak Foto 4R
  if (lightboxPrint) {
    lightboxPrint.addEventListener('click', () => {
      if (!activeLightboxPhoto) return;
      printPhoto(getAssetUrl(activeLightboxPhoto.url));
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
function showCustomConfirm(title, message, confirmText = "Ya", cancelText = "Batal") {
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
      <div style="font-size: 3.5rem; margin-bottom: 1rem; animation: pulse 1s infinite alternate; display: inline-block;">
        📥
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

    confirmBox.querySelector('#custom-confirm-btn-ok').addEventListener('click', () => closeConfirm(true));
    confirmBox.querySelector('#custom-confirm-btn-cancel').addEventListener('click', () => closeConfirm(false));
    
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeConfirm(false);
      }
    });
  });
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

// Setup Fullscreen Toggle Button in Navbar
function setupFullscreenToggleButton() {
  const fsToggle = document.getElementById('btn-fullscreen-toggle');
  if (fsToggle) {
    fsToggle.addEventListener('click', (e) => {
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
    });
  }
}

// Fitur Cetak Foto 4R Borderless via Hidden Iframe (Fisik)
async function executePhysicalPrint(imageUrl) {
  const printBtn = document.getElementById('lightbox-print');
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
      resetPrintButton();
    };
    
    window.addEventListener('focus', cleanUp);
    setTimeout(cleanUp, 60000);
  };

  img.onerror = function() {
    showCustomAlert("Gagal Cetak", "Gagal memuat gambar foto untuk dicetak.", "error");
    resetPrintButton();
  };

  img.src = imageUrl;
}

// ================= PRINT APPROVAL WORKFLOW =================

// State Galeri
let galleryState = {
  ws: null,
  pendingPrintRequestId: null,
  pendingPrintImageUrl: null
};

function initWebSocket() {
  const wsUrl = getWsUrl();
  galleryState.ws = new WebSocket(wsUrl);

  galleryState.ws.onopen = () => {
    console.log('[WS] Galeri terhubung ke server');
  };

  galleryState.ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    
    if (message.type === 'PRINT_APPROVED') {
      if (galleryState.pendingPrintRequestId && galleryState.pendingPrintRequestId === message.id) {
        console.log('[WS] Print request approved! Image:', message.imageUrl);
        const printBtn = document.getElementById('lightbox-print');
        if (printBtn) {
          printBtn.innerHTML = 'Disetujui & Dicetak! 🖨️';
          printBtn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
          printBtn.style.color = '#fff';
        }
        showCustomAlert("Cetak Disetujui ✅", "Permintaan cetak foto Anda disetujui oleh Admin dan sedang diproses di printer booth!", "success");
        setTimeout(resetPrintButton, 4000);
      }
    } else if (message.type === 'PRINT_REJECTED') {
      if (galleryState.pendingPrintRequestId && galleryState.pendingPrintRequestId === message.id) {
        console.log('[WS] Print request rejected.');
        showCustomAlert("Cetak Ditolak ❌", "Permintaan cetak foto Anda ditolak oleh Admin.", "error");
        resetPrintButton();
      }
    }
  };

  galleryState.ws.onclose = () => {
    console.log('[WS] Koneksi terputus. Mencoba rekoneksi dalam 3 detik...');
    setTimeout(initWebSocket, 3000);
  };
}

async function printPhoto(imageUrl) {
  const printBtn = document.getElementById('lightbox-print');
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
        eventSlug: currentEvent ? currentEvent.slug : 'demo'
      })
    });
    
    if (res.ok) {
      const data = await res.json();
      galleryState.pendingPrintRequestId = data.id;
      galleryState.pendingPrintImageUrl = imageUrl;
      console.log('[Print Approval] Gallery print request sent. ID:', data.id);
    } else {
      const err = await res.json();
      showCustomAlert("Gagal Mengirim Permintaan", err.error || "Gagal menghubungi antrean cetak admin.", "error");
      resetPrintButton();
    }
  } catch (err) {
    console.error('Gagal mengirim request cetak dari galeri:', err);
    showCustomAlert("Kesalahan Koneksi", "Gagal menghubungi server untuk meminta persetujuan cetak.", "error");
    resetPrintButton();
  }
}

function resetPrintButton() {
  const printBtn = document.getElementById('lightbox-print');
  if (printBtn) {
    printBtn.disabled = false;
    printBtn.style.background = '';
    printBtn.style.color = '';
    printBtn.innerHTML = '🖨️ Cetak Foto 4R';
  }
  galleryState.pendingPrintRequestId = null;
  galleryState.pendingPrintImageUrl = null;
}
