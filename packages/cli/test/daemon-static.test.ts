import { expect, it } from 'vitest';
import { serveEmbedded } from '../src/server';

const assets = {
  '/index.html': Buffer.from('<html><body>Embedded fixture</body></html>').toString('base64'),
  '/assets/app.css': Buffer.from('body { color: red; }').toString('base64'),
};

it.each(['/', '/projects/project-id', '/review/session-id/'])('serves embedded SPA HTML MIME for %s', async path => {
  const response = serveEmbedded(assets, path);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toMatch(/^text\/html/);
  expect(await response.text()).toBe(Buffer.from(assets['/index.html'], 'base64').toString());
});

it('retains the MIME of an existing embedded asset', async () => {
  const response = serveEmbedded(assets, '/assets/app.css');
  expect(response.headers.get('content-type')).toMatch(/^text\/css/);
  expect(await response.text()).toBe(Buffer.from(assets['/assets/app.css'], 'base64').toString());
});
