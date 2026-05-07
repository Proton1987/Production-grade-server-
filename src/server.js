const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const { processWatermark } = require('./watermark');
const { cleanupOldFiles } = require('./cleanup');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 1e8
});

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const OUTPUT_DIR = path.join(__dirname, '..', 'outputs');
const TEMP_DIR   = path.join(__dirname, '..', 'temp');

[UPLOAD_DIR, OUTPUT_DIR, TEMP_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/outputs', express.static(OUTPUT_DIR));

// Rate limiting
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many requests, please try again later.' }
}));

// ── Job Queue (simple in-memory, supports concurrent jobs) ──────────────────
const MAX_CONCURRENT = 3;
const jobQueue = [];
const activeJobs = new Map();
let activeCount = 0;

function enqueueJob(job) {
  jobQueue.push(job);
  processQueue();
}

async function processQueue() {
  while (activeCount < MAX_CONCURRENT && jobQueue.length > 0) {
    const job = jobQueue.shift();
    activeCount++;
    activeJobs.set(job.jobId, job);
    try {
      await runJob(job);
    } catch (err) {
      console.error('Job error:', err);
      io.to(job.socketId).emit('job:error', { jobId: job.jobId, error: err.message });
    } finally {
      activeCount--;
      activeJobs.delete(job.jobId);
      processQueue();
    }
  }
}

async function runJob(job) {
  const { jobId, socketId, inputPath, logoPath, options } = job;
  const outputFile = `${jobId}.mp4`;
  const outputPath = path.join(OUTPUT_DIR, outputFile);

  io.to(socketId).emit('job:start', { jobId, message: 'เริ่มประมวลผล...' });

  await processWatermark({
    inputPath,
    outputPath,
    logoPath,
    options,
    onProgress: (percent, fps, time) => {
      io.to(socketId).emit('job:progress', { jobId, percent, fps, time });
    }
  });

  // Cleanup input
  try { fs.unlinkSync(inputPath); } catch {}
  if (logoPath) try { fs.unlinkSync(logoPath); } catch {}

  const stat = fs.statSync(outputPath);
  io.to(socketId).emit('job:done', {
    jobId,
    url: `/outputs/${outputFile}`,
    filename: outputFile,
    size: stat.size
  });

  // Auto-delete output after 1 hour
  setTimeout(() => {
    try { fs.unlinkSync(outputPath); } catch {}
  }, 60 * 60 * 1000);
}

// ── File Upload ─────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB
  fileFilter: (req, file, cb) => {
    const allowed = [
      'video/mp4','video/webm','video/quicktime','video/x-msvideo',
      'video/x-matroska','video/mpeg','image/png','image/jpeg',
      'image/gif','image/webp','image/svg+xml'
    ];
    cb(null, allowed.includes(file.mimetype));
  }
});

// ── REST API ─────────────────────────────────────────────────────────────────
app.post('/api/upload', upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'logo',  maxCount: 1 }
]), (req, res) => {
  try {
    const video = req.files?.video?.[0];
    const logo  = req.files?.logo?.[0];
    if (!video) return res.status(400).json({ error: 'No video file' });

    const jobId   = uuidv4();
    const options = JSON.parse(req.body.options || '{}');
    const socketId = req.body.socketId;

    if (!socketId) return res.status(400).json({ error: 'socketId required' });

    const job = {
      jobId,
      socketId,
      inputPath: video.path,
      logoPath:  logo?.path || null,
      options
    };

    const queuePos = jobQueue.length;
    enqueueJob(job);

    res.json({
      jobId,
      queued: queuePos > 0,
      position: queuePos,
      message: queuePos > 0 ? `อยู่ในคิวที่ ${queuePos + 1}` : 'เริ่มประมวลผลแล้ว'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/status', (req, res) => {
  res.json({
    active: activeCount,
    queued: jobQueue.length,
    maxConcurrent: MAX_CONCURRENT,
    jobs: [...activeJobs.keys()]
  });
});

app.get('/api/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// ── Socket.IO ────────────────────────────────────────────────────────────────
io.on('connection', socket => {
  console.log('Client connected:', socket.id);
  socket.emit('connected', { socketId: socket.id });

  socket.on('cancel:job', jobId => {
    const idx = jobQueue.findIndex(j => j.jobId === jobId);
    if (idx !== -1) {
      jobQueue.splice(idx, 1);
      socket.emit('job:cancelled', { jobId });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// ── Cleanup cron (every 30 min) ─────────────────────────────────────────────
setInterval(() => cleanupOldFiles([OUTPUT_DIR, UPLOAD_DIR, TEMP_DIR]), 30 * 60 * 1000);

httpServer.listen(PORT, () => {
  console.log(`\n🎬 Watermark Server running on http://localhost:${PORT}`);
  console.log(`   Max concurrent jobs: ${MAX_CONCURRENT}`);
  console.log(`   Upload limit: 2 GB\n`);
});

module.exports = { app, httpServer };
