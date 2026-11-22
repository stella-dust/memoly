import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const assetTypes = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/workspace.css': ['workspace.css', 'text/css; charset=utf-8'],
  '/workspace.js': ['workspace.js', 'text/javascript; charset=utf-8']
};

const maxRequestBytes = 256 * 1024;

class WebError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function applyHeaders(response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'");
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function assertLocalRequest(request, authority) {
  const expectedOrigin = `http://${authority}`;
  const { host, origin } = request.headers;
  if (host !== authority || (origin && origin !== expectedOrigin)) {
    throw new WebError(403, '仅接受当前本机地址的请求。');
  }
  if (!request.url?.startsWith('/') || request.url.startsWith('//')) {
    throw new WebError(400, '请求路径无效。');
  }
  return new URL(request.url, expectedOrigin);
}

function assertOwner(request, token) {
  const site = request.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') {
    throw new WebError(403, '仅接受工作台本身的请求。');
  }
  const actual = Buffer.from(request.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${token}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new WebError(401, '请使用终端生成的工作台地址或输入本机会话密钥。');
  }
}

async function readJson(request) {
  if (request.headers['content-type']?.split(';', 1)[0]?.trim() !== 'application/json') {
    throw new WebError(415, '请使用 JSON 请求。');
  }
  if (Number(request.headers['content-length']) > maxRequestBytes) {
    request.resume();
    throw new WebError(413, '请求过长。');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > maxRequestBytes) {
      request.resume();
      throw new WebError(413, '请求过长。');
    }
    chunks.push(chunk);
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new WebError(400, '无法解析请求。');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new WebError(400, '请求对象无效。');
  }
  return parsed;
}

async function state(api, tab) {
  const workspace = await api.status();
  switch (tab) {
    case 'vault': return { workspace };
    case 'maintenance': return { workspace, jobs: await api.jobs(), clients: await api.clients() };
    case 'memory': return { workspace, memories: await api.memories(), clients: await api.clients() };
    case 'agents': return { workspace, clients: await api.clients(), shares: await api.shares(), audit: await api.audit() };
    default: throw new WebError(400, '工作台页面无效。');
  }
}

function requireConfirmation(input) {
  if (input.confirm !== true) throw new WebError(400, '请先确认本次操作的范围和结果。');
}

function performAction(api, input) {
  const { action, id, key, client_id, path, source, heading, revision, target,
    statement, kind, context, expected_version, readers, expires_at } = input;
  switch (action) {
    case 'share':
      requireConfirmation(input);
      return api.share({ client_id, path, heading, revision });
    case 'unshare':
      return api.unshare({ client_id, path, heading });
    case 'create-job':
      requireConfirmation(input);
      return api.createJob({ source, heading, revision, target, client_id });
    case 'publish-job':
      requireConfirmation(input);
      return api.publishJob(id);
    case 'reject-job':
      return api.rejectJob(id);
    case 'correct-memory':
      return api.correctMemory({ key, statement, kind, context, source, expected_version });
    case 'approve-memory':
      requireConfirmation(input);
      return api.approveMemory(id, { readers, expires_at });
    case 'revoke-memory':
      requireConfirmation(input);
      return api.revokeMemory(key);
    case 'reject-memory':
      return api.rejectMemory(id);
    default: throw new WebError(400, '请选择有效的操作。');
  }
}

async function respond(request, response, { authority, token, api, assets }) {
  applyHeaders(response);
  let route;
  try {
    route = assertLocalRequest(request, authority);
    const asset = assets[route.pathname];
    if (request.method === 'GET' && asset) {
      response.writeHead(200, { 'Content-Type': asset.type });
      response.end(asset.content);
      return;
    }
    if (!route.pathname.startsWith('/api/')) {
      throw new WebError(404, '页面不存在。');
    }
    assertOwner(request, token);
    if (request.method === 'GET' && route.pathname === '/api/state') {
      sendJson(response, 200, await state(api, route.searchParams.get('tab') || 'vault'));
    } else if (request.method === 'GET' && route.pathname === '/api/tree') {
      sendJson(response, 200, await api.tree(route.searchParams.get('path') || ''));
    } else if (request.method === 'GET' && route.pathname === '/api/document') {
      const path = route.searchParams.get('path');
      if (!path) throw new WebError(400, '请选择一份笔记。');
      sendJson(response, 200, await api.note(path));
    } else if (request.method === 'GET' && route.pathname === '/api/share-targets') {
      sendJson(response, 200, (await api.clients()).filter(client => client.active));
    } else if (request.method === 'POST' && route.pathname === '/api/action') {
      const input = await readJson(request);
      sendJson(response, 200, { result: await performAction(api, input) });
    } else {
      throw new WebError(404, '接口不存在。');
    }
  } catch (error) {
    const isMissing = ['unavailable', 'ENOENT', 'ENOTDIR', 'ELOOP'].includes(error.code);
    const status = isMissing ? 404 : Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
    sendJson(response, status, {
      error: isMissing ? '内容不可用。请重新读取目录或核对文件格式。'
        : error instanceof WebError || route?.pathname.startsWith('/api/') && status !== 500
          ? error.message : '工作台暂时无法完成该操作。请检查本机服务。'
    });
  }
}

export async function serveWeb({ port = 0, token, api } = {}) {
  if (typeof token !== 'string' || !/^[a-f\d]{64}$/i.test(token)) {
    throw new Error('Web UI requires a 32-byte hexadecimal owner token.');
  }
  const assets = Object.create(null);
  for (const [route, [file, type]] of Object.entries(assetTypes)) {
    assets[route] = { type, content: await readFile(new URL(`./web-assets/${file}`, import.meta.url)) };
  }
  const server = createServer((request, response) => {
    const authority = `127.0.0.1:${server.address().port}`;
    void respond(request, response, { authority, token, api, assets });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 40;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, url: `${origin}/#owner=${token}` };
}
