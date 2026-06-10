const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const qrcode = require('qrcode');
const chokidar = require('chokidar');
const { uploadToGoogleDrive } = require('./driveService');


const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Path Konfigurasi dan Penyimpanan
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const TEMPLATES_DIR = path.join(__dirname, 'templates');
const PUBLIC_TEMPLATES_DIR = path.join(__dirname, 'public', 'templates');

const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
const TEMPLATES_FILE = path.join(DATA_DIR, 'templates.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const SESSION_PINS_FILE = path.join(DATA_DIR, 'session_pins.json');

// Pastikan semua direktori yang diperlukan ada
[DATA_DIR, UPLOADS_DIR, TEMPLATES_DIR, PUBLIC_TEMPLATES_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Middleware CORS Kustom untuk mendukung cross-origin hosting (Niagahoster -> Render)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-PIN');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/templates', express.static(TEMPLATES_DIR));
app.use('/public/templates', express.static(PUBLIC_TEMPLATES_DIR));

// Helper untuk membaca & menulis JSON
function readJSON(file, fallback = []) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`Gagal membaca file ${file}:`, err);
    return fallback;
  }
}

function writeJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`Gagal menulis file ${file}:`, err);
  }
}

// Inisialisasi Database
let events = readJSON(EVENTS_FILE, []);
let templates = readJSON(TEMPLATES_FILE, []);
let sessionPins = readJSON(SESSION_PINS_FILE, []);
let printQueue = []; // Antrean cetak foto aktif dalam memori
let config = readJSON(CONFIG_FILE, {
  dslrEnabled: false,
  dslrHotFolder: path.join(__dirname, 'dslr_hot_folder'),
  googleDriveEnabled: false,
  googleDriveFolderId: "",
  activeEventId: "demo_event_id",
  adminPin: "",
  sessionDuration: 5,
  sessionLockEnabled: true,
  backgroundImageUrl: "",
  printerAutoPrint: false,
  printerPaperSize: "4R",
  printerCopies: 1,
  activePrinter: ""
});

if (config.sessionDuration === undefined) config.sessionDuration = 5;
if (config.sessionLockEnabled === undefined) config.sessionLockEnabled = true;
if (config.backgroundImageUrl === undefined) config.backgroundImageUrl = "";
if (config.printerAutoPrint === undefined) config.printerAutoPrint = false;
if (config.printerPaperSize === undefined) config.printerPaperSize = "4R";
if (config.printerCopies === undefined) config.printerCopies = 1;
if (config.activePrinter === undefined) config.activePrinter = "";

// DSLR Hot Folder Watcher
let watcher = null;

function initDSLRWatcher() {
  if (watcher) {
    watcher.close();
    watcher = null;
  }

  if (config.dslrEnabled && config.dslrHotFolder) {
    const hotFolderPath = path.resolve(config.dslrHotFolder);
    if (!fs.existsSync(hotFolderPath)) {
      fs.mkdirSync(hotFolderPath, { recursive: true });
    }

    console.log(`[DSLR Monitor] Memantau folder: ${hotFolderPath}`);
    watcher = chokidar.watch(hotFolderPath, {
      ignored: /(^|[\/\\])\../, // abaikan file tersembunyi
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval: 100
      }
    });

    watcher.on('add', (filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (['.jpg', '.jpeg', '.png'].includes(ext)) {
        console.log(`[DSLR Monitor] File baru terdeteksi: ${filePath}`);
        
        // Baca file dan kirimkan data ke frontend via WebSocket
        fs.readFile(filePath, (err, data) => {
          if (err) {
            console.error('Gagal membaca file DSLR:', err);
            return;
          }

          // Konversi ke Base64 agar mudah diproses di canvas frontend
          const base64Data = data.toString('base64');
          const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
          const dataUrl = `data:${mimeType};base64,${base64Data}`;

          // Broadcast ke semua koneksi WebSocket
          broadcastWS({
            type: 'DSLR_CAPTURE',
            dataUrl: dataUrl,
            fileName: path.basename(filePath)
          });

          // Pindahkan/arsip file lama agar hot folder tetap bersih (opsional)
          // Di sini kita biarkan, tapi idealnya bisa dipindahkan ke subfolder /archive
        });
      }
    });
  }
}

// Jalankan Watcher DSLR jika aktif
initDSLRWatcher();

// WebSocket Helper
function broadcastWS(data) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

wss.on('connection', (ws) => {
  console.log('[WS] Klien baru terhubung');
  ws.send(JSON.stringify({ type: 'STATUS', message: 'Terhubung ke Server Difotoinaja' }));
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('[WS] Menerima pesan:', data);
    } catch (e) {
      console.error('[WS] Gagal memproses pesan:', message);
    }
  });
});

// Setup Multer untuk upload Template
const templateStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, TEMPLATES_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `template_${Date.now()}${ext}`);
  }
});
const uploadTemplate = multer({ storage: templateStorage });

// Setup Multer untuk upload Background Kiosk
const configStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `bg_kiosk_${Date.now()}${ext}`);
  }
});
const uploadConfigImg = multer({ storage: configStorage });

// ================= API ENDPOINTS =================

// Middleware Keamanan PIN Admin
function verifyAdminPin(req, res, next) {
  // Jika PIN belum dikonfigurasi di server, abaikan pengecekan (mode setup awal)
  if (!config.adminPin || config.adminPin.trim() === "") {
    return next();
  }
  
  const clientPin = req.headers['x-admin-pin'];
  if (clientPin === config.adminPin) {
    return next();
  }
  
  return res.status(401).json({ error: 'PIN Admin tidak valid atau sesi kedaluwarsa.' });
}

// Keamanan PIN Admin Endpoints
app.get('/api/admin/status', (req, res) => {
  res.json({ hasPin: !!(config.adminPin && config.adminPin.trim() !== "") });
});

app.post('/api/admin/setup-pin', (req, res) => {
  const { pin } = req.body;
  if (!pin || !/^\d{4,6}$/.test(pin)) {
    return res.status(400).json({ error: 'PIN harus berupa 4 sampai 6 digit angka.' });
  }

  // Hanya izinkan jika PIN belum diset
  if (config.adminPin && config.adminPin.trim() !== "") {
    return res.status(403).json({ error: 'PIN admin sudah dikonfigurasi.' });
  }

  config.adminPin = pin;
  writeJSON(CONFIG_FILE, config);
  res.json({ success: true });
});

app.post('/api/admin/verify-pin', (req, res) => {
  const { pin } = req.body;
  if (!pin) {
    return res.status(400).json({ error: 'PIN diperlukan.' });
  }

  if (config.adminPin === pin) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'PIN yang dimasukkan salah.' });
  }
});

app.post('/api/admin/change-pin', verifyAdminPin, (req, res) => {
  const { oldPin, newPin } = req.body;
  if (!oldPin || !newPin || !/^\d{4,6}$/.test(newPin)) {
    return res.status(400).json({ error: 'Data tidak lengkap atau format PIN baru salah.' });
  }

  if (config.adminPin !== oldPin) {
    return res.status(400).json({ error: 'PIN lama yang dimasukkan tidak cocok.' });
  }

  config.adminPin = newPin;
  writeJSON(CONFIG_FILE, config);
  res.json({ success: true });
});

// ================= SESSION PIN ENDPOINTS =================

app.get('/api/session/pins', verifyAdminPin, (req, res) => {
  res.json(sessionPins);
});

app.post('/api/session/pins', verifyAdminPin, (req, res) => {
  const { customPin } = req.body;
  let pin = customPin;

  if (pin) {
    if (!/^\d{4,6}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN harus berupa 4 sampai 6 digit angka.' });
    }
    const existing = sessionPins.find(p => p.pin === pin && p.status === 'unused');
    if (existing) {
      return res.status(400).json({ error: 'PIN ini sudah terdaftar dan belum digunakan.' });
    }
  } else {
    let attempts = 0;
    do {
      pin = Math.floor(100000 + Math.random() * 900000).toString();
      attempts++;
    } while (sessionPins.some(p => p.pin === pin && p.status === 'unused') && attempts < 100);
  }

  const newSessionPin = {
    pin,
    status: 'unused',
    createdAt: new Date().toISOString(),
    usedAt: null
  };

  sessionPins.push(newSessionPin);
  writeJSON(SESSION_PINS_FILE, sessionPins);
  res.json({ success: true, pin: newSessionPin });
});

app.delete('/api/session/pins/:pin', verifyAdminPin, (req, res) => {
  const pinToDelete = req.params.pin;
  const index = sessionPins.findIndex(p => p.pin === pinToDelete);
  if (index !== -1) {
    sessionPins.splice(index, 1);
    writeJSON(SESSION_PINS_FILE, sessionPins);
    return res.json({ success: true });
  }
  res.status(404).json({ error: 'PIN tidak ditemukan.' });
});

app.post('/api/session/unlock', (req, res) => {
  const { pin } = req.body;
  if (!pin) {
    return res.status(400).json({ error: 'PIN diperlukan.' });
  }

  const pinObj = sessionPins.find(p => p.pin === pin && p.status === 'unused');
  if (!pinObj) {
    return res.status(401).json({ error: 'PIN Sesi tidak valid atau telah digunakan.' });
  }

  // Hapus PIN secara otomatis dan permanen setelah digunakan oleh user
  sessionPins = sessionPins.filter(p => p.pin !== pin);
  writeJSON(SESSION_PINS_FILE, sessionPins);

  res.json({
    success: true,
    duration: config.sessionDuration,
    sessionLockEnabled: config.sessionLockEnabled
  });
});

// ================= PRINT APPROVAL QUEUE ENDPOINTS =================

app.get('/api/print/queue', (req, res) => {
  res.json(printQueue.filter(p => p.status === 'pending'));
});

app.post('/api/print/request', (req, res) => {
  const { imageUrl, eventSlug } = req.body;
  if (!imageUrl) return res.status(400).json({ error: 'imageUrl diperlukan.' });

  const targetEvent = events.find(e => e.slug === eventSlug) || { name: 'Demo Event', slug: 'demo' };
  const id = `print_req_${Date.now()}`;
  const newRequest = {
    id,
    imageUrl,
    eventSlug: targetEvent.slug,
    eventName: targetEvent.name,
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  printQueue.push(newRequest);

  // Broadcast ke WebSocket (ringan, tanpa base64 gambar penuh)
  broadcastWS({
    type: 'PRINT_REQUEST',
    request: {
      id: newRequest.id,
      imageUrl: newRequest.imageUrl,
      eventSlug: newRequest.eventSlug,
      eventName: newRequest.eventName,
      createdAt: newRequest.createdAt
    }
  });

  res.json({ success: true, id });
});

app.post('/api/print/approve/:id', verifyAdminPin, (req, res) => {
  const { id } = req.params;
  const request = printQueue.find(p => p.id === id);
  if (!request) return res.status(404).json({ error: 'Permintaan cetak tidak ditemukan.' });

  request.status = 'approved';

  // Broadcast persetujuan via WebSocket
  broadcastWS({
    type: 'PRINT_APPROVED',
    id: request.id,
    imageUrl: request.imageUrl
  });

  // Hapus dari antrean aktif setelah diproses
  printQueue = printQueue.filter(p => p.id !== id);

  res.json({ success: true });
});

app.post('/api/print/reject/:id', verifyAdminPin, (req, res) => {
  const { id } = req.params;
  const request = printQueue.find(p => p.id === id);
  if (!request) return res.status(404).json({ error: 'Permintaan cetak tidak ditemukan.' });

  request.status = 'rejected';

  // Broadcast penolakan via WebSocket
  broadcastWS({
    type: 'PRINT_REJECTED',
    id: request.id
  });

  // Hapus dari antrean aktif setelah diproses
  printQueue = printQueue.filter(p => p.id !== id);

  res.json({ success: true });
});

const { exec } = require('child_process');

// API Ambil List Printer Sistem
app.get('/api/printers', (req, res) => {
  if (process.platform !== 'win32') {
    return res.json([]);
  }

  const cmd = `powershell -Command "Get-CimInstance Win32_Printer | Select-Object Name, PrinterStatus, WorkOffline | ConvertTo-Json"`;
  exec(cmd, (err, stdout, stderr) => {
    if (err) {
      console.error('[Printer Service] Gagal mengambil list printer:', err);
      return res.status(500).json({ error: 'Gagal mendeteksi printer pada server.' });
    }
    try {
      if (!stdout || stdout.trim() === '') {
        return res.json([]);
      }
      const printers = JSON.parse(stdout);
      const printerList = Array.isArray(printers) ? printers : [printers];
      res.json(printerList.map(p => ({
        name: p.Name,
        status: p.PrinterStatus,
        offline: p.WorkOffline
      })));
    } catch (e) {
      console.error('[Printer Service] Gagal parse JSON printer:', e);
      res.json([]);
    }
  });
});


// 1. Dapatkan & Perbarui Konfigurasi
app.get('/api/config', (req, res) => {
  res.json(config);
});

app.post('/api/config', verifyAdminPin, (req, res) => {
  const oldActivePrinter = config.activePrinter;
  config = { ...config, ...req.body };
  writeJSON(CONFIG_FILE, config);
  initDSLRWatcher(); // re-init watcher jika ada perubahan folder/status

  // Jika printer aktif diubah, setel default printer sistem
  if (config.activePrinter && config.activePrinter !== oldActivePrinter && process.platform === 'win32') {
    const printerName = config.activePrinter;
    const setPrinterCmd = `rundll32 printui.dll,PrintUIEntry /y /n "${printerName}"`;
    exec(setPrinterCmd, (err) => {
      if (err) {
        console.error(`[Printer Service] Gagal menyetel default printer ke ${printerName}:`, err);
      } else {
        console.log(`[Printer Service] Default printer Windows berhasil disetel ke: ${printerName}`);
      }
    });
  }

  res.json({ success: true, config });
});

app.post('/api/config/background', verifyAdminPin, uploadConfigImg.single('backgroundImage'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Tidak ada file gambar yang diunggah.' });
  }

  if (config.backgroundImageUrl && config.backgroundImageUrl.startsWith('/uploads/bg_kiosk_')) {
    const oldFilename = path.basename(config.backgroundImageUrl);
    const oldFilePath = path.join(UPLOADS_DIR, oldFilename);
    if (fs.existsSync(oldFilePath)) {
      try {
        fs.unlinkSync(oldFilePath);
        console.log(`[Config] File background lama dihapus: ${oldFilePath}`);
      } catch (err) {
        console.error('Gagal menghapus file background lama:', err);
      }
    }
  }

  config.backgroundImageUrl = `/uploads/${req.file.filename}`;
  writeJSON(CONFIG_FILE, config);
  res.json({ success: true, backgroundImageUrl: config.backgroundImageUrl });
});

app.delete('/api/config/background', verifyAdminPin, (req, res) => {
  if (config.backgroundImageUrl && config.backgroundImageUrl.startsWith('/uploads/bg_kiosk_')) {
    const filename = path.basename(config.backgroundImageUrl);
    const filePath = path.join(UPLOADS_DIR, filename);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        console.log(`[Config] File background dihapus: ${filePath}`);
      } catch (err) {
        console.error('Gagal menghapus file background:', err);
      }
    }
  }

  config.backgroundImageUrl = "";
  writeJSON(CONFIG_FILE, config);
  res.json({ success: true });
});

// 2. CRUD Event
app.get('/api/events', (req, res) => {
  res.json(events);
});

app.post('/api/events', verifyAdminPin, (req, res) => {
  const { name, slug, date, templateId } = req.body;
  if (!name || !slug) {
    return res.status(400).json({ error: 'Nama dan Slug event wajib diisi.' });
  }

  // Cek jika slug duplikat
  const existing = events.find(e => e.slug === slug);
  if (existing) {
    return res.status(400).json({ error: 'Slug event sudah digunakan.' });
  }

  const newEvent = {
    id: `event_${Date.now()}`,
    name,
    slug: slug.toLowerCase().replace(/[^a-z0-9-_]/g, ''),
    date: date || new Date().toISOString().split('T')[0],
    templateId: templateId || 'classic_strip_3',
    active: false
  };

  events.push(newEvent);
  writeJSON(EVENTS_FILE, events);
  res.json({ success: true, event: newEvent });
});

app.post('/api/events/active', verifyAdminPin, (req, res) => {
  const { id } = req.body;
  const event = events.find(e => e.id === id);
  if (!event) return res.status(404).json({ error: 'Event tidak ditemukan' });

  // Reset yang lain
  events.forEach(e => e.active = (e.id === id));
  writeJSON(EVENTS_FILE, events);

  config.activeEventId = id;
  writeJSON(CONFIG_FILE, config);

  res.json({ success: true, event });
});

// 3. API Template
app.get('/api/templates', (req, res) => {
  res.json(templates);
});

app.post('/api/templates', verifyAdminPin, uploadTemplate.single('overlay'), (req, res) => {
  const { name, layoutType, width, height, slots, category } = req.body;
  if (!req.file || !name || !layoutType) {
    return res.status(400).json({ error: 'Data upload template tidak lengkap.' });
  }

  let photoSlots = [];
  try {
    photoSlots = JSON.parse(slots);
  } catch (e) {
    // Buat slot default berdasarkan layoutType jika parsing gagal
    const w = parseInt(width) || 1205;
    const h = parseInt(height) || 1795;
    if (layoutType === 'strip_3') {
      photoSlots = [
        { x: Math.round(w * 0.08), y: Math.round(h * 0.05), width: Math.round(w * 0.84), height: Math.round(h * 0.22) },
        { x: Math.round(w * 0.08), y: Math.round(h * 0.30), width: Math.round(w * 0.84), height: Math.round(h * 0.22) },
        { x: Math.round(w * 0.08), y: Math.round(h * 0.55), width: Math.round(w * 0.84), height: Math.round(h * 0.22) }
      ];
    } else if (layoutType === 'grid_2x2') {
      photoSlots = [
        { x: 50, y: 50, width: (w/2)-75, height: (h/2)-100 },
        { x: (w/2)+25, y: 50, width: (w/2)-75, height: (h/2)-100 },
        { x: 50, y: (h/2)+50, width: (w/2)-75, height: (h/2)-100 },
        { x: (w/2)+25, y: (h/2)+50, width: (w/2)-75, height: (h/2)-100 }
      ];
    } else {
      photoSlots = [{ x: 50, y: 50, width: w - 100, height: h - 200 }];
    }
  }

  const newTemplate = {
    id: `template_${Date.now()}`,
    name,
    layoutType,
    width: parseInt(width) || 1205,
    height: parseInt(height) || 1795,
    overlayUrl: `/templates/${req.file.filename}`,
    photoSlots,
    frameLayering: req.body.frameLayering || 'behind',
    category: category || 'ceria'
  };

  templates.push(newTemplate);
  writeJSON(TEMPLATES_FILE, templates);
  res.json({ success: true, template: newTemplate });
});

app.delete('/api/templates/:id', verifyAdminPin, (req, res) => {
  const id = req.params.id;
  
  // 1. Cek apakah template ada
  const templateIndex = templates.findIndex(t => t.id === id);
  if (templateIndex === -1) {
    return res.status(404).json({ error: 'Template tidak ditemukan.' });
  }
  
  const template = templates[templateIndex];
  
  // 2. Cek apakah template sedang digunakan oleh event aktif atau event apa pun
  const activeEventUsingTemplate = events.find(e => e.templateId === id);
  if (activeEventUsingTemplate) {
    return res.status(400).json({ error: `Template ini sedang digunakan oleh event "${activeEventUsingTemplate.name}" dan tidak dapat dihapus.` });
  }
  
  // 3. Hapus file overlay gambar dari disk jika itu template kustom (file-nya ada di templates/ folder)
  // Default templates overlayUrl: /templates/classic_strip_3.svg dll. (jangan dihapus)
  // Uploaded templates overlayUrl: /templates/template_...
  if (template.overlayUrl && template.overlayUrl.startsWith('/templates/template_')) {
    const filename = path.basename(template.overlayUrl);
    const filePath = path.join(TEMPLATES_DIR, filename);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        console.log(`[Database] File overlay template berhasil dihapus dari disk: ${filePath}`);
      } catch (unlinkErr) {
        console.error(`Gagal menghapus file overlay template dari disk:`, unlinkErr);
      }
    }
  }
  
  // 4. Hapus dari array templates dan simpan ke file templates.json
  templates.splice(templateIndex, 1);
  writeJSON(TEMPLATES_FILE, templates);
  
  res.json({ success: true });
});

// 4. API Upload Hasil Foto Sesi (Canvas Capture)
app.post('/api/upload', (req, res) => {
  const { image, rawImages, eventSlug } = req.body;
  if (!image) return res.status(400).json({ error: 'Gambar tidak ditemukan' });

  // Cari event
  const slug = eventSlug || 'demo';
  const targetEvent = events.find(e => e.slug === slug) || { slug: 'demo', name: 'Demo' };

  // Buat folder khusus event jika belum ada
  const eventDir = path.join(UPLOADS_DIR, 'events', targetEvent.slug);
  if (!fs.existsSync(eventDir)) {
    fs.mkdirSync(eventDir, { recursive: true });
  }

  // Bersihkan data URL (base64)
  const isJpeg = image.startsWith('data:image/jpeg');
  const base64Data = image.replace(/^data:image\/(png|jpeg);base64,/, "");
  const extension = isJpeg ? 'jpg' : 'png';
  const timestamp = Date.now();
  const fileName = `session_${timestamp}.${extension}`;
  const filePath = path.join(eventDir, fileName);

  fs.writeFile(filePath, base64Data, 'base64', async (err) => {
    if (err) {
      console.error('Gagal menyimpan foto kolase:', err);
      return res.status(500).json({ error: 'Gagal menyimpan foto.' });
    }

    // URL file foto untuk diunduh
    const photoUrl = `${req.protocol}://${req.get('host')}/uploads/events/${targetEvent.slug}/${fileName}`;

    try {
      // Simpan foto asli (tanpa frame) jika dilampirkan
      if (Array.isArray(rawImages) && rawImages.length > 0) {
        rawImages.forEach((rawImgData, idx) => {
          if (!rawImgData) return;
          try {
            const match = rawImgData.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,/);
            const rawMime = match ? match[1] : 'jpeg';
            const rawBase64 = rawImgData.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "");
            const rawExt = (rawMime === 'png') ? 'png' : 'jpg';
            const rawFileName = `session_${timestamp}_raw_${idx + 1}.${rawExt}`;
            const rawFilePath = path.join(eventDir, rawFileName);
            
            fs.writeFileSync(rawFilePath, rawBase64, 'base64');
            console.log(`[Raw Photo] Berhasil menyimpan foto asli ke ${rawFilePath}`);

            // Integrasi Google Drive untuk foto asli
            if (config.googleDriveEnabled && config.googleDriveClientEmail && config.googleDrivePrivateKey) {
              console.log(`[Drive Integration] Mengunggah foto asli ${rawFileName} ke Google Drive`);
              uploadToGoogleDrive(rawFilePath, config.googleDriveFolderId, {
                clientEmail: config.googleDriveClientEmail,
                privateKey: config.googleDrivePrivateKey
              }).catch(err => {
                console.error(`[Drive Integration] Gagal mengunggah foto asli ke Google Drive:`, err.message);
              });
            }
          } catch (rawErr) {
            console.error(`[Raw Photo] Gagal menyimpan foto asli ke-${idx + 1}:`, rawErr);
          }
        });
      }

      // Generate QR Code untuk download langsung
      const qrDataUrl = await qrcode.toDataURL(photoUrl);

      // Integrasi Google Drive
      if (config.googleDriveEnabled && config.googleDriveClientEmail && config.googleDrivePrivateKey) {
        console.log(`[Drive Integration] Mengunggah ${fileName} ke Google Drive folder ID: ${config.googleDriveFolderId}`);
        uploadToGoogleDrive(filePath, config.googleDriveFolderId, {
          clientEmail: config.googleDriveClientEmail,
          privateKey: config.googleDrivePrivateKey
        }).catch(err => {
          console.error(`[Drive Integration] Gagal mengunggah ke Google Drive:`, err.message);
        });
      }

      res.json({
        success: true,
        photoUrl: photoUrl,
        qrCode: qrDataUrl,
        fileName: fileName
      });
    } catch (qrErr) {
      console.error('Gagal generate QR Code:', qrErr);
      res.json({ success: true, photoUrl: photoUrl, fileName: fileName });
    }
  });
});

// 5. API Ambil Foto per Event
app.get('/api/event/:slug/photos', (req, res) => {
  const slug = req.params.slug;
  const eventDir = path.join(UPLOADS_DIR, 'events', slug);
  
  if (!fs.existsSync(eventDir)) {
    return res.json([]);
  }

  fs.readdir(eventDir, (err, files) => {
    if (err) {
      return res.status(500).json({ error: 'Gagal memuat galeri.' });
    }

    const allFiles = files.filter(file => ['.png', '.jpg', '.jpeg'].includes(path.extname(file).toLowerCase()));
    
    // Helper untuk mem-parsing timestamp sesi dari nama file (format: session_1234567890)
    const getSessionTimestamp = (fileName) => {
      const match = fileName.match(/session_(\d+)/);
      return match ? parseInt(match[1]) : 0;
    };

    const collages = allFiles.filter(file => !file.includes('_raw_'));
    const raws = allFiles.filter(file => file.includes('_raw_'));

    // Buat lookup map untuk rawPhotos per collage
    const rawLookup = {};
    collages.forEach(file => {
      const ext = path.extname(file);
      const baseName = path.basename(file, ext);
      const matched = raws
        .filter(rawFile => rawFile.startsWith(`${baseName}_raw_`))
        .map(rawFile => `/uploads/events/${slug}/${rawFile}`)
        .sort((x, y) => {
          const matchX = x.match(/_raw_(\d+)/);
          const matchY = y.match(/_raw_(\d+)/);
          const idxX = matchX ? parseInt(matchX[1]) : 0;
          const idxY = matchY ? parseInt(matchY[1]) : 0;
          return idxX - idxY;
        });
      rawLookup[baseName] = matched;
    });

    const photos = allFiles.map(file => {
      const ext = path.extname(file);
      const baseName = path.basename(file, ext);
      const timestamp = getSessionTimestamp(file);
      const isRaw = file.includes('_raw_');
      let rawIndex = 999;
      if (isRaw) {
        const match = file.match(/_raw_(\d+)/);
        rawIndex = match ? parseInt(match[1]) : 999;
      }
      
      // Cari collage base name untuk mengaitkan rawPhotos
      let collageBase = baseName;
      if (isRaw) {
        collageBase = baseName.split('_raw_')[0];
      }

      return {
        name: file,
        url: `/uploads/events/${slug}/${file}`,
        isRaw: isRaw,
        rawIndex: rawIndex,
        timestamp: timestamp,
        rawPhotos: rawLookup[collageBase] || [],
        time: fs.statSync(path.join(eventDir, file)).mtimeMs
      };
    })
    .sort((a, b) => {
      // 1. Urutkan berdasarkan timestamp sesi secara menurun (sesi terbaru di atas)
      if (b.timestamp !== a.timestamp) {
        return b.timestamp - a.timestamp;
      }
      // 2. Dalam sesi yang sama, kolase utama (isRaw = false) harus muncul pertama
      if (a.isRaw !== b.isRaw) {
        return a.isRaw ? 1 : -1;
      }
      // 3. Jika sama-sama foto mentah/raw, urutkan berdasarkan indeks (raw_1, raw_2, raw_3) secara menaik
      return a.rawIndex - b.rawIndex;
    });

    res.json(photos);
  });
});

// Jalankan Server
server.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`SERVER RUNNING: http://localhost:${PORT}`);
  console.log(`Mode Kamera DSLR Hotfolder aktif: ${config.dslrEnabled}`);
  console.log(`Silakan akses http://localhost:${PORT} untuk memulai`);
  console.log(`==================================================`);
});
