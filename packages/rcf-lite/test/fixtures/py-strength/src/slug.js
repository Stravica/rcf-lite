// The fixture's one JavaScript module, beside its Python sources.
export function slug(text) {
  return text.trim().toLowerCase().split(/\s+/).join('-');
}
