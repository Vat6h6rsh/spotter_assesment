import type { Plugin } from 'vite';
import { existsSync, createReadStream, statSync } from 'node:fs';
import { resolve, relative, extname, isAbsolute } from 'node:path';

export function localAudio(): Plugin {
  return {
    name: 'private-local-audio', apply: 'serve',
    configureServer(server) {
      const directory = resolve(server.config.root, 'local-audio');
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/local-audio/')) return next();
        res.setHeader('Cache-Control', 'no-store');
        if (req.url === '/local-audio/available') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ available: existsSync(resolve(directory, 'Mausam Aajtak (2016).mp3')) }));
          return;
        }
        let name: string;
        try { name = decodeURIComponent(req.url.split('?')[0].slice('/local-audio/'.length)); }
        catch { res.statusCode = 400; res.end(); return; }
        const path = resolve(directory, name), inside = relative(directory, path);
        if (!inside || inside.startsWith('..') || isAbsolute(inside) || extname(path).toLowerCase() !== '.mp3' || !existsSync(path) || !statSync(path).isFile()) {
          res.statusCode = 404; res.end(); return;
        }
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', statSync(path).size);
        if (req.method === 'HEAD') { res.end(); return; }
        createReadStream(path).on('error', () => res.destroy()).pipe(res);
      });
    },
  };
}
