// Local authoring tool. Run npm ci && npm run preview; FFmpeg must be on PATH.
import http from 'node:http';
import { readFile, writeFile, mkdir, rm, copyFile } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frames = resolve(root, '.capture');
const port = Number(process.env.PROFILE_PREVIEW_PORT || 8769);
let expectedFrame = 0;
let exporting = false;
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Profile motion export</title><style>body{margin:0;padding:24px;background:#050908;color:#c9d4cb;font:14px monospace}iframe{display:block;border:0;width:min(100%,1200px);aspect-ratio:1200/420}button{background:#a3ff12;color:#050908;border:0;padding:12px 20px;font:inherit;cursor:pointer;margin:20px 0}a{color:#a3ff12}</style>
<h1>Profile motion</h1><p>Three.js scene / GSAP timeline / 6-second loop</p>
<iframe id="scene" title="Three-dimensional profile animation" src="/motion/scene.html?capture"></iframe>
<button id="export">Export README animation</button><p id="status" role="status">Ready to render.</p>
<script>
const button=document.querySelector('#export'),status=document.querySelector('#status'),frame=document.querySelector('#scene');
button.onclick=async()=>{button.disabled=true;try{
if(!frame.contentWindow.ready)throw Error('Scene is not ready. Wait for the preview to load.');
async function post(path,body){const r=await fetch(path,{method:'POST',body});if(!r.ok)throw Error(await r.text());return r;}
await post('/capture/start');
for(let i=0;i<72;i++){status.textContent='Rendering frame '+(i+1)+' / 72';const canvas=frame.contentWindow.renderFrame(i/12);const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));if(!blob)throw Error('Canvas export failed');await post('/capture/frame/'+i,blob);}
status.textContent='Encoding GIF…';await post('/capture/finish');status.textContent='Export complete: 72 frames, 6 seconds. GIF and reduced-motion PNG saved in assets/.';
}catch(e){status.textContent='Export failed: '+e.message;}finally{button.disabled=false;}};
</script>`;

const server = http.createServer(async (req, res) => {
  try {
    // This write-capable development service accepts only its own loopback origin.
    if (req.headers.host !== `127.0.0.1:${port}` ||
        (req.headers.origin && req.headers.origin !== `http://127.0.0.1:${port}`)) {
      res.writeHead(403).end('Loopback origin required'); return;
    }
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (req.method === 'POST') {
      if (url.pathname === '/capture/start') {
        // Only the dedicated ignored capture folder is cleared, never application data.
        await rm(frames, { recursive: true, force: true });
        await mkdir(frames, { recursive: true });
        expectedFrame = 0; exporting = true;
        res.end('Started'); return;
      }
      const match = url.pathname.match(/^\/capture\/frame\/(\d+)$/);
      if (match) {
        if (!exporting || Number(match[1]) !== expectedFrame || expectedFrame >= 72) {
          res.writeHead(409).end('Unexpected frame'); return;
        }
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 5_000_000) { res.writeHead(413).end('Frame too large'); return; }
          chunks.push(chunk);
        }
        const data = Buffer.concat(chunks);
        if (!data.subarray(0, 8).equals(pngSignature)) { res.writeHead(400).end('PNG required'); return; }
        await writeFile(resolve(frames, `${String(expectedFrame).padStart(3, '0')}.png`), data);
        expectedFrame++; res.end('Saved'); return;
      }
      if (url.pathname === '/capture/finish' && exporting && expectedFrame === 72) {
        await mkdir(resolve(root, 'assets'), { recursive: true });
        const result = spawnSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '12', '-i',
          resolve(frames, '%03d.png'), '-filter_complex',
          '[0:v]split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
          '-loop', '0', resolve(root, 'assets/hacker-hero.gif')], { windowsHide: true, encoding: 'utf8', timeout: 60000 });
        if (result.error || result.status !== 0) throw Error(result.error?.message || result.stderr || 'FFmpeg failed');
        await copyFile(resolve(frames, '000.png'), resolve(root, 'assets/hacker-hero.png'));
        exporting = false; res.end('Export complete'); return;
      }
      res.writeHead(404).end('Unknown capture endpoint'); return;
    }
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    if (url.pathname === '/render' || url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html); return;
    }
    const path = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!path.startsWith(root + sep) || path.includes(`${sep}.git${sep}`) || path.includes(`${sep}.capture${sep}`)) {
      res.writeHead(403).end(); return;
    }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif', '.css': 'text/css' };
    const content = await readFile(path);
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' }).end(content);
  } catch (error) {
    console.error(error.message);
    res.writeHead(500).end('Local preview failed; check server output.');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Profile preview: http://127.0.0.1:${port}/render (pid ${process.pid})`));
