/**
 * Generate Chrome Web Store icon: 96x96 content centered in 128x128 with transparent padding.
 */
import sharp from 'sharp';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGO = resolve(__dirname, '..', 'assets', 'branding', 'transparent-logo.png');
const OUTPUT = resolve(__dirname, '..', 'store-assets', 'store-icon-128.png');

async function main() {
  // Resize logo to 96x96, then composite onto a 128x128 transparent canvas
  const resized = await sharp(LOGO)
    .resize(96, 96, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp({
    create: { width: 128, height: 128, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite([{ input: resized, top: 16, left: 16 }])
    .png()
    .toFile(OUTPUT);

  console.log(`Created ${OUTPUT} (128x128 with 96x96 content + 16px padding)`);

  // Also copy to assets/icons for the manifest
  const manifestIcon = resolve(__dirname, '..', 'assets', 'icons', 'icon-128.png');
  await sharp(OUTPUT).toFile(manifestIcon);
  console.log(`Copied to ${manifestIcon}`);
}

main().catch(console.error);
