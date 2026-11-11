import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'search' }
  | { name: 'console' }
  | { name: 'settings' }
  | { name: 'run'; id: string };

function parse(hash: string): Route {
  const path = hash.replace(/^#/, '');
  if (path.startsWith('/console/run/')) {
    return { name: 'run', id: path.slice('/console/run/'.length) };
  }
  if (path.startsWith('/console/settings')) return { name: 'settings' };
  if (path.startsWith('/console')) return { name: 'console' };
  if (path.startsWith('/search')) return { name: 'search' };
  return { name: 'home' };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export const href = {
  home: '#/',
  search: '#/search',
  console: '#/console',
  settings: '#/console/settings',
  run: (id: string) => `#/console/run/${id}`,
};

export function isConsoleRoute(route: Route): boolean {
  return route.name === 'console' || route.name === 'settings' || route.name === 'run';
}
