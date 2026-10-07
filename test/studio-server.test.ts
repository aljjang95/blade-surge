import { afterAll, beforeAll, expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { readFileSync } from 'node:fs';

let process: ChildProcess;
let port: number;
const templatePath = new URL('../tools/studio/ux-prompts.json', import.meta.url);
const original = readFileSync(templatePath, 'utf8');

function get(route: string, method = 'GET', host = `127.0.0.1:${port}`): Promise<{ status: number, body: string, allow: string | undefined }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: route, method, headers: { Host: host } }, response => {
      let body = '';
      response.setEncoding('utf8'); response.on('data', value => { body += value; });
      response.on('end', () => resolve({ status: response.statusCode!, body, allow: response.headers.allow }));
    });
    req.setTimeout(3000, () => req.destroy(new Error('Studio 응답 시간 초과')));
    req.on('error', reject); req.end();
  });
}

beforeAll(async () => {
  port = await new Promise<number>((resolve, reject) => {
    const reserve = createServer(); reserve.on('error', reject);
    reserve.listen(0, '127.0.0.1', () => {
      const address = reserve.address();
      if (!address || typeof address === 'string') return reject(new Error('포트 확인 실패'));
      const selected = address.port; reserve.close(() => resolve(selected));
    });
  });
  process = spawn('node', ['tools/studio-server.mjs', `--port=${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Studio 시작 시간 초과')), 4000);
    process.once('error', error => { clearTimeout(timer); reject(error); });
    process.once('exit', code => { clearTimeout(timer); reject(new Error(`Studio 조기 종료 ${code}`)); });
    process.stderr?.resume();
    process.stdout?.on('data', value => {
      if (String(value).includes('읽기 전용')) { clearTimeout(timer); resolve(); }
    });
  });
});
afterAll(async () => {
  if (process && process.exitCode === null) {
    const stopped = new Promise<void>(resolve => process.once('exit', () => resolve()));
    process.kill('SIGTERM'); await stopped;
  }
});

test('UX templates and prompt module are exact read-only routes', async () => {
  const result = await get('/api/ux-prompts');
  expect(result.status).toBe(200);
  const library = JSON.parse(result.body);
  expect(library.schema).toBe('blade-surge-ux-prompts/v1');
  expect(library.templates.map((value: { id: string }) => value.id)).toEqual(['home', 'departure', 'supply', 'shop']);
  const head = await get('/api/ux-prompts', 'HEAD');
  expect(head.status).toBe(200); expect(head.body).toBe('');
  expect((await get('/ux-prompt.js')).status).toBe(200);
  expect((await get('/ux-prompts.json')).status).toBe(404);
});

test('new template route cannot write, execute, escape its directory or accept foreign hosts', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const denied = await get('/api/ux-prompts', method);
    expect(denied.status).toBe(405); expect(denied.allow).toBe('GET, HEAD');
  }
  expect((await get('/api/ux-prompts', 'GET', 'foreign.example')).status).toBe(403);
  expect((await get('/%2e%2e%2fpackage.json')).status).toBe(400);
  expect((await get('/api/ux-prompts%00')).status).toBe(400);
  for (const route of ['/api/ux-prompts/../../package.json', '/api/exec', '/api/ux-prompts/execute', '/tools/studio/ux-prompts.json', '/package.json', '/.env']) {
    expect([400, 404]).toContain((await get(route)).status);
  }
  expect(readFileSync(templatePath, 'utf8')).toBe(original);
});
