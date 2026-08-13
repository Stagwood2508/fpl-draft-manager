import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = process.cwd();
const publicDirectory = join(projectRoot, 'public');
const outputDirectory = join(projectRoot, 'dist');
const indexPath = join(outputDirectory, 'index.html');

if (!existsSync(indexPath)) {
  throw new Error('Web export is missing dist/index.html. Run the Expo web export first.');
}

cpSync(publicDirectory, outputDirectory, { recursive: true });

const pwaHead = `
  <link rel="manifest" href="/manifest.webmanifest?v=20260814" />
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png?v=20260814" />
  <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png?v=20260814" />
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon-20260813.png" />
  <meta name="theme-color" content="#0A1F14" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />`;

const exportedHtml = readFileSync(indexPath, 'utf8');
const withoutGeneratedFavicon = exportedHtml.replace(/\s*<link rel="icon" href="\/favicon\.ico" \/>/, '');

if (!withoutGeneratedFavicon.includes('rel="manifest"')) {
  writeFileSync(indexPath, withoutGeneratedFavicon.replace('</head>', `${pwaHead}\n</head>`));
}

console.log('Finalized Expo web build with PWA manifest and high-resolution icons.');
