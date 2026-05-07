const fs   = require('fs');
const path = require('path');

const MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

function cleanupOldFiles(dirs) {
  const now = Date.now();
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file === '.gitkeep') continue;
        const fp = path.join(dir, file);
        try {
          const stat = fs.statSync(fp);
          if (now - stat.mtimeMs > MAX_AGE_MS) {
            fs.unlinkSync(fp);
            console.log('Cleaned up:', fp);
          }
        } catch {}
      }
    } catch (err) {
      console.error('Cleanup error in', dir, err.message);
    }
  }
}

module.exports = { cleanupOldFiles };
