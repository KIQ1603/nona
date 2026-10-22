/**
 * Media URLs may be absolute (e.g. http://localhost:3100/media/..). The SVG renderer only loads https or
 * same-site paths, so a URL on our own origin is reduced to its path. Pure: pass the page origin once it
 * is known (after mount) so server and first client render agree.
 */
export function sameSiteUrl(url: string, origin: string): string {
  return origin && url.startsWith(`${origin}/`) ? url.slice(origin.length) : url;
}
