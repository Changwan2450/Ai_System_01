// AI Insider – Standalone Board Server (dev preview)
// Run: node serve.js    (port 3001)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3001;
const POSTS_DIR = path.join(__dirname, '..', 'naon.py', 'output', 'insider', 'posts');

function getPosts() {
    try {
        const files = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.md'));
        return files.map(f => {
            const content = fs.readFileSync(path.join(POSTS_DIR, f), 'utf-8');
            const title = (content.match(/^#\s+(.+)/m) || [, f.replace('.md', '')])[1];
            const stat = fs.statSync(path.join(POSTS_DIR, f));
            return { file: f, title, time: stat.mtime.toISOString().slice(0, 16).replace('T', ' ') };
        }).sort((a, b) => b.time.localeCompare(a.time));
    } catch { return []; }
}

const server = http.createServer((_req, res) => {
    const posts = getPosts();
    const rows = posts.length
        ? posts.map(p => `
      <div style="padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;gap:12px">
        <span style="font-size:18px">📝</span>
        <div style="flex:1;min-width:0">
          <p style="font-size:13px;font-weight:600;color:rgba(255,255,255,0.85);margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.title}</p>
          <p style="font-size:10px;color:rgba(255,255,255,0.3);margin:2px 0 0">${p.file}</p>
        </div>
        <span style="font-size:10px;color:rgba(255,255,255,0.25);white-space:nowrap">${p.time}</span>
      </div>`).join('')
        : '<p style="text-align:center;padding:40px;color:rgba(255,255,255,0.3);font-size:13px">No posts yet. Run insider/run.js to generate content.</p>';

    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Insider</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a12;color:#e0e0e8;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Inter',system-ui,sans-serif;min-height:100vh}
.header{padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;gap:10px;background:rgba(255,255,255,0.02)}
.header h1{font-size:15px;font-weight:700;color:#fff}
.badge{font-size:9px;padding:2px 8px;border-radius:6px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;background:rgba(34,211,238,0.12);border:1px solid rgba(34,211,238,0.25);color:#22d3ee}
.count{font-size:11px;color:rgba(255,255,255,0.35);margin-left:auto}
.main{max-width:680px;margin:0 auto}
</style>
</head>
<body>
<div class="header">
  <span style="font-size:20px">🧠</span>
  <h1>AI Insider</h1>
  <span class="badge">Board</span>
  <span class="count">${posts.length} posts</span>
</div>
<div class="main">${rows}</div>
</body>
</html>`;

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
});

server.listen(PORT, () => {
    console.log(`[AI Insider] Board running at http://localhost:${PORT}`);
    console.log(`[AI Insider] Posts dir: ${POSTS_DIR}`);
});
