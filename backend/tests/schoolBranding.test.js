import test from 'node:test';
import assert from 'node:assert/strict';

process.env.AWS_S3_BUCKET = process.env.AWS_S3_BUCKET || 'unit-test-bucket';
const { normalizeBrandColor, readableOnWhite, imageKind, ownBucketKey, DEFAULT_BRAND_COLOR } = await import('../services/schoolBranding.js');
const { s3PublicUrl } = await import('../utils/s3.js');

test('theme colour is normalised to #rrggbb or rejected', () => {
  assert.equal(normalizeBrandColor('#1F4E79'), '#1f4e79');
  assert.equal(normalizeBrandColor('1f4e79'), '#1f4e79');
  assert.equal(normalizeBrandColor(' #abc '), '#aabbcc');
  for (const bad of ['', null, undefined, 'blue', '#12345', '#gggggg', 'rgb(1,2,3)', '#1234567']) assert.equal(normalizeBrandColor(bad), null, String(bad));
});

test('a pale theme colour is darkened so text stays readable; dark ones are untouched', () => {
  assert.equal(readableOnWhite('#1f4e79'), '#1f4e79');
  assert.equal(readableOnWhite('#000000'), '#000000');
  const lum = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0) / 255;
  for (const pale of ['#ffffff', '#ffff00', '#fff8e7', '#cceeff']) {
    const out = readableOnWhite(pale);
    assert.match(out, /^#[0-9a-f]{6}$/);
    assert.ok(lum(out) <= 0.55, `${pale} -> ${out}`);
  }
  assert.equal(readableOnWhite('nonsense'), DEFAULT_BRAND_COLOR);
});

test('only PNG and JPEG can be placed in a PDF', () => {
  assert.equal(imageKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d])), 'png');
  assert.equal(imageKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'jpeg');
  assert.equal(imageKind(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
  assert.equal(imageKind(Buffer.from('GIF89a')), null);
  assert.equal(imageKind(null), null);
});

test('a logo is only ever read from our own bucket', () => {
  assert.equal(ownBucketKey(s3PublicUrl('logos/12/171.png')), 'logos/12/171.png');
  assert.equal(ownBucketKey('https://evil.example.com/logos/12/171.png'), null);
  assert.equal(ownBucketKey('http://169.254.169.254/latest/meta-data/'), null);
  assert.equal(ownBucketKey(s3PublicUrl('waynur/certificates/x.pdf')), null); // not a logo
  assert.equal(ownBucketKey(s3PublicUrl('logos/../secrets.txt')), null);
  assert.equal(ownBucketKey(null), null);
});
