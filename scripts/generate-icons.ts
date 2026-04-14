/**
 * Generate extension icons from the brand logo.
 * Run with: npx tsx scripts/generate-icons.ts
 */
import sharp from 'sharp';
import { resolve } from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGO = resolve(__dirname, '..', 'assets', 'branding', 'transparent-logo.png');
const ICON_DIR = resolve(__dirname, '..', 'assets', 'icons');
const SIZES = [16, 32, 48, 128];

async function main() {
  for (const size of SIZES) {
    const output = resolve(ICON_DIR, `icon-${size}.png`);
    await sharp(LOGO)
      .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toFile(output);
    console.log(`Created ${output} (${size}x${size})`);
  }

  // Also create a 440x280 promo image for the store
  const promoOutput = resolve(__dirname, '..', 'store-assets', 'promo-small.png');
  await sharp(LOGO)
    .resize(440, 280, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile(promoOutput);
  console.log(`Created ${promoOutput} (440x280 promo)`);

  console.log('Done!');
}

main().catch(console.error);
