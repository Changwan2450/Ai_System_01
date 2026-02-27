// ─── AI_SYSTEM Dashboard Backend (Phase 3) ──────────────────────────────────
// Express server: Videos, Daily MD CRUD, Reports, AI Insider.
// Run: node server.cjs   (port 8787)
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const MarkdownIt = require('markdown-it');

const md = new MarkdownIt({ html: true, linkify: true, typographer: true });
const { projects } = require('./projects/registry.cjs');
const app = express();
const PORT = 8787;

// ─── Paths ───────────────────────────────────────────────────────────────────
const OUTPUT_DIR = process.env.OUTPUT_DIR || '/Users/changwan2450/Antigravity WorkSpace/AI_SYSTEM/naon.py/output';
const AI_SYSTEM_ROOT = process.env.AI_SYSTEM_ROOT || '/Users/changwan2450/Antigravity WorkSpace/AI_SYSTEM';
const REPORTS_DIR = path.join(OUTPUT_DIR, 'reports', 'posts');
const DAILY_DIR = path.join(OUTPUT_DIR, 'daily');
const INSIDER_DIR = process.env.INSIDER_DIR || path.join(OUTPUT_DIR, 'insider');
const INSIDER_POSTS = path.join(INSIDER_DIR, 'posts');
const INSIDER_CANDIDATES = path.join(INSIDER_DIR, 'candidates');
const INSIDER_LOG = path.join(INSIDER_DIR, 'logs', 'insider.log');
const INSIDER_STATE = path.join(INSIDER_DIR, 'state.json');
const INSIDER_RUN_JS = path.join(AI_SYSTEM_ROOT, 'insider', 'run.js');
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.avi', '.mkv']);
const FAILED_KEYWORDS = ['failed', 'error', 'err'];

app.use(cors());
app.use(express.json());

// ─── Common Helpers ──────────────────────────────────────────────────────────

function safeReaddir(dir) {
    try { return fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return []; }
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function formatTime(ms) {
    const d = new Date(ms);
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function isInsideDir(filePath, baseDir) {
    const resolved = path.resolve(filePath);
    const base = path.resolve(baseDir);
    return resolved.startsWith(base + path.sep) || resolved === base;
}

function readJsonSafe(fp) {
    try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); }
    catch { return null; }
}

// ─── Video Helpers ───────────────────────────────────────────────────────────

function isVideoFile(name) {
    return VIDEO_EXTS.has(path.extname(name).toLowerCase());
}

function isFailed(filePath, failedDirs) {
    const lower = filePath.toLowerCase();
    if (failedDirs.some(fd => lower.startsWith(fd.toLowerCase()))) return true;
    return FAILED_KEYWORDS.some(kw => path.basename(lower).includes(kw));
}

function collectVideos(dir, failedDirs) {
    const results = [];
    for (const entry of safeReaddir(dir)) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!entry.name.startsWith('.')) results.push(...collectVideos(full, failedDirs));
        } else if (isVideoFile(entry.name)) {
            try {
                const stat = fs.statSync(full);
                results.push({ path: full, name: entry.name, mtime: stat.mtimeMs, size: stat.size });
            } catch { /* skip */ }
        }
    }
    return results;
}

function getFailedDirs() {
    const dirs = [];
    for (const c of [path.join(OUTPUT_DIR, 'failed'), path.join(OUTPUT_DIR, 'videos', 'failed')]) {
        try { if (fs.statSync(c).isDirectory()) dirs.push(c); } catch { /* not found */ }
    }
    return dirs;
}

function makeVideoItem(file, index, failedDirs) {
    const nameNoExt = path.basename(file.name, path.extname(file.name));
    const hash = crypto.createHash('md5').update(file.path).digest('hex').slice(0, 4);
    return {
        id: hash, bno: 1400 + index,
        title: nameNoExt.replace(/_/g, ' '), duration: '',
        status: isFailed(file.path, failedDirs) ? 'failed' : 'uploaded',
        created_at: formatTime(file.mtime),
    };
}

// ─── Reports Helpers ─────────────────────────────────────────────────────────

function parseMdTitle(content) {
    const m = content.match(/^#\s+(.+)/m);
    return m ? m[1].trim() : null;
}

function inferCategory(filename, title) {
    const t = `${filename} ${title}`.toLowerCase();
    if (/gpt|openai|codex/.test(t)) return 'AI';
    if (/claude|anthropic|mcp/.test(t)) return 'AI';
    if (/tailwind|react|vite/.test(t)) return 'TECH';
    if (/docker|deploy|n8n/.test(t)) return 'TECH';
    if (/market|industry|시장|regulation|법|act/.test(t)) return 'AGRO';
    return 'AI';
}

function collectReports() {
    const results = [];
    for (const entry of safeReaddir(REPORTS_DIR)) {
        if (!entry.isFile() || path.extname(entry.name) !== '.md') continue;
        const full = path.join(REPORTS_DIR, entry.name);
        try {
            const stat = fs.statSync(full);
            const content = fs.readFileSync(full, 'utf-8');
            const title = parseMdTitle(content) || entry.name.replace('.md', '');
            results.push({
                id: entry.name, title, category: inferCategory(entry.name, title),
                path: full, mtimeISO: new Date(stat.mtimeMs).toISOString(), timeHHMM: formatTime(stat.mtimeMs),
            });
        } catch { /* skip */ }
    }
    results.sort((a, b) => new Date(b.mtimeISO).getTime() - new Date(a.mtimeISO).getTime());
    return results.slice(0, 5);
}

// ─── Insider Helpers ─────────────────────────────────────────────────────────

function collectInsiderPosts() {
    const results = [];
    for (const entry of safeReaddir(INSIDER_POSTS)) {
        if (!entry.isFile() || path.extname(entry.name) !== '.md') continue;
        const baseName = entry.name.replace('.md', '');
        const jsonPath = path.join(INSIDER_POSTS, baseName + '.json');
        const mdPath = path.join(INSIDER_POSTS, entry.name);
        const meta = readJsonSafe(jsonPath);
        let title = meta?.title || null;
        if (!title) {
            try {
                const content = fs.readFileSync(mdPath, 'utf-8');
                title = parseMdTitle(content) || baseName;
            } catch { title = baseName; }
        }
        try {
            const stat = fs.statSync(mdPath);
            results.push({
                id: baseName,
                mdFile: entry.name,
                title,
                score_total: meta?.score_total ?? null,
                tags: meta?.tags ?? [],
                published_at: meta?.published_at || new Date(stat.mtimeMs).toISOString(),
                timeHHMM: formatTime(stat.mtimeMs),
            });
        } catch { /* skip */ }
    }
    results.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());
    return results;
}

// ─── Shared HTML wrapper for MD preview ──────────────────────────────────────

function renderMdPage(title, html) {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a10;color:#e0e0e8;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Inter',system-ui,sans-serif;padding:40px;max-width:780px;margin:0 auto;line-height:1.7}
h1{font-size:1.8rem;margin-bottom:16px;color:#fff;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:12px}
h2{font-size:1.25rem;margin:28px 0 10px;color:#22d3ee}
h3{font-size:1.1rem;margin:20px 0 8px;color:#a78bfa}
p{margin:8px 0;color:rgba(255,255,255,0.75)}
ul,ol{padding-left:24px;margin:8px 0}
li{margin:4px 0;color:rgba(255,255,255,0.7)}
blockquote{border-left:3px solid #22d3ee;padding:8px 16px;margin:12px 0;background:rgba(34,211,238,0.06);border-radius:0 8px 8px 0}
blockquote p{color:rgba(255,255,255,0.6)}
code{background:rgba(255,255,255,0.08);padding:2px 6px;border-radius:4px;font-size:0.9em;color:#22d3ee}
pre{background:rgba(255,255,255,0.05);padding:16px;border-radius:8px;overflow-x:auto;margin:12px 0}
pre code{background:none;padding:0}
hr{border:none;border-top:1px solid rgba(255,255,255,0.08);margin:24px 0}
a{color:#22d3ee;text-decoration:none}
a:hover{text-decoration:underline}
strong{color:rgba(255,255,255,0.9)}
</style>
</head>
<body>${html}</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// ── Projects ─────────────────────────────────────────────────────────────────
app.get('/api/projects', (_req, res) => { res.json({ projects }); });

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
    res.json({ ok: true, outputDir: OUTPUT_DIR });
});

// ── Videos ───────────────────────────────────────────────────────────────────
app.get('/api/videos/summary', (_req, res) => {
    const failedDirs = getFailedDirs();
    const allVideos = collectVideos(OUTPUT_DIR, failedDirs);
    allVideos.sort((a, b) => b.mtime - a.mtime);
    const recent = allVideos.slice(0, 12).map((f, i) => makeVideoItem(f, i, failedDirs));
    const failedCount = allVideos.filter(f => isFailed(f.path, failedDirs)).length;
    res.json({
        queueSize: allVideos.length, failed: failedCount, recent,
        paths: { outputDir: OUTPUT_DIR, videosDir: fs.existsSync(path.join(OUTPUT_DIR, 'videos')) ? path.join(OUTPUT_DIR, 'videos') : OUTPUT_DIR, failedDirs },
    });
});

app.post('/api/videos/clean-failed', (_req, res) => {
    const failedDirs = getFailedDirs();
    const failedFiles = collectVideos(OUTPUT_DIR, failedDirs).filter(f => isFailed(f.path, failedDirs));
    const deleted = [];
    for (const f of failedFiles) { try { fs.unlinkSync(f.path); deleted.push(f.name); } catch { /* skip */ } }
    const remaining = collectVideos(OUTPUT_DIR, getFailedDirs());
    res.json({ ok: true, deleted: deleted.length, deletedFiles: deleted.slice(0, 20), failedBefore: failedFiles.length, failedAfter: remaining.filter(f => isFailed(f.path, getFailedDirs())).length });
});

// ── Reports ──────────────────────────────────────────────────────────────────
app.get('/api/reports/today', (_req, res) => {
    try { res.json(collectReports()); }
    catch (err) { res.status(500).json({ error: String(err) }); }
});

app.post('/api/reports/open', (req, res) => {
    const { path: fp } = req.body;
    if (!fp || typeof fp !== 'string') return res.status(400).json({ ok: false, error: 'path required' });
    if (!isInsideDir(fp, REPORTS_DIR)) return res.status(403).json({ ok: false, error: 'Access denied' });
    if (!fs.existsSync(fp)) return res.status(404).json({ ok: false, error: 'Not found' });
    execFile('open', [fp], (err) => {
        if (err) return res.status(500).json({ ok: false, error: err.message });
        res.json({ ok: true });
    });
});

app.get('/api/reports/view', (req, res) => {
    const file = req.query.file;
    if (!file || typeof file !== 'string') return res.status(400).send('file parameter required');
    const fp = path.join(REPORTS_DIR, path.basename(file));
    if (!isInsideDir(fp, REPORTS_DIR)) return res.status(403).send('Access denied');
    if (!fs.existsSync(fp)) return res.status(404).send('File not found');
    const raw = fs.readFileSync(fp, 'utf-8');
    const html = md.render(raw);
    res.type('html').send(renderMdPage(path.basename(file, '.md'), html));
});

// ── AI Insider ───────────────────────────────────────────────────────────────

// Status: state.json + counts + last log lines
app.get('/api/insider/status', (_req, res) => {
    const state = readJsonSafe(INSIDER_STATE) || { last_run: null, last_publish: null, paused: true };
    const postsCount = safeReaddir(INSIDER_POSTS).filter(e => e.isFile() && e.name.endsWith('.md')).length;
    const candidatesCount = safeReaddir(INSIDER_CANDIDATES).filter(e => e.isFile()).length;
    let lastLog = '';
    try {
        const full = fs.readFileSync(INSIDER_LOG, 'utf-8');
        const lines = full.split('\n');
        lastLog = lines.slice(-50).join('\n');
    } catch { /* no log */ }
    res.json({ ...state, postsCount, candidatesCount, lastLog });
});

// List posts
app.get('/api/insider/list', (_req, res) => {
    try { res.json(collectInsiderPosts()); }
    catch (err) { res.status(500).json({ error: String(err) }); }
});

// View single post (md → HTML)
app.get('/api/insider/view', (req, res) => {
    const file = req.query.file;
    if (!file || typeof file !== 'string') return res.status(400).send('file parameter required');
    const fp = path.join(INSIDER_POSTS, path.basename(file));
    if (!isInsideDir(fp, INSIDER_POSTS)) return res.status(403).send('Access denied');
    if (!fs.existsSync(fp)) return res.status(404).send('File not found');
    const raw = fs.readFileSync(fp, 'utf-8');
    const html = md.render(raw);
    res.type('html').send(renderMdPage(path.basename(file, '.md'), html));
});

// View post as HTML fragment (for inline preview)
app.get('/api/insider/preview', (req, res) => {
    const file = req.query.file;
    if (!file || typeof file !== 'string') return res.status(400).json({ ok: false, error: 'file required' });
    const fp = path.join(INSIDER_POSTS, path.basename(file));
    if (!isInsideDir(fp, INSIDER_POSTS)) return res.status(403).json({ ok: false, error: 'Access denied' });
    if (!fs.existsSync(fp)) return res.status(404).json({ ok: false, error: 'Not found' });
    const raw = fs.readFileSync(fp, 'utf-8');
    const html = md.render(raw);
    // Also return JSON meta if available
    const jsonPath = fp.replace(/\.md$/, '.json');
    const meta = readJsonSafe(jsonPath);
    res.json({ ok: true, html, meta });
});

// Sources: aggregate source.name across all post JSONs
app.get('/api/insider/sources', (_req, res) => {
    const map = new Map()
    for (const entry of safeReaddir(INSIDER_POSTS)) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue
        const meta = readJsonSafe(path.join(INSIDER_POSTS, entry.name))
        if (!meta) continue
        const name = meta.source?.name || meta.source_site || 'Unknown'
        const url = meta.source?.url || meta.source_url || null
        const existing = map.get(name)
        if (existing) { existing.count++; if (url) existing.url = url }
        else map.set(name, { name, count: 1, url })
    }
    const sources = [...map.values()].sort((a, b) => b.count - a.count)
    const totalPosts = safeReaddir(INSIDER_POSTS).filter(e => e.isFile() && e.name.endsWith('.md')).length
    res.json({ sources, totalPosts })
});

// Run insider pipeline (fire-and-forget)
app.post('/api/insider/run', (_req, res) => {
    if (!fs.existsSync(INSIDER_RUN_JS)) {
        return res.status(404).json({ ok: false, error: 'insider/run.js not found' });
    }
    const child = spawn('node', [INSIDER_RUN_JS], {
        cwd: path.dirname(INSIDER_RUN_JS),
        stdio: 'ignore',
        detached: true,
    });
    child.unref();
    res.status(202).json({ ok: true, message: 'Pipeline started' });
});

// ── Daily MD CRUD ────────────────────────────────────────────────────────────

app.get('/api/daily/list', (_req, res) => {
    ensureDir(DAILY_DIR);
    const files = [];
    for (const entry of safeReaddir(DAILY_DIR)) {
        if (!entry.isFile() || path.extname(entry.name) !== '.md') continue;
        const fp = path.join(DAILY_DIR, entry.name);
        try {
            const stat = fs.statSync(fp);
            files.push({
                id: entry.name.replace('.md', ''),
                filename: entry.name,
                mtimeISO: new Date(stat.mtimeMs).toISOString(),
                timeHHMM: formatTime(stat.mtimeMs),
            });
        } catch { /* skip */ }
    }
    files.sort((a, b) => b.id.localeCompare(a.id));
    res.json(files);
});

app.get('/api/daily/:id', (req, res) => {
    const id = req.params.id;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(id)) return res.status(400).json({ ok: false, error: 'Invalid id format (YYYY-MM-DD)' });
    const fp = path.join(DAILY_DIR, `${id}.md`);
    if (!isInsideDir(fp, DAILY_DIR)) return res.status(403).json({ ok: false, error: 'Access denied' });
    if (!fs.existsSync(fp)) return res.status(404).json({ ok: false, error: 'Not found', content: '' });
    const content = fs.readFileSync(fp, 'utf-8');
    res.json({ ok: true, id, content, path: fp });
});

app.post('/api/daily/save', (req, res) => {
    const { id, content } = req.body;
    if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(id)) return res.status(400).json({ ok: false, error: 'id must be YYYY-MM-DD' });
    if (typeof content !== 'string') return res.status(400).json({ ok: false, error: 'content must be a string' });
    ensureDir(DAILY_DIR);
    const fp = path.join(DAILY_DIR, `${id}.md`);
    if (!isInsideDir(fp, DAILY_DIR)) return res.status(403).json({ ok: false, error: 'Access denied' });
    fs.writeFileSync(fp, content, 'utf-8');
    res.json({ ok: true, id, path: fp });
});

app.delete('/api/daily/:id', (req, res) => {
    const id = req.params.id;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(id)) return res.status(400).json({ ok: false, error: 'Invalid id' });
    const fp = path.join(DAILY_DIR, `${id}.md`);
    if (!isInsideDir(fp, DAILY_DIR)) return res.status(403).json({ ok: false, error: 'Access denied' });
    if (!fs.existsSync(fp)) return res.status(404).json({ ok: false, error: 'Not found' });
    fs.unlinkSync(fp);
    res.json({ ok: true, id });
});

// Legacy: read /api/md/today
app.get('/api/md/today', (_req, res) => {
    const MD_DIR = path.join(OUTPUT_DIR, 'md');
    const MD_FILE = path.join(MD_DIR, 'today.md');
    ensureDir(MD_DIR);
    if (!fs.existsSync(MD_FILE)) fs.writeFileSync(MD_FILE, '', 'utf-8');
    const content = fs.readFileSync(MD_FILE, 'utf-8');
    res.json({ ok: true, content, path: MD_FILE });
});

app.post('/api/md/today', (req, res) => {
    const { content } = req.body;
    if (typeof content !== 'string') return res.status(400).json({ ok: false, error: 'content must be a string' });
    const MD_DIR = path.join(OUTPUT_DIR, 'md');
    ensureDir(MD_DIR);
    fs.writeFileSync(path.join(MD_DIR, 'today.md'), content, 'utf-8');
    res.json({ ok: true });
});

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`[AI_SYSTEM] Backend running at http://localhost:${PORT}`);
    console.log(`[AI_SYSTEM] OUTPUT_DIR   = ${OUTPUT_DIR}`);
    console.log(`[AI_SYSTEM] REPORTS_DIR  = ${REPORTS_DIR}`);
    console.log(`[AI_SYSTEM] DAILY_DIR    = ${DAILY_DIR}`);
    console.log(`[AI_SYSTEM] INSIDER_DIR  = ${INSIDER_DIR}`);
    console.log(`[AI_SYSTEM] Endpoints:`);
    console.log(`  GET  /api/projects`);
    console.log(`  GET  /api/health`);
    console.log(`  GET  /api/videos/summary`);
    console.log(`  POST /api/videos/clean-failed`);
    console.log(`  GET  /api/reports/today`);
    console.log(`  POST /api/reports/open`);
    console.log(`  GET  /api/reports/view?file=`);
    console.log(`  GET  /api/insider/sources`);
    console.log(`  GET  /api/insider/status`);
    console.log(`  GET  /api/insider/list`);
    console.log(`  GET  /api/insider/view?file=`);
    console.log(`  GET  /api/insider/preview?file=`);
    console.log(`  POST /api/insider/run`);
    console.log(`  GET  /api/daily/list`);
    console.log(`  GET  /api/daily/:id`);
    console.log(`  POST /api/daily/save`);
    console.log(`  DELETE /api/daily/:id`);
});
