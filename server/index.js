require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');

const processImageRoute = require('./routes/processImage');
const gamesRoute = require('./routes/games');
const importRoute = require('./routes/import');

const app = express();
const PORT = process.env.PORT || 3000;

// Multer: store uploads in memory (max 20MB per file)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed (JPEG, PNG, WebP, HEIC)'));
    }
  }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static frontend
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/api/process-image', upload.fields([
  { name: 'page1', maxCount: 1 },
  { name: 'page2', maxCount: 1 }
]), processImageRoute);

app.use('/api/games/import', importRoute);
app.use('/api/games', gamesRoute);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend SPA for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🏁 ChessOCR server running at http://localhost:${PORT}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🤖 OpenAI API:  ${process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_openai_api_key_here' ? '✅ configured' : '❌ MISSING - set OPENAI_API_KEY in .env'}`);
    console.log(`   Model: ${process.env.OPENAI_MODEL || 'gpt-4o'}`);
    console.log(`🗄️  Supabase:    ${process.env.SUPABASE_URL ? '✅ configured' : '❌ MISSING'}`);
  });
}

module.exports = app;
