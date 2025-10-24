// Servidor local para OAuth + player estático
// npm i express dotenv node-fetch@2 cookie-parser
const express = require('express');
const path = require('path');
const cookie = require('cookie-parser');
const fetch = require('node-fetch');
require('dotenv').config();

const {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  REDIRECT_URI,
  PORT = 5000
} = process.env;

const app = express();
app.use(cookie());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Armazena token em memória para 1 usuário local
let ACCESS_TOKEN = null;
let REFRESH_TOKEN = null;
let EXPIRES_AT = 0;

function genState(n = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

app.get('/login', (req, res) => {
  const state = genState();
  res.cookie('spotify_state', state, { httpOnly: true, sameSite: 'lax' });

  const scope = [
    'streaming',
    'user-read-email',
    'user-read-private',
    'user-modify-playback-state',
    'user-read-playback-state'
  ].join(' ');

  const q = new URLSearchParams({
    response_type: 'code',
    client_id: SPOTIFY_CLIENT_ID,
    scope,
    redirect_uri: REDIRECT_URI,
    state
  });

  res.redirect('https://accounts.spotify.com/authorize?' + q.toString());
});

app.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    const cookieState = req.cookies.spotify_state;
    if (!state || state !== cookieState) return res.status(400).send('Invalid state');

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI
    });

    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(
          SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET
        ).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });

    if (!r.ok) {
      const tx = await r.text();
      return res.status(500).send('Token error ' + tx);
    }

    const json = await r.json();
    ACCESS_TOKEN = json.access_token;
    REFRESH_TOKEN = json.refresh_token;
    EXPIRES_AT = Date.now() + (json.expires_in - 60) * 1000;

    res.clearCookie('spotify_state');
    // Volta para a página do app
    res.redirect('/');
  } catch (e) {
    res.status(500).send(String(e));
  }
});

async function ensureAccessToken() {
  if (ACCESS_TOKEN && Date.now() < EXPIRES_AT) return ACCESS_TOKEN;
  if (!REFRESH_TOKEN) return null;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: REFRESH_TOKEN
  });

  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(
        SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET
      ).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  if (!r.ok) return null;
  const json = await r.json();
  ACCESS_TOKEN = json.access_token || ACCESS_TOKEN;
  if (json.refresh_token) REFRESH_TOKEN = json.refresh_token; // às vezes não vem
  EXPIRES_AT = Date.now() + ((json.expires_in || 3600) - 60) * 1000;
  return ACCESS_TOKEN;
}

app.get('/token', async (req, res) => {
  const tok = await ensureAccessToken();
  if (!tok) return res.status(401).json({ error: 'no_token' });
  res.json({ access_token: tok });
});

app.post('/logout', (req, res) => {
  ACCESS_TOKEN = null;
  REFRESH_TOKEN = null;
  EXPIRES_AT = 0;
  res.json({ ok: true });
});

// arquivos estáticos do front
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
