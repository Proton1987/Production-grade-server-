# 🎬 Video Watermark Studio

Production-grade video watermarking server รองรับหลายผู้ใช้พร้อมกัน ทุก platform

## ✨ Features

- **ลายน้ำข้อความ** — หลายจุดพร้อมกัน, เลือกฟอนต์/สี/ขนาด
- **ลายน้ำรูปภาพ/โลโก้** — PNG, JPG, WebP, SVG, GIF
- **ทั้งสองแบบพร้อมกัน** — text + image watermark
- **ปรับตำแหน่งด้วยการลาก** — drag & drop บน preview
- **Tile mode** — ลายน้ำทั้งภาพ
- **Export MP4** จริงๆ ด้วย FFmpeg (H.264 + AAC)
- **Real-time progress** ผ่าน Socket.IO
- **Job queue** — รองรับหลาย user พร้อมกัน
- **Auto cleanup** — ลบไฟล์อัตโนมัติหลัง 1 ชั่วโมง
- **Rate limiting** — ป้องกัน abuse
- **รองรับไฟล์สูงสุด 2 GB**

## 🚀 วิธีติดตั้ง

### วิธีที่ 1: รันตรงๆ (Local / VPS)

```bash
# ต้องติดตั้ง Node.js 18+ และ FFmpeg ก่อน

# Ubuntu/Debian
sudo apt update && sudo apt install -y ffmpeg nodejs npm

# macOS
brew install ffmpeg node

# Clone/copy โปรเจค แล้ว:
cd watermark-server
npm install
npm start
# เปิด http://localhost:3000
```

### วิธีที่ 2: Docker (แนะนำ)

```bash
# รัน single container
docker build -t watermark-server .
docker run -p 3000:3000 \
  -v $(pwd)/outputs:/app/outputs \
  watermark-server

# หรือใช้ Docker Compose (with Nginx)
docker-compose up -d
```

### วิธีที่ 3: Deploy บน Cloud

#### Railway (ฟรี / ง่ายที่สุด)
```bash
npm install -g railway
railway login
railway init
railway up
# Railway จะ detect Dockerfile อัตโนมัติ
```

#### Render.com
- สร้าง New Web Service
- Connect GitHub repo
- Environment: Docker
- จบ ✅

#### DigitalOcean / AWS EC2 / Google Cloud
```bash
# ติดตั้ง Docker บน server
curl -fsSL https://get.docker.com | sh

# Copy ไฟล์ขึ้น server แล้ว:
docker-compose -f docker-compose.yml up -d

# ดู logs
docker-compose logs -f watermark
```

## ⚙️ Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `MAX_CONCURRENT` | `3` | งาน FFmpeg พร้อมกันสูงสุด |
| `NODE_ENV` | `development` | production ลด logs |

## 📁 Project Structure

```
watermark-server/
├── src/
│   ├── server.js      # Express + Socket.IO server
│   ├── watermark.js   # FFmpeg processing engine
│   └── cleanup.js     # Auto file cleanup
├── public/
│   └── index.html     # Frontend UI
├── uploads/           # Temp input files
├── outputs/           # Processed videos (1hr TTL)
├── Dockerfile
├── docker-compose.yml
├── nginx.conf
└── package.json
```

## 🔧 Customization

### เพิ่ม MAX_CONCURRENT jobs
ใน `src/server.js` บรรทัด `const MAX_CONCURRENT = 3;`

### เปลี่ยน output quality
ใน `src/watermark.js`:
```js
'-crf 23',      // ยิ่งน้อย = คุณภาพสูง (18-28)
'-preset fast', // ultrafast, fast, medium, slow
```

### ปิด Rate Limiting
ลบ `app.use('/api/', rateLimit(...))` ใน server.js

## 🛡️ Security

- Rate limiting: 30 requests / 15 นาที ต่อ IP
- File type validation (video + image only)
- Max file size: 2 GB
- Output files auto-delete หลัง 1 ชั่วโมง
- ไม่มี file path traversal

## 📊 Performance

- FFmpeg ใช้ `libx264 -preset fast` — balance ระหว่าง speed/quality
- Socket.IO ส่ง progress ทุก frame
- Nginx buffering ปิด — รองรับ upload ไฟล์ใหญ่
- Docker mem limit 2GB, CPU 2 cores (ปรับได้ใน docker-compose.yml)
