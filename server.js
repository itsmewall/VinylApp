// server.js — hospeda o app (index.html + main.js + style.css)
// Reqs: node >= 16
// npm i express morgan dotenv

require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const path = require('path');

const PORT = process.env.PORT || 5050;
const HOST = process.env.HOST || '0.0.0.0';
const app = express();

app.disable('x-powered-by');
app.use(morgan('dev'));

// CSP mínima p/ YouTube IFrame API e thumbs
app.use((req, res, next) => {
    res.setHeader(
    'Content-Security-Policy',
    [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https://i.ytimg.com",
        "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
        "media-src 'self' https://*.googlevideo.com https://www.youtube.com blob:",
        "connect-src 'self' https://www.youtube.com https://s.ytimg.com https://*.googlevideo.com",
        "worker-src 'self' blob:",
        "base-uri 'self'"
    ].join('; ')
    );
  next();
});

// cache leve p/ assets
app.use((req, res, next) => {
  if (/\.(js|css|png|jpg|svg|ico|woff2?)$/i.test(req.url)) {
    res.set('Cache-Control', 'public, max-age=86400'); // 1 dia
  } else {
    res.set('Cache-Control', 'no-store');
  }
  next();
});

// serve estáticos de /public
const pub = path.join(__dirname, 'public');
app.use(express.static(pub, { etag: true }));

// fallback SPA (Express 5: use regex ou '/*', não '*')
app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(pub, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`[READY] http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});
