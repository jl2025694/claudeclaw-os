#!/usr/bin/env node
/**
 * LAN HTTPS reverse proxy — terminates TLS and forwards to the local dashboard.
 *
 * Env vars:
 *   LAN_HTTPS_PORT         — listen port (default 3443)
 *   LAN_HTTPS_TARGET_PORT  — backend port (default 3141)
 *   LAN_HTTPS_CERT_DIR     — where to store the self-signed cert (default ./store/certs)
 */

import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const PORT = parseInt(process.env.LAN_HTTPS_PORT || '3443', 10);
const TARGET = parseInt(process.env.LAN_HTTPS_TARGET_PORT || '3141', 10);
const CERT_DIR = process.env.LAN_HTTPS_CERT_DIR || path.join(PROJECT_ROOT, 'store', 'certs');

function ensureCerts() {
  const keyPath = path.join(CERT_DIR, 'lan.key');
  const certPath = path.join(CERT_DIR, 'lan.crt');

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  }

  fs.mkdirSync(CERT_DIR, { recursive: true });

  console.log('[lan-https] Generating self-signed certificate...');
  execSync(
    `openssl req -x509 -newkey rsa:2048 -nodes ` +
    `-keyout "${keyPath}" -out "${certPath}" ` +
    `-days 365 -subj "/CN=claudeclaw-lan" ` +
    `-addext "subjectAltName=DNS:localhost,IP:127.0.0.1"`,
    { stdio: 'inherit' }
  );

  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
}

function proxy(clientReq, clientRes) {
  const opts = {
    hostname: '127.0.0.1',
    port: TARGET,
    path: clientReq.url,
    method: clientReq.method,
    headers: {
      ...clientReq.headers,
      'x-forwarded-proto': 'https',
      host: clientReq.headers.host || `127.0.0.1:${TARGET}`,
    },
  };

  const backendReq = http.request(opts, (backendRes) => {
    clientRes.writeHead(backendRes.statusCode, backendRes.headers);
    backendRes.pipe(clientRes, { end: true });
  });

  backendReq.on('error', (err) => {
    console.error('[lan-https] backend error:', err.message);
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { 'content-type': 'text/plain' });
    }
    clientRes.end('Bad Gateway');
  });

  clientReq.pipe(backendReq, { end: true });
}

const { key, cert } = ensureCerts();
const server = https.createServer({ key, cert }, proxy);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[lan-https] HTTPS proxy listening on 0.0.0.0:${PORT} -> 127.0.0.1:${TARGET}`);
});
