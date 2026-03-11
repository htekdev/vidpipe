import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

import { hasImagePath, extractImage, type ExtractedImage } from '../../../L2-clients/llm/imageUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================================
// hasImagePath tests
// ============================================================================
describe('hasImagePath', () => {
  it('returns true for object with imagePath string', () => {
    expect(hasImagePath({ imagePath: '/path/to/image.jpg' })).toBe(true);
  });

  it('returns true for object with imagePath and other fields', () => {
    expect(hasImagePath({ imagePath: '/path/to/image.jpg', other: 'data' })).toBe(true);
  });

  it('returns false for null', () => {
    expect(hasImagePath(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(hasImagePath(undefined)).toBe(false);
  });

  it('returns false for empty object', () => {
    expect(hasImagePath({})).toBe(false);
  });

  it('returns false for object with non-string imagePath', () => {
    expect(hasImagePath({ imagePath: 123 })).toBe(false);
  });

  it('returns false for object with imagePath as null', () => {
    expect(hasImagePath({ imagePath: null })).toBe(false);
  });

  it('returns false for array', () => {
    expect(hasImagePath(['/path/to/image.jpg'])).toBe(false);
  });

  it('returns false for string', () => {
    expect(hasImagePath('/path/to/image.jpg')).toBe(false);
  });

  it('returns false for number', () => {
    expect(hasImagePath(42)).toBe(false);
  });

  it('returns true for nested object with imagePath at root', () => {
    expect(hasImagePath({ imagePath: '/path.jpg', nested: { imagePath: '/other.jpg' } })).toBe(true);
  });

  it('returns true for object with empty string imagePath', () => {
    // Empty string is still a string
    expect(hasImagePath({ imagePath: '' })).toBe(true);
  });
});

// ============================================================================
// extractImage tests
// ============================================================================
describe('extractImage', () => {
  let tempDir: string;
  let jpegPath: string;
  let pngPath: string;
  let unsupportedPath: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'imageUtils-test-'));

    // Create test images
    // Minimal valid JPEG (1x1 pixel)
    jpegPath = path.join(tempDir, 'test.jpg');
    const jpegBuffer = Buffer.from([
      0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
      0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
      0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
      0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
      0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
      0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
      0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01,
      0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00,
      0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
      0x09, 0x0A, 0x0B, 0xFF, 0xC4, 0x00, 0xB5, 0x10, 0x00, 0x02, 0x01, 0x03,
      0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7D,
      0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
      0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08,
      0x23, 0x42, 0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0, 0x24, 0x33, 0x62, 0x72,
      0x82, 0x09, 0x0A, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28,
      0x29, 0x2A, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45,
      0x46, 0x47, 0x48, 0x49, 0x4A, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
      0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6A, 0x73, 0x74, 0x75,
      0x76, 0x77, 0x78, 0x79, 0x7A, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
      0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3,
      0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6,
      0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9,
      0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2,
      0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF1, 0xF2, 0xF3, 0xF4,
      0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFA, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01,
      0x00, 0x00, 0x3F, 0x00, 0xFB, 0xD5, 0xDB, 0x20, 0xA8, 0xA2, 0x8A, 0x28,
      0x03, 0xFF, 0xD9,
    ]);
    await fs.writeFile(jpegPath, jpegBuffer);

    // Minimal PNG (1x1 pixel)
    pngPath = path.join(tempDir, 'test.png');
    const pngBuffer = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00,
      0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0x3F,
      0x00, 0x05, 0xFE, 0x02, 0xFE, 0xDC, 0xCC, 0x59, 0xE7, 0x00, 0x00, 0x00,
      0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ]);
    await fs.writeFile(pngPath, pngBuffer);

    // Unsupported format
    unsupportedPath = path.join(tempDir, 'test.gif');
    await fs.writeFile(unsupportedPath, Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]));
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('extracts and encodes JPEG image', async () => {
    const result = await extractImage({ imagePath: jpegPath });
    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe('image/jpeg');
    expect(result!.base64.length).toBeGreaterThan(0);
    expect(result!.path).toBe(jpegPath);

    // Verify base64 decodes to original content
    const decoded = Buffer.from(result!.base64, 'base64');
    const original = await fs.readFile(jpegPath);
    expect(decoded.equals(original)).toBe(true);
  });

  it('extracts and encodes PNG image', async () => {
    const result = await extractImage({ imagePath: pngPath });
    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe('image/png');
    expect(result!.base64.length).toBeGreaterThan(0);
    expect(result!.path).toBe(pngPath);
  });

  it('handles .jpeg extension', async () => {
    const jpegPathAlt = path.join(tempDir, 'test.jpeg');
    await fs.copyFile(jpegPath, jpegPathAlt);

    const result = await extractImage({ imagePath: jpegPathAlt });
    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe('image/jpeg');
  });

  it('returns null for unsupported image format', async () => {
    const result = await extractImage({ imagePath: unsupportedPath });
    expect(result).toBeNull();
  });

  it('returns null for non-existent file', async () => {
    const result = await extractImage({ imagePath: '/nonexistent/image.jpg' });
    expect(result).toBeNull();
  });

  it('returns null for file with unknown extension', async () => {
    const unknownPath = path.join(tempDir, 'test.bmp');
    await fs.writeFile(unknownPath, Buffer.from([0x42, 0x4D]));

    const result = await extractImage({ imagePath: unknownPath });
    expect(result).toBeNull();
  });

  it('returns null for file without extension', async () => {
    const noExtPath = path.join(tempDir, 'noext');
    await fs.writeFile(noExtPath, Buffer.from([0xFF, 0xD8]));

    const result = await extractImage({ imagePath: noExtPath });
    expect(result).toBeNull();
  });

  it('handles case-insensitive extensions', async () => {
    const upperPath = path.join(tempDir, 'test.JPG');
    await fs.copyFile(jpegPath, upperPath);

    const result = await extractImage({ imagePath: upperPath });
    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe('image/jpeg');
  });

  it('handles path with special characters', async () => {
    const specialDir = path.join(tempDir, 'special dir (1)');
    await fs.mkdir(specialDir, { recursive: true });
    const specialPath = path.join(specialDir, 'image-test.png');
    await fs.copyFile(pngPath, specialPath);

    const result = await extractImage({ imagePath: specialPath });
    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe('image/png');
  });
});
