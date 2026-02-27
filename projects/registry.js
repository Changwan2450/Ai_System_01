// ─── Projects Registry ──────────────────────────────────────────────────────
// Central declaration of all project modules.
// Each entry tells server.cjs where files live and which API paths to mount.
// ─────────────────────────────────────────────────────────────────────────────

const projects = [
    {
        id: 'insider',
        label: 'AI Insider',
        baseDir: '__SET_ME__',
        listApi: '/api/insider/list',
        viewApi: '/api/insider/view',
    },
    {
        id: 'reports',
        label: 'AI Reports',
        baseDir: '__SET_ME__',
        listApi: '/api/reports/today',
        viewApi: '/api/reports/view',
    },
    {
        id: 'workQueue',
        label: 'Work Queue (naon output)',
        baseDir: '__SET_ME__',
        listApi: '/api/work-queue/list',
        viewApi: '/api/work-queue/view',
    },
];

module.exports = { projects };
