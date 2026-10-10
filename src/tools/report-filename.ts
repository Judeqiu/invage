/** Keep report writes inside the authenticated user's BinDrive folder. */
export function reportFilename(name: string): string {
  if (!name.trim() || name === '.' || name === '..' || /[\\/\x00-\x1f]/.test(name) || !name.toLowerCase().endsWith('.html')) {
    throw new Error('Report filename must be a single .html filename without path separators or control characters.');
  }
  return name;
}
