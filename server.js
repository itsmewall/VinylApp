// server.js (robusto)
// Requisitos: node >= 16
// npm i express cookie-parser node-fetch@2 dotenv

require('dotenv').config(); // carrega .env no início

const express = require('express');
const path = require('path');
const cookie = require('cookie-parser');
const fetch = require('node-fetch');

const {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  REDIRECT_URI,
  PORT = 5050,
} = process.env;

// Logs iniciais
console.log('[BOOT] ENV:', {
  SPOTIFY_CLIENT_ID: SPOTIFY_CLIENT_ID ? '(ok)' : '(faltando)',
  SPOTIFY_CLIENT_SECRET: SPOTIFY_CLIENT_SECRET ? '(ok)' : '(faltando)',
  REDIRECT_URI,
  PORT,
});

// Guard rails de processo
process.on('unhandledRejection', (e) => {
  console.error('[FATAL] unhandledRejection:', e);
});
process.on('uncaughtException', (e) => {
  console.error('[FATAL] uncaughtException:', e);
});

const app = express();
app.use(cookie());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health e debug
app.get('/__health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.get('/__config', (req, res) =>
  res.json({
    SPOTIFY_CLIENT_ID: !!SPOTIFY_CLIENT_ID,
    HAS_SECRET: !!SPOTIFY_CLIENT_SECRET,
    REDIRECT_URI,
    PORT,
  })
);

// Login → Spotify
function genState(n = 16) {
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < n; i++) s += c[(Math.random() * c.length) | 0];
  return s;
}

app.get('/login', (req, res) => {
  if (!SPOTIFY_CLIENT_ID || !REDIRECT_URI) {
    return res
      .status(500)
      .send('Faltam SPOTIFY_CLIENT_ID/REDIRECT_URI no .env (veja /__config)');
  }
  const scope = [
    'streaming',
    'user-read-email',
    'user-read-private',
    'user-modify-playback-state',
    'user-read-playback-state',
  ].join(' ');
  const state = genState();
  res.cookie('spotify_state', state, { httpOnly: true, sameSite: 'lax' });

  const q = new URLSearchParams({
    response_type: 'code',
    client_id: SPOTIFY_CLIENT_ID,
    scope,
    redirect_uri: REDIRECT_URI,
    state,
  });
  const url = 'https://accounts.spotify.com/authorize?' + q.toString();
  console.log('[LOGIN] Redirect →', url);
  res.redirect(url);
});

// Troca de code por token
let ACCESS_TOKEN = null;
let REFRESH_TOKEN = null;
let EXPIRES_AT = 0;

async function refreshIfNeeded() {
  if (ACCESS_TOKEN && Date.now() < EXPIRES_AT) return ACCESS_TOKEN;
  if (!REFRESH_TOKEN) return null;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: REFRESH_TOKEN,
  });

  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization:
        'Basic ' +
        Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!r.ok) {
    const txt = await r.text();
    console.error('[TOKEN] Refresh falhou:', txt);
    return null;
  }
  const j = await r.json();
  ACCESS_TOKEN = j.access_token || ACCESS_TOKEN;
  if (j.refresh_token) REFRESH_TOKEN = j.refresh_token;
  EXPIRES_AT = Date.now() + ((j.expires_in || 3600) - 60) * 1000;
  console.log('[TOKEN] Refresh ok, expira em ~', (j.expires_in || 3600), 's');
  return ACCESS_TOKEN;
}

app.get('/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send('Callback sem code');

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    });

    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization:
          'Basic ' +
          Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (!r.ok) {
      const txt = await r.text();
      console.error('[CALLBACK] Falha token:', txt);
      return res.status(500).send('Falha ao obter token. Veja logs do servidor.');
    }

    const j = await r.json();
    ACCESS_TOKEN = j.access_token;
    REFRESH_TOKEN = j.refresh_token;
    EXPIRES_AT = Date.now() + (j.expires_in - 60) * 1000;
    console.log('[CALLBACK] Token ok. refresh_token? ', !!REFRESH_TOKEN);

    res.redirect('/');
  } catch (e) {
    console.error('[CALLBACK] Erro:', e);
    res.status(500).send('Erro no callback. Veja logs.');
  }
});

// Endpoint para o front pegar token
app.get('/token', async (req, res) => {
  const tok = await refreshIfNeeded();
  if (!tok) return res.status(401).json({ error: 'no_token' });
  res.json({ access_token: tok });
});

// Static front-end (coloque seu index.html na pasta /public)
app.use(express.static(path.join(__dirname, 'public')));

// Start com tratamento de porta ocupada
const server = app
  .listen(PORT, () => {
    console.log(`[READY] http://localhost:${PORT}`);
  })
  .on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[ERRO] Porta ${PORT} em uso. Troque PORT no .env ou libere a porta.`);
    } else {
      console.error('[ERRO] listen:', err);
    }
    process.exit(1);
  });
