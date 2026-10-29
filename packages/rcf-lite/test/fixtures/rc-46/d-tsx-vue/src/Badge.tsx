/** @jsxRuntime classic */
/** @jsx h */
import { h } from './h';

export function badgeLabel(count: number): string {
  return count > 99 ? '99+' : String(count);
}

export function Badge(props: { count: number }) {
  return <span className="badge">{badgeLabel(props.count)}</span>;
}
