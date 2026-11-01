/**
 * URL slugs: lower-case ASCII letters and digits joined by single hyphens.
 */

export interface SlugOptions {
  /** The longest slug returned; a longer one is cut back to the last whole word. Default 60. */
  readonly maxLength?: number;
}

const DEFAULT_MAX_LENGTH = 60;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The slug of a piece of text. Text with no letters or digits gives the empty string. */
export function slugify(text: string, options: SlugOptions = {}): string {
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
  if (!Number.isInteger(maxLength) || maxLength < 1) {
    throw new RangeError(`maxLength must be a positive integer, got ${maxLength}`);
  }
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length <= maxLength) return slug;
  const cut = slug.slice(0, maxLength);
  if (slug[maxLength] === '-') return cut;
  const lastHyphen = cut.lastIndexOf('-');
  return lastHyphen > 0 ? cut.slice(0, lastHyphen) : cut;
}

/** True when the value is already a well-formed slug. */
export function isSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}
