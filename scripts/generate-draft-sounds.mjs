import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sampleRate = 44100;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = resolve(root, 'assets', 'sounds');

function writeWav(name, durationSeconds, sampleAt) {
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const dataLength = sampleCount * 2;
  const wav = Buffer.alloc(44 + dataLength);

  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataLength, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataLength, 40);

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / sampleRate;
    const value = Math.max(-1, Math.min(1, sampleAt(time, durationSeconds)));
    wav.writeInt16LE(Math.round(value * 32767), 44 + index * 2);
  }

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, name), wav);
}

const envelope = (time, start, length) => {
  if (time < start || time > start + length) return 0;
  const local = (time - start) / length;
  return Math.sin(Math.PI * local) ** 1.5;
};

writeWav('draft-pick-confirmed.wav', 0.42, time => {
  const first = Math.sin(2 * Math.PI * 660 * time) * envelope(time, 0, 0.2);
  const second = Math.sin(2 * Math.PI * 880 * time) * envelope(time, 0.16, 0.25);
  return (first + second) * 0.22;
});

writeWav('draft-watchlist-alert.wav', 0.48, time => {
  const first = Math.sin(2 * Math.PI * 740 * time) * envelope(time, 0, 0.18);
  const second = Math.sin(2 * Math.PI * 520 * time) * envelope(time, 0.2, 0.25);
  return (first + second) * 0.22;
});
