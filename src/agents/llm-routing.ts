/** Text work stays on DeepSeek, including heavy requests and workflow workers.
 * K3 is reserved for image input through the vision route.
 */
export const TEXT_AND_IMAGE_ROUTING = {
  default: 'daily',
  heavy: 'daily',
  utility: 'daily',
  has_images: 'vision',
} as const;

export const TEXT_HEAVY_HEURISTICS = { keywords: [] };
