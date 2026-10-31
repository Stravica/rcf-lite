export function h(tag: string, props: Record<string, unknown> | null, ...children: unknown[]): string {
  return `<${tag}>${children.join('')}</${tag}>`;
}
