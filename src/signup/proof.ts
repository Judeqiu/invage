/** Only known raster formats and PDF get an inline admin preview. In particular,
 * an uploaded SVG/HTML or a forged content-type never becomes an active document. */
export function proofPreviewType(bytes: Buffer): string | null {
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString('ascii'))) return 'image/gif';
  if (bytes.subarray(0,4).toString('ascii') === 'RIFF' && bytes.subarray(8,12).toString('ascii') === 'WEBP') return 'image/webp';
  if (bytes.subarray(0,5).toString('ascii') === '%PDF-') return 'application/pdf';
  return null;
}
