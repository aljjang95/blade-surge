import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const port = Number(process.env.BLADE_PREVIEW_PORT || 5196);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid BLADE_PREVIEW_PORT');
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.webp':'image/webp', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml', '.glb':'model/gltf-binary', '.mp3':'audio/mpeg', '.mp4':'video/mp4', '.ogg':'audio/ogg', '.wav':'audio/wav', '.woff2':'font/woff2', '.woff':'font/woff', '.ttf':'font/ttf', '.ico':'image/x-icon' };
http.createServer(async (req,res) => {
  if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  let file;
  try { const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname); file=resolve(root,'.'+(path==='/'?'/index.html':path)); }
  catch { res.writeHead(400); res.end(); return; }
  if (!file.startsWith(root+sep)) { res.writeHead(403); res.end(); return; }
  let info;
  try { info=await stat(file); if (!info.isFile()) throw new Error('not a file'); }
  catch { res.writeHead(404); res.end(); return; }
  const headers={'Content-Type':types[extname(file)]||'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'};
  let start=0,end=info.size-1,status=200;
  if (req.headers.range) {
    const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!match || (!match[1]&&!match[2])) { res.writeHead(416,{'Content-Range':`bytes */${info.size}`}); res.end(); return; }
    if (!match[1]) start=Math.max(0,info.size-Number(match[2]));
    else { start=Number(match[1]); if(match[2])end=Math.min(end,Number(match[2])); }
    if (start>end || start>=info.size) { res.writeHead(416,{'Content-Range':`bytes */${info.size}`}); res.end(); return; }
    status=206; headers['Content-Range']=`bytes ${start}-${end}/${info.size}`;
  }
  headers['Content-Length']=String(Math.max(0,end-start+1)); res.writeHead(status,headers);
  if(req.method==='HEAD'||!info.size){res.end();return;}
  createReadStream(file,{start,end}).on('error',()=>res.destroy()).pipe(res);
}).listen(port,'127.0.0.1',()=>console.log(`BLADE SURGE preview: http://localhost:${port}/\nPress Ctrl+C to stop.`));
