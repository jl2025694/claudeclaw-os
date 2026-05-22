#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const QRCode = require('../node_modules/qrcode-terminal/vendor/QRCode');
const QRErrorCorrectLevel = require('../node_modules/qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');

const root = path.resolve(__dirname, '..');
const inputPath = path.join(root, 'store', 'qr-latest.txt');
const outputPath = path.join(root, 'store', 'wa-qr.html');

if (!fs.existsSync(inputPath)) {
  console.error(`Missing QR source: ${inputPath}`);
  process.exit(1);
}

const qrText = fs.readFileSync(inputPath, 'utf8').trim();
if (!qrText) {
  console.error(`QR source is empty: ${inputPath}`);
  process.exit(1);
}

const qr = new QRCode(-1, QRErrorCorrectLevel.L);
qr.addData(qrText);
qr.make();

const count = qr.getModuleCount();
const cell = 10;
const quiet = 4;
const size = (count + quiet * 2) * cell;
const rects = [];

for (let row = 0; row < count; row++) {
  for (let col = 0; col < count; col++) {
    if (!qr.isDark(row, col)) continue;
    rects.push(`<rect x="${(col + quiet) * cell}" y="${(row + quiet) * cell}" width="${cell}" height="${cell}"/>`);
  }
}

const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="5">
  <title>WhatsApp QR</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #f7f7f4;
      color: #111827;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(92vw, 560px);
      text-align: center;
    }
    svg {
      width: min(88vw, 460px);
      height: auto;
      background: white;
      border: 1px solid #d1d5db;
      box-shadow: 0 16px 50px rgba(17, 24, 39, 0.14);
    }
    h1 {
      margin: 0 0 10px;
      font-size: 22px;
      letter-spacing: 0;
    }
    p {
      margin: 8px 0 18px;
      font-size: 14px;
      color: #4b5563;
    }
  </style>
</head>
<body>
  <main>
    <h1>WhatsApp Linked Device</h1>
    <p>WhatsApp -> Settings -> Linked Devices -> Link a device</p>
    <svg viewBox="0 0 ${size} ${size}" role="img" aria-label="WhatsApp QR code">
      <rect width="${size}" height="${size}" fill="#fff"/>
      <g fill="#000">${rects.join('')}</g>
    </svg>
    <p>Este QR expira rapido. Si falla, pide "nuevo QR".</p>
  </main>
</body>
</html>
`;

fs.writeFileSync(outputPath, html);
console.log(outputPath);
