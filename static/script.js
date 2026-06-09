// ═══════════════════════════════════════════════════════════
//  BlightGuard — script.js  (complete)
// ═══════════════════════════════════════════════════════════

const API_URL = '/predict';

// ── RECOMMENDATIONS ─────────────────────────────────────────
const RECS = {
  healthy: [
    { icon: '💧', title: 'Watering',    text: 'Water at the base. Avoid wetting leaves to prevent fungal issues.' },
    { icon: '☀️', title: 'Sunlight',    text: 'Ensure 6–8 hours of direct sunlight daily for optimal growth.' },
    { icon: '🌱', title: 'Fertilising', text: 'Apply balanced NPK fertiliser every 2 weeks during growing season.' },
    { icon: '👁️', title: 'Monitoring',  text: 'Inspect leaves every 3 days for early signs of disease or pests.' },
    { icon: '✂️', title: 'Pruning',     text: 'Remove suckers and yellowing leaves to improve airflow.' },
  ],
  blight: [
    { icon: '✂️', title: 'Remove Leaves',         text: 'Immediately remove and destroy all visibly infected leaves.' },
    { icon: '🧴', title: 'Apply Fungicide',        text: 'Use copper-based or chlorothalonil fungicide as per label.' },
    { icon: '🌬️', title: 'Improve Airflow',        text: 'Increase plant spacing and prune dense foliage to reduce humidity.' },
    { icon: '💧', title: 'Stop Overhead Watering', text: 'Switch to drip irrigation — wet foliage accelerates spread.' },
    { icon: '🔁', title: 'Crop Rotation',          text: 'Avoid planting tomatoes in the same spot next season.' },
  ]
};

// ── SEVERITY from blight box count ──────────────────────────
// Bar has 3 zones:  green (Low) | orange (Moderate) | red (High)
// Pointer sits in the zone that matches the result.
// Positions:  Low = ~16%  |  Moderate = ~50%  |  High = ~84%
function getSeverity(blightCount) {

  if (blightCount === 0)
    return {
      label: 'None',
      pct: 0,
      color: '#4e7d34',
      zone: 'none'
    };

  if (blightCount <= 2)
    return {
      label: 'Low',
      pct: 16,
      color: '#d4a017',
      zone: 'low'
    };

  if (blightCount <= 5)
    return {
      label: 'Moderate',
      pct: 50,
      color: '#b9770e',
      zone: 'moderate'
    };

  return {
    label: 'High',
    pct: 84,
    color: '#c0392b',
    zone: 'high'
  };
}
// ── STATE ────────────────────────────────────────────────────
let uploadedFile = null;
let currentImage = null;
let scanHistory  = JSON.parse(localStorage.getItem('bg_history') || '[]');
let cameraRunning = false;
let cameraStream = null;
let cameraInterval = null;
let statsChart = null;

// ── DOM REFS ─────────────────────────────────────────────────
const canvas = document.getElementById('analysis-canvas');
const ctx = canvas.getContext('2d');

const btnUpload = document.getElementById('btn-upload');
const btnScan = document.getElementById('btn-scan');
const btnCamera = document.getElementById('btn-camera');
const video          = document.getElementById('camera-feed');
const cameraWrapper  = document.getElementById('camera-wrapper');
const cameraOverlay  = document.getElementById('camera-overlay');
const overlayCtx     = cameraOverlay.getContext('2d');
const alertBanner = document.getElementById('status-alert');
const dataRows = document.querySelectorAll('#diagnostic-data-container .data-row strong');
const summaryEl = document.getElementById('diagnosis-summary');
const meterUI = document.getElementById('severity-meter-ui');
const scansList = document.getElementById('recent-scans-list');
const recList = document.querySelector('.rec-list');

// ── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  injectStyles();

  // Hide original static elements — we replace them with JS-built ones
  if (summaryEl) summaryEl.style.display = 'none';
  if (meterUI)   meterUI.style.display   = 'none';

  buildStatusAndBar(); // inject status text + severity bar after summaryEl
  drawPlaceholder();
  renderRecs('healthy');
  renderHistory();
});

// ── STYLES ───────────────────────────────────────────────────
function injectStyles() {
  const s = document.createElement('style');
  s.textContent = `
    /* Alert banner */
    #status-alert {
      display: none;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 6px;
      font-size: 0.88rem;
      font-weight: bold;
      margin-bottom: 10px;
    }
    #status-alert.is-blight  { background: #c0392b; color: #fff; }
    #status-alert.is-healthy { background: #4e7d34; color: #fff; }

    /* Data row value colours */
    .val-red   { color: #c0392b !important; font-weight: bold; }
    .val-green { color: #4e7d34 !important; font-weight: bold; }
    .val-orange{ color: #e8900a !important; font-weight: bold; }

    /* ── Status message block ── */
    #bg-msg-block { display: none; margin: 8px 0 12px; }

    .bg-msg-line {
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 0.85rem;
      font-weight: bold;
      margin-bottom: 3px;
    }
    .bg-msg-line.is-blight  { color: #c0392b; }
    .bg-msg-line.is-healthy { color: #4e7d34; }

    .bg-msg-sub {
      font-size: 0.76rem;
      color: #555;
      margin-left: 23px;
      margin-bottom: 12px;
    }

    /* ── Severity bar ── */
    #bg-bar-outer { margin-top: 2px; }

    #bg-bar-track {
      position: relative;
      height: 8px;
      border-radius: 4px;
      /* green | orange | light-gray — matching screenshot */
      background: linear-gradient(
        to right,
        #4e7d34  0%,  #4e7d34  33%,
        #e8900a 33%,  #e8900a 66%,
        #c0c0c0 66%,  #c0c0c0 100%
      );
    }

    #bg-bar-ptr {
      position: absolute;
      top: 50%;
      left: 2%;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #e8900a;
      border: 2.5px solid #fff;
      box-shadow: 0 0 0 2px rgba(0,0,0,0.2);
      transform: translate(-50%, -50%);
      transition: left 0.55s cubic-bezier(.4,0,.2,1),
                  background 0.4s ease;
    }

    #bg-bar-labels {
      display: flex;
      justify-content: space-between;
      font-size: 0.7rem;
      font-weight: 600;
      margin-top: 5px;
    }
    #bg-bar-labels .bl-low      { color: #4e7d34; }
    #bg-bar-labels .bl-moderate { color: #e8900a; }
    #bg-bar-labels .bl-high     { color: #c0392b; }

    /* Scan history cards */
    .scan-card {
      width: 110px; flex-shrink: 0; border-radius: 8px;
      overflow: hidden; border: 2px solid #e0e6db;
      cursor: pointer; transition: border-color .2s;
    }
    .scan-card:hover { border-color: #4e7d34; }
    .scan-card img   { width: 100%; height: 75px; object-fit: cover; display: block; }
    .sc-info  { padding: 5px 6px; }
    .sc-label { font-size: 11px; font-weight: bold; }
    .sc-date  { font-size: 10px; color: #999; }
    .sc-red   { color: #c0392b; }
    .sc-green { color: #4e7d34; }

    /* Spinner */
    .bg-spin-wrap { text-align: center; padding: 18px 0; }
    .bg-spinner   {
      display: inline-block; width: 26px; height: 26px;
      border: 3px solid #e0e6db; border-top-color: #4e7d34;
      border-radius: 50%; animation: _bgs .7s linear infinite;
    }
    @keyframes _bgs { to { transform: rotate(360deg); } }
    .bg-spin-msg { font-size: 12px; color: #999; margin-top: 6px; }
  `;
  document.head.appendChild(s);
}

// ── BUILD STATUS BLOCK + SEVERITY BAR ───────────────────────
// Inserted once into DOM right after the #diagnosis-summary paragraph.
function buildStatusAndBar() {
  if (document.getElementById('bg-msg-block')) return;

  const msgBlock = document.createElement('div');
  msgBlock.id = 'bg-msg-block';

  msgBlock.innerHTML = `
    <div id="bg-msg-line" class="bg-msg-line">
      <span id="bg-msg-icon">⚠️</span>
      <span id="bg-msg-text">Waiting for scan...</span>
    </div>
    <div id="bg-msg-sub" class="bg-msg-sub">
      Upload an image to begin analysis.
    </div>
  `;

  const barOuter = document.createElement('div');
  barOuter.id = 'bg-bar-outer';

  barOuter.innerHTML = `
    <div id="bg-bar-track">
      <div id="bg-bar-ptr"></div>
    </div>
    <div id="bg-bar-labels">
      <span class="bl-low">Low</span>
      <span class="bl-moderate">Moderate</span>
      <span class="bl-high">High</span>
    </div>
  `;

  if (summaryEl && summaryEl.parentNode) {
    summaryEl.insertAdjacentElement('afterend', msgBlock);
    msgBlock.insertAdjacentElement('afterend', barOuter);
  }
}
// ── UPDATE STATUS BLOCK ──────────────────────────────────────
function setStatus(isHealthy, sev) {
  const block   = document.getElementById('bg-msg-block');
  const line    = document.getElementById('bg-msg-line');
  const icon    = document.getElementById('bg-msg-icon');
  const text    = document.getElementById('bg-msg-text');
  const sub     = document.getElementById('bg-msg-sub');
  const ptr     = document.getElementById('bg-bar-ptr');

  if (!block) return;
  block.style.display = 'block';

  if (isHealthy) {
    line.className   = 'bg-msg-line is-healthy';
    icon.innerHTML   = ``;
    text.textContent = 'Healthy plant.';
    sub.textContent  = 'Continue with good agronomic practices.';
  } else {
    line.className  = 'bg-msg-line is-blight';
    icon.innerHTML  = `
      
      
      `;
    text.textContent = 'Early blight symptoms detected.';
    sub.textContent  = 'Quickly take action to prevent further spread.';
  }

  // Move pointer — hide on healthy (no blight)
  if (ptr) {
    if (isHealthy || sev.zone === 'none') {
      ptr.style.opacity = '0';
    } else {
      ptr.style.opacity    = '1';
      ptr.style.left       = sev.pct + '%';
      ptr.style.background = sev.color;
    }
  }
}

// ── CANVAS ───────────────────────────────────────────────────
function drawPlaceholder() {
  const w = canvas.offsetWidth  || 300;
  const h = canvas.offsetHeight || 200;
  canvas.width = w; canvas.height = h;
  ctx.fillStyle   = '#f5f7f4';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle   = '#bbb';
  ctx.font        = '13px Segoe UI';
  ctx.textAlign   = 'center';
  ctx.fillText('Upload a leaf image to begin', w / 2, h / 2);
}

function fitImage(img) {
  const w = canvas.offsetWidth  || 300;
  const h = canvas.offsetHeight || 200;
  canvas.width = w; canvas.height = h;
  const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const dw    = img.naturalWidth  * scale;
  const dh    = img.naturalHeight * scale;
  const dx    = (w - dw) / 2;
  const dy    = (h - dh) / 2;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#f5f7f4';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, dx, dy, dw, dh);
  return { dx, dy, scale };
}

// ── BOUNDING BOXES ───────────────────────────────────────────
// Backend returns x1,y1,x2,y2 in original image pixels
function drawBoxes(boxes, dp) {
  boxes.forEach(b => {
    const x   = dp.dx + b.x1 * dp.scale;
    const y   = dp.dy + b.y1 * dp.scale;
    const w   = (b.x2 - b.x1) * dp.scale;
    const h   = (b.y2 - b.y1) * dp.scale;
    const col = /healthy/i.test(b.label) ? '#4e7d34' : '#c0392b';

    ctx.strokeStyle = col;
    ctx.lineWidth   = 2.5;
    ctx.strokeRect(x, y, w, h);

    // Label tag
    const tag = b.label + '  ' + b.confidence + '%';
    ctx.font  = 'bold 11px Segoe UI';
    const tw  = ctx.measureText(tag).width + 8;
    ctx.fillStyle = col;
    ctx.fillRect(x, y - 18, tw, 17);
    ctx.fillStyle = '#fff';
    ctx.fillText(tag, x + 4, y - 5);
  });
}

// ── UPLOAD ───────────────────────────────────────────────────
btnUpload.addEventListener('click', () => {
  const inp    = document.createElement('input');
  inp.type     = 'file';
  inp.accept   = 'image/*';
  inp.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    uploadedFile     = file;
    btnScan.disabled = false;
    resetDiagnosis();
    const reader   = new FileReader();
    reader.onload  = ev => {
      const img  = new Image();
      img.onload = () => { currentImage = img; fitImage(img); };
      img.src    = ev.target.result;
    };
    reader.readAsDataURL(file);
  };
  inp.click();
});

btnCamera.addEventListener('click', () => {

    if(cameraRunning){

        stopCamera();

    }else{

        startCamera();

    }

});

async function startCamera() {
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = cameraStream;

        // Show camera wrapper, hide upload canvas
        cameraWrapper.style.display = 'block';
        canvas.style.display = 'none';

        btnCamera.textContent = '⛔ Stop Camera';
        cameraRunning = true;

        // Wait for video to have dimensions before starting detection
        video.onloadedmetadata = () => {
            cameraOverlay.width  = video.videoWidth;
            cameraOverlay.height = video.videoHeight;
            startRealtimeDetection();
        };

    } catch (error) {
        console.error(error);
        alert('Unable to access webcam');
    }
}

function stopCamera() {
    if (cameraInterval) clearInterval(cameraInterval);

    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
    }

    // Clear overlay
    overlayCtx.clearRect(0, 0, cameraOverlay.width, cameraOverlay.height);

    cameraWrapper.style.display = 'none';
    canvas.style.display = 'block';

    btnCamera.textContent = '📷 Live Camera';
    cameraRunning = false;
    cameraStream  = null;
    cameraInterval = null;
}

function startRealtimeDetection(){

    cameraInterval =
        setInterval(() => {

            captureFrame();

        },500);

}

function captureFrame() {
    if (!video.videoWidth) return;

    // Keep overlay canvas in sync with actual video dimensions
    if (cameraOverlay.width  !== video.videoWidth)  cameraOverlay.width  = video.videoWidth;
    if (cameraOverlay.height !== video.videoHeight) cameraOverlay.height = video.videoHeight;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width  = video.videoWidth;
    tempCanvas.height = video.videoHeight;
    tempCanvas.getContext('2d').drawImage(video, 0, 0);
    tempCanvas.toBlob(sendFrameToBackend, 'image/jpeg', 0.8);
}

async function sendFrameToBackend(blob){

    const fd =
        new FormData();

    fd.append(
        'file',
        blob,
        'camera.jpg'
    );

    try{

        const res =
            await fetch(
                API_URL,
                {
                    method:'POST',
                    body:fd
                }
            );

        const data =
            await res.json();

        handleCameraResult(data);

    }catch(error){

        console.error(error);
    }
}

// ── SCAN ─────────────────────────────────────────────────────
btnScan.addEventListener('click', async () => {
  if (!uploadedFile) return;

  btnScan.disabled   = true;
  btnUpload.disabled = true;
  resetDiagnosis();
  showSpinner(true);

  const fd = new FormData();
  fd.append('file', uploadedFile);

   try {
    const res = await fetch(API_URL, { method: 'POST', body: fd });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    handleResult(data);
  } catch (err) {
    console.error(err);
    showError('Cannot reach backend. Is your FastAPI server running?');
  } finally {
    showSpinner(false);
    btnScan.disabled   = false;
    btnUpload.disabled = false;
  }
});

// ── HANDLE RESULT ────────────────────────────────────────────
// Backend shape: { boxes:[{x1,y1,x2,y2,confidence,label}], has_detections:bool }
function handleResult(data) {
  const boxes       = data.boxes || [];
  const blightBoxes = boxes.filter(b => !/healthy/i.test(b.label));
  const isHealthy   = !data.has_detections || blightBoxes.length === 0;

  // Average confidence across all detected boxes
  const avgConf = boxes.length
    ? parseFloat((boxes.reduce((s, b) => s + b.confidence, 0) / boxes.length).toFixed(1))
    : 0;

  // Severity based on number of blight boxes
  const sev = getSeverity(blightBoxes.length);

  // Most frequent blight label
  let diseaseLabel = 'Healthy';
  if (blightBoxes.length > 0) {
    const cnt = {};
    blightBoxes.forEach(b => { cnt[b.label] = (cnt[b.label] || 0) + 1; });
    diseaseLabel = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0];
  }

  // ── Alert banner ──
  alertBanner.style.display = 'flex';
  if (isHealthy) {
    alertBanner.className = 'is-healthy';
    alertBanner.innerHTML = `
      
        
      
      Healthy Plant Detected`;
  } else {
    alertBanner.className = 'is-blight';
    alertBanner.innerHTML = `
      
        
        
        
      
      Blight Detected!`;
  }

  // ── Data rows: Confidence | Disease | Detected On | Severity ──
  dataRows[0].textContent = avgConf > 0 ? avgConf + '%' : '—';
  dataRows[0].className   = '';

  dataRows[1].textContent = diseaseLabel;
  dataRows[1].className   = isHealthy ? 'val-green' : 'val-red';

  dataRows[2].textContent = 'Leaf';
  dataRows[2].className   = '';

  dataRows[3].textContent = sev.label;
  dataRows[3].className   = '';
  dataRows[3].style.color = sev.color;

  // ── Status message + bar pointer ──
  setStatus(isHealthy, sev);

  // ── Recommendations ──
  renderRecs(isHealthy ? 'healthy' : 'blight');

  // ── Canvas: redraw image then overlay boxes ──
  if (currentImage) {
    const dp = fitImage(currentImage);
    if (boxes.length > 0) drawBoxes(boxes, dp);
  }

  // ── Save to history ──
  saveHistory({
    label:    diseaseLabel,
    conf:     avgConf > 0 ? avgConf + '%' : '—',
    severity: sev.label,
    sevPct:   sev.pct,
    sevColor: sev.color,
    sevZone:  sev.zone,
    isHealthy,
    dataUrl:  canvas.toDataURL('image/jpeg', 0.5)
  });
}

function handleCameraResult(data) {
    // Clear previous overlay boxes
    overlayCtx.clearRect(0, 0, cameraOverlay.width, cameraOverlay.height);

    const boxes       = data.boxes || [];
    const blightBoxes = boxes.filter(b => !/healthy/i.test(b.label));

    // Only draw boxes if blight is detected — no history, no stats, no diagnosis panel update
    if (!data.has_detections || blightBoxes.length === 0) return;

    // Scale factor: overlay canvas (video resolution) → displayed size
    // The CSS scales the video via object-fit, so we draw at native resolution
    // and CSS handles the visual scaling automatically
    boxes.forEach(b => {
        const col = /healthy/i.test(b.label) ? '#4e7d34' : '#c0392b';

        overlayCtx.strokeStyle = col;
        overlayCtx.lineWidth   = 3;
        overlayCtx.strokeRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1);

        // Label tag
        const tag = b.label + '  ' + b.confidence + '%';
        overlayCtx.font = 'bold 14px Segoe UI';
        const tw = overlayCtx.measureText(tag).width + 10;
        overlayCtx.fillStyle = col;
        overlayCtx.fillRect(b.x1, b.y1 - 22, tw, 20);
        overlayCtx.fillStyle = '#fff';
        overlayCtx.fillText(tag, b.x1 + 5, b.y1 - 6);
    });
}

// ── RECOMMENDATIONS ──────────────────────────────────────────
function renderRecs(type) {

  recList.innerHTML = RECS[type].map(r => `
    <div class="rec-card">

        <div class="rec-icon">
            ${r.icon}
        </div>

        <div class="rec-content">
            <h4>${r.title}</h4>
            <p>${r.text}</p>
        </div>

    </div>
  `).join('');
}

// ── HISTORY ──────────────────────────────────────────────────
function saveHistory(entry) {
  if (cameraRunning) return; // never save live camera frames to history
  entry.date = new Date().toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
  scanHistory.unshift(entry);
  localStorage.setItem('bg_history', JSON.stringify(scanHistory));
  renderHistory();
}

// let statsChart = null;

function updateStatistics() {

    const healthyCount =
        scanHistory.filter(s => s.isHealthy).length;

    const blightCount =
        scanHistory.filter(s => !s.isHealthy).length;

    const totalScans = scanHistory.length;

    document.getElementById('healthy-count').textContent =
        healthyCount;

    document.getElementById('blight-count').textContent =
        blightCount;

    document.getElementById('scan-total').textContent =
        totalScans;

    const canvas =
        document.getElementById('stats-donut');

    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    if (statsChart) {
        statsChart.destroy();
    }

    statsChart = new Chart(ctx, {

        type: 'doughnut',

        data: {

            labels: [
                'Healthy',
                'Early Blight'
            ],

            datasets: [{
                data: [
                    healthyCount,
                    blightCount
                ],

                backgroundColor: [
                    '#4e7d34',
                    '#c0392b'
                ],

                borderWidth: 0
            }]
        },

        options: {

            responsive: true,

            cutout: '65%',

            plugins: {
                legend: {
                    display: false
                }
            }
        }
    })
}

function renderHistory() {

  document.getElementById('scan-total').textContent = scanHistory.length;

  if (!scanHistory.length) {
    scansList.innerHTML = `
      <div class="empty-state">
        No scans yet. Upload a photo to begin.
      </div>
    `;

    updateStatistics();
    return;
  }

  scansList.innerHTML = scanHistory.slice(0, 10).map((s, i) => `
  <div class="scan-card" onclick="replayHistory(${i})" oncontextmenu="deleteHistory(event, ${i})">

        <img src="${s.dataUrl}" />

        <div class="sc-info">

            <div class="sc-label ${s.isHealthy ? 'sc-green' : 'sc-red'}">
                ${s.label}
            </div>

            <div class="sc-date">
                ${s.date}
            </div>

        </div>

    </div>
  `).join('');

  updateStatistics();
}

function deleteHistory(e, i) {
    e.preventDefault(); // stop browser's default right-click menu

    if (!confirm('Delete this scan from history?')) return;

    scanHistory.splice(i, 1);
    localStorage.setItem('bg_history', JSON.stringify(scanHistory));
    renderHistory();
}

function replayHistory(i) {
  const s = scanHistory[i];
  if (!s) return;

  alertBanner.style.display = 'flex';
  if (s.isHealthy) {
    alertBanner.className = 'is-healthy';
    alertBanner.innerHTML = `
      
        
      
      Healthy Plant Detected`;
  } else {
    alertBanner.className = 'is-blight';
    alertBanner.innerHTML = `

      
      Blight Detected!`;
  }

  dataRows[0].textContent = s.conf;
  dataRows[1].textContent = s.label;
  dataRows[1].className   = s.isHealthy ? 'val-green' : 'val-red';
  dataRows[2].textContent = 'Leaf';
  dataRows[3].textContent = s.severity || '—';
  dataRows[3].style.color = s.sevColor  || '#888';

  setStatus(s.isHealthy, {
    pct: s.sevPct || 2, color: s.sevColor || '#4e7d34', zone: s.sevZone || 'none'
  });
  renderRecs(s.isHealthy ? 'healthy' : 'blight');

  const img  = new Image();
  img.onload = () => { currentImage = img; fitImage(img); };
  img.src    = s.dataUrl;
}

// ── RESET ────────────────────────────────────────────────────
function resetDiagnosis() {
  alertBanner.style.display = 'none';
  alertBanner.textContent   = '';
  alertBanner.className     = '';

  const block = document.getElementById('bg-msg-block');
  if (block) block.style.display = 'none';

  const ptr = document.getElementById('bg-bar-ptr');
  if (ptr) { ptr.style.left = '2%'; ptr.style.opacity = '0'; }

  dataRows.forEach(r => {
    r.textContent = '--';
    r.style.color = '';
    r.className   = '';
  });
}

// ── SPINNER ──────────────────────────────────────────────────
function showSpinner(show) {
  let el = document.getElementById('_bgspin');
  if (show) {
    if (!el) {
      el    = document.createElement('div');
      el.id = '_bgspin';
      el.className = 'bg-spin-wrap';
      el.innerHTML =
        '' +
        'Analysing leaf…';
      alertBanner.parentNode.insertBefore(el, alertBanner);
    }
    el.style.display = 'block';
  } else {
    if (el) el.style.display = 'none';
  }
}

// ── ERROR ────────────────────────────────────────────────────
function showError(msg) {
  alertBanner.className    = 'is-blight';
  alertBanner.style.display = 'flex';
  alertBanner.innerHTML    = '❌ ' + msg;
}

// ── EXPORT REPORT ────────────────────────────────────────────
document.querySelector('.export-btn').addEventListener('click', () => {
  const rows = scanHistory.slice(0, 10).map((s, i) =>
    `${i + 1}. ${s.date} | ${s.label} | Confidence: ${s.conf} | Severity: ${s.severity || '—'}`
  ).join('\n');
  const txt  =
    'BlightGuard Report\n' + '='.repeat(30) + '\n' +
    'Generated: ' + new Date().toLocaleString() + '\n\n' +
    'Scan History:\n' + (rows || 'No scans recorded.') + '\n';
  const a    = document.createElement('a');
  a.href     = 'data:text/plain,' + encodeURIComponent(txt);
  a.download = 'blightguard-report.txt';
  a.click();
});
