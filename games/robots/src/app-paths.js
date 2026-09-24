/** One namespace for assets, API, invitations and sockets, including subfolder builds. */
export function createAppPaths(base = '/') {
  const root = `/${base.split('/').filter(Boolean).join('/')}`;
  const prefix = root === '/' ? '' : root;
  return {
    base: `${prefix}/`,
    path: value => `${prefix}/${value.replace(/^\/+/, '')}`,
    socket: origin => `${origin.replace(/^http/, 'ws')}${prefix}/ws`,
    invite: (room, origin, publicUrl) => `${(publicUrl || `${origin}${prefix}`).replace(/\/+$/, '')}/?room=${encodeURIComponent(room)}`,
  };
}

export const appPaths = createAppPaths(import.meta.env?.BASE_URL || '/');
export const assetUrl = appPaths.path;
