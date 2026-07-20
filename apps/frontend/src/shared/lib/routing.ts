export function withGatewayMode(path: string, search: string) {
  const gateway = new URLSearchParams(search).get('gateway');
  if (!gateway) return path;
  const url = new URL(path, 'http://router.local');
  url.searchParams.set('gateway', gateway);
  return `${url.pathname}${url.search}`;
}
