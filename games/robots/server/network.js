import { networkInterfaces } from 'node:os';
import { isIPv4 } from 'node:net';

const VIRTUAL_INTERFACE = /tun\d*|tap\d*|vpn|docker|veth|virbr|tailscale|zerotier|hamachi|hyper.?v|virtual|vmware|wsl|wireguard|fortinet|zscaler|^wg\d/i;
const PHYSICAL_INTERFACE = /wi-?fi|wlan|wireless|ethernet|^en\d|^enp\d|^ens\d|^eno\d|^eth\d/i;

/** Prefer phone-reachable adapters while retaining VPN URLs as explicit alternatives. */
export function lanUrls(port, interfaces = networkInterfaces()) {
  const candidates = new Map();
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== 'IPv4' && entry.family !== 4 || !isIPv4(entry.address)) continue;
      const [a, b] = entry.address.split('.').map(Number);
      if (a === 0 || a === 127 || a >= 224 || a === 169 && b === 254) continue;
      const privateRank = a === 192 && b === 168 ? 30 : a === 10 ? 20 : a === 172 && b >= 16 && b <= 31 ? 10 : 0;
      const adapterRank = VIRTUAL_INTERFACE.test(name) ? -200 : PHYSICAL_INTERFACE.test(name) ? 100 : 0;
      const score = adapterRank + privateRank;
      const url = `http://${entry.address}:${port}`;
      if (!candidates.has(url) || candidates.get(url).score < score) candidates.set(url, { url, score, name });
    }
  }
  return [...candidates.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.url.localeCompare(b.url)).map(candidate => candidate.url);
}

/** Invitation base for a reverse proxy/tunnel, configured by the server owner. */
export function normalizePublicUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch { return null; }
}
