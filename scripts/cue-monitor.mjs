// [SPEC-19] Reference receiver for Strudler's stage output.
//
// Two jobs:
//   1. verify the stream end to end (`npm run cues:monitor`, then enable the
//      WebSocket output in Strudler and press PLAY);
//   2. serve as the skeleton of a real receiver — a lighting engine, a visual
//      engine — since Strudler is the client and the receiver owns the server.
//
// No dependency: the WebSocket handshake and text-frame decoding are short enough
// to spell out (RFC 6455), and this file is meant to be copied and adapted.
//
// What matters musically: `at` is when the event is MEANT to happen, and it is in
// the FUTURE — Strudel's scheduler commits notes before they are audible. The
// "avance" column is that lead. A receiver should wait `at - Date.now()` (or
// pre-arm a fade) instead of reacting on arrival.

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const PORT = Number(process.env.CUE_PORT ?? 8765);
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const server = createServer((_req, res) => {
  res.writeHead(426, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('WebSocket seulement — connecte Strudler sur ws://127.0.0.1:' + PORT + '\n');
});

let connections = 0;

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (typeof key !== 'string') {
    socket.destroy();
    return;
  }
  const accept = createHash('sha1')
    .update(key + WS_GUID)
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  // Number the connections: several Strudler tabs can be open at once, and
  // reading one stream while another is talking is how you chase a phantom bug.
  const id = ++connections;
  const tag = `#${id}`;
  console.log(`\n▶ Strudler connecté ${tag} (${req.socket.remoteAddress})\n`);

  let buffer = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    // A frame may arrive split across TCP reads, or several at once.
    for (;;) {
      const frame = readFrame(buffer);
      if (!frame) break;
      buffer = buffer.subarray(frame.size);
      if (frame.opcode === 0x8) {
        socket.end();
        return;
      }
      if (frame.opcode === 0x9) {
        socket.write(Buffer.from([0x8a, 0x00])); // pong
        continue;
      }
      if (frame.opcode !== 0x1) continue; // this receiver only speaks text
      handleMessage(frame.payload.toString('utf8'), tag);
    }
  });
  socket.on('error', (err) => console.error('socket:', err.message));
  socket.on('close', () => console.log(`\n■ Strudler ${tag} déconnecté\n`));
});

/** Decode one frame, or null while incomplete. Client frames are always masked. */
function readFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let length = buf[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buf.length < offset + 2) return null;
    length = buf.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buf.length < offset + 8) return null;
    const big = buf.readBigUInt64BE(offset);
    if (big > 1_000_000n) throw new Error(`trame démesurée (${big} octets)`);
    length = Number(big);
    offset += 8;
  }
  let mask;
  if (masked) {
    if (buf.length < offset + 4) return null;
    mask = buf.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buf.length < offset + length) return null;
  const payload = Buffer.from(buf.subarray(offset, offset + length));
  if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
  return { opcode, payload, size: offset + length };
}

let beats = 0;
let onsets = 0;
const leads = [];

function handleMessage(text, tag = '#1') {
  let cue;
  try {
    cue = JSON.parse(text);
  } catch (err) {
    // Never silent: a malformed line means the contract broke somewhere.
    console.error(`${tag} ✖ JSON illisible (${err.message}) : ${text.slice(0, 120)}`);
    return;
  }
  const lead = typeof cue.at === 'number' ? cue.at - Date.now() : null;
  if (lead !== null) leads.push(lead);
  const avance = lead === null ? '' : `avance ${String(Math.round(lead)).padStart(4)} ms`;

  switch (cue.type) {
    case 'hello':
      console.log(
        `${tag} hello   protocole v${cue.v} · ${cue.bpm} BPM · ${cue.beatsPerBar} beats/mesure · ` +
          `transport ${cue.running ? 'en lecture' : 'arrêté'}`,
      );
      for (const ch of cue.channels ?? []) {
        console.log(`${tag}         canal ${ch.id} → ${ch.categories.join(', ') || '(aucune catégorie)'}`);
      }
      break;
    case 'tempo':
      console.log(`${tag} tempo   ${cue.bpm} BPM`);
      break;
    case 'transport':
      console.log(`${tag} ${cue.running ? 'PLAY   ' : 'STOP   '} beat ${cue.beat.toFixed(2)}`);
      break;
    case 'beat':
      beats++;
      console.log(
        `${tag} beat    ${String(cue.beat).padStart(5)} · mesure ${cue.bar} temps ${cue.beatInBar} · ` +
          `fenêtre ${cue.windowIndex}/${cue.window} · ${avance}`,
      );
      break;
    case 'onset':
      onsets++;
      console.log(
        `${tag} onset   canal ${cue.channel} · ${(cue.category ?? '?').padEnd(7)} · ` +
          `${(cue.sound ?? cue.note ?? '?').toString().padEnd(10)} · ` +
          `gain ${cue.gain.toFixed(2)} · ${avance}`,
      );
      break;
    case 'slot':
      console.log(
        `${tag} slot    canal ${cue.channel} slot ${cue.slot} · ` +
          `${cue.playing ? 'armé' : 'arrêté'} · ${cue.track ?? '—'}`,
      );
      break;
    default:
      console.log(`${tag} ? type inconnu « ${cue.type} » : ${text.slice(0, 120)}`);
  }
}

process.on('SIGINT', () => {
  const avg = leads.length ? leads.reduce((a, b) => a + b, 0) / leads.length : 0;
  console.log(
    `\n${beats} beats, ${onsets} onsets reçus. Avance moyenne : ${avg.toFixed(0)} ms ` +
      `(positive = annoncé avant d'être audible).`,
  );
  process.exit(0);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Moniteur de cues Strudler — ws://127.0.0.1:${PORT}`);
  console.log('Active « Sortie scénique → WebSocket » dans Strudler, puis PLAY. Ctrl+C pour le bilan.');
});
