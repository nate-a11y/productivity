import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

// SVG content for the icon - orange background with black B
const svgContent = `<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="96" fill="#ff6b00"/>
  <text x="256" y="340" font-family="system-ui, -apple-system, BlinkMacSystemFont, sans-serif" font-size="320" font-weight="700" fill="#0a0a0a" text-anchor="middle">B</text>
</svg>`;

// For PNG generation - smaller B with generous padding to match reference
const simpleSvg = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="96" fill="#ff6b00"/>
  <path fill="#0a0a0a" transform="translate(196, 176) scale(0.55)" d="M0 0h120c32 0 58 9 78 28s30 43 30 74c0 23-7 43-20 58s-30 26-53 31v2c28 4 49 15 64 32s22 42 22 70c0 35-12 63-35 84s-56 31-98 31H0V0zm56 168h51c22 0 39-5 50-15s17-24 17-42-6-32-16-41-26-14-48-14H56v112zm0 172h60c25 0 44-6 57-18s19-28 19-49c0-21-7-37-20-48s-33-17-60-17H56v132z"/>
</svg>`;

async function generateIcons() {
  console.log('Generating icons...');

  // Generate 512x512 icon
  await sharp(Buffer.from(simpleSvg))
    .resize(512, 512)
    .png()
    .toFile(join(publicDir, 'icon-512.png'));
  console.log('✓ icon-512.png');

  // Generate 192x192 icon
  await sharp(Buffer.from(simpleSvg))
    .resize(192, 192)
    .png()
    .toFile(join(publicDir, 'icon-192.png'));
  console.log('✓ icon-192.png');

  // Generate apple-touch-icon (180x180)
  await sharp(Buffer.from(simpleSvg))
    .resize(180, 180)
    .png()
    .toFile(join(publicDir, 'apple-touch-icon.png'));
  console.log('✓ apple-touch-icon.png');

  // Generate favicon sizes (16, 32, 48)
  await sharp(Buffer.from(simpleSvg))
    .resize(32, 32)
    .png()
    .toFile(join(publicDir, 'favicon-32x32.png'));
  console.log('✓ favicon-32x32.png');

  await sharp(Buffer.from(simpleSvg))
    .resize(16, 16)
    .png()
    .toFile(join(publicDir, 'favicon-16x16.png'));
  console.log('✓ favicon-16x16.png');

  // Generate 48x48 for favicon.ico base
  await sharp(Buffer.from(simpleSvg))
    .resize(48, 48)
    .png()
    .toFile(join(publicDir, 'favicon-48x48.png'));
  console.log('✓ favicon-48x48.png');

  console.log('\nAll icons generated successfully!');
  console.log('\nNote: For favicon.ico, you may want to use a tool like realfavicongenerator.net');
  console.log('or convert the 32x32 PNG to ICO format using an online converter.');
}

generateIcons().catch(console.error);
