export function slugify(title) {
  return title.trim().toLowerCase().split(/\s+/).join('-');
}
