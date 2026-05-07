const ffmpeg = require('fluent-ffmpeg');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');

/**
 * Build FFmpeg filter_complex for watermarking
 * Supports: text overlay, image overlay, tile mode, custom position, opacity, rotation
 */
function buildFilters(options, logoPath) {
  const {
    type = 'text',
    text = 'Watermark',
    fontsize = 36,
    fontcolor = 'white',
    font = 'Arial',
    opacity = 0.7,
    rotation = -30,
    position = 'bottom-right',
    padding = 20,
    tile = false,
    customX = null,
    customY = null,
    // Image logo options
    logoWidth = 120,
    // Text shadow/outline
    shadowColor = 'black',
    shadowOpacity = 0.5,
    // Extra text layers (multi-watermark)
    extraMarks = []
  } = options;

  const filters = [];
  let lastOutput = '[0:v]';
  let outIdx = 1;

  const buildPosition = (posStr, pad, tw, th, vw = 'W', vh = 'H') => {
    if (posStr === 'bottom-right') return { x: `${vw}-${tw}-${pad}`, y: `${vh}-${th}-${pad}` };
    if (posStr === 'bottom-left')  return { x: `${pad}`, y: `${vh}-${th}-${pad}` };
    if (posStr === 'top-right')    return { x: `${vw}-${tw}-${pad}`, y: `${pad}` };
    if (posStr === 'top-left')     return { x: `${pad}`, y: `${pad}` };
    if (posStr === 'center')       return { x: `(${vw}-${tw})/2`, y: `(${vh}-${th})/2` };
    return { x: `${pad}`, y: `${pad}` };
  };

  if (type === 'text' || type === 'both') {
    const allTexts = [{ text, fontsize, fontcolor, font, opacity, rotation, position, padding, customX, customY }, ...extraMarks];

    for (const mark of allTexts) {
      const mText   = (mark.text || text).replace(/'/g, "\\'").replace(/:/g, '\\:');
      const mSize   = mark.fontsize || fontsize;
      const mColor  = hexToFFmpegColor(mark.fontcolor || fontcolor, mark.opacity ?? opacity);
      const mFont   = mark.font || font;
      const mRot    = (mark.rotation ?? rotation) * (Math.PI / 180);
      const mPad    = mark.padding ?? padding;
      const mPos    = mark.position || position;
      const mTile   = mark.tile ?? tile;
      const mCx     = mark.customX ?? customX;
      const mCy     = mark.customY ?? customY;

      let x, y;
      if (mCx !== null && mCy !== null) {
        x = String(mCx);
        y = String(mCy);
      } else if (mTile || mPos === 'tile') {
        x = `mod(n*2+${mPad},W)`;
        y = `mod(n*3+${mPad},H)`;
      } else {
        const pos = buildPosition(mPos, mPad, `tw`, `th`);
        x = pos.x; y = pos.y;
      }

      const shadowAlpha = Math.round((mark.shadowOpacity ?? shadowOpacity) * 255).toString(16).padStart(2,'0');
      const sdColor = `${mark.shadowColor || shadowColor}@0.${Math.round((mark.shadowOpacity ?? shadowOpacity)*10)}`;

      const tag = `[v${outIdx}]`;
      const drawtext = `${lastOutput}drawtext=` +
        `text='${mText}':` +
        `fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:` +
        `fontsize=${mSize}:` +
        `fontcolor=${mColor}:` +
        `shadowcolor=${sdColor}:shadowx=2:shadowy=2:` +
        `x=${x}:y=${y}:` +
        `alpha='${mark.opacity ?? opacity}'` +
        tag;

      filters.push(drawtext);
      lastOutput = tag;
      outIdx++;
    }
  }

  if ((type === 'image' || type === 'both') && logoPath && fs.existsSync(logoPath)) {
    const logoH = Math.round(logoWidth * 9 / 16); // estimate, ffmpeg will auto
    const mOpacity = opacity;
    const mPad = padding;
    const mPos = position;
    const mCx = customX;
    const mCy = customY;
    const mRot = rotation;

    let x, y;
    if (mCx !== null && mCy !== null) {
      x = String(mCx);
      y = String(mCy);
    } else if (tile || position === 'tile') {
      x = `mod(n*5+${mPad},main_w-overlay_w)`;
      y = `mod(n*7+${mPad},main_h-overlay_h)`;
    } else {
      const pos = buildPosition(mPos, mPad, 'overlay_w', 'overlay_h', 'main_w', 'main_h');
      x = pos.x; y = pos.y;
    }

    // Scale logo then apply alpha
    const scaleTag  = `[logo_scaled]`;
    const alphaTag  = `[logo_alpha]`;
    const rotateTag = mRot !== 0 ? `[logo_rotated]` : alphaTag;

    filters.push(`[1:v]scale=${logoWidth}:-1${scaleTag}`);
    filters.push(`${scaleTag}format=rgba,colorchannelmixer=aa=${mOpacity}${alphaTag}`);

    const overlayOut = `[v${outIdx}]`;
    filters.push(`${lastOutput}${alphaTag}overlay=${x}:${y}${overlayOut}`);
    lastOutput = overlayOut;
    outIdx++;
  }

  return { filters, lastOutput };
}

function hexToFFmpegColor(hex, alpha = 1) {
  if (hex.startsWith('#')) hex = hex.slice(1);
  if (hex.length === 3) hex = hex.split('').map(c => c+c).join('');
  const a = Math.round(alpha * 255).toString(16).padStart(2,'0');
  return `0x${hex}${a}`;
}

/**
 * Main watermark processing function
 */
async function processWatermark({ inputPath, outputPath, logoPath, options, onProgress }) {
  return new Promise((resolve, reject) => {
    const { filters, lastOutput } = buildFilters(options, logoPath);

    let cmd = ffmpeg(inputPath);

    if (logoPath && fs.existsSync(logoPath) && (options.type === 'image' || options.type === 'both')) {
      cmd = cmd.input(logoPath);
    }

    // Hardware acceleration detection
    const hwAccel = process.env.HW_ACCEL || 'auto';

    cmd = cmd
      .outputOptions([
        '-c:v libx264',
        '-preset fast',
        '-crf 23',
        '-c:a aac',
        '-b:a 192k',
        '-movflags +faststart',
        '-pix_fmt yuv420p',
        '-max_muxing_queue_size 9999'
      ]);

    if (filters.length > 0) {
      cmd = cmd.complexFilter(filters, lastOutput.replace(/[\[\]]/g, ''));
    }

    let duration = 0;

    cmd
      .output(outputPath)
      .on('start', cmdLine => {
        console.log('FFmpeg started:', cmdLine.substring(0, 120) + '...');
      })
      .on('codecData', data => {
        const match = data.duration?.match(/(\d+):(\d+):(\d+\.\d+)/);
        if (match) {
          duration = parseInt(match[1])*3600 + parseInt(match[2])*60 + parseFloat(match[3]);
        }
      })
      .on('progress', progress => {
        let percent = progress.percent || 0;
        if (!percent && duration && progress.timemark) {
          const tm = progress.timemark?.match(/(\d+):(\d+):(\d+\.\d+)/);
          if (tm) {
            const current = parseInt(tm[1])*3600 + parseInt(tm[2])*60 + parseFloat(tm[3]);
            percent = Math.min(99, (current / duration) * 100);
          }
        }
        onProgress?.(Math.round(percent), progress.currentFps || 0, progress.timemark || '');
      })
      .on('end', () => {
        onProgress?.(100, 0, '');
        resolve(outputPath);
      })
      .on('error', (err, stdout, stderr) => {
        console.error('FFmpeg error:', err.message);
        console.error('stderr:', stderr?.slice(-500));
        reject(new Error(`FFmpeg error: ${err.message}`));
      })
      .run();
  });
}

module.exports = { processWatermark };
