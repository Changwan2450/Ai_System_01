const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
    const browser = await chromium.launch();
    try {
        const page = await browser.newPage();

        // Console dump
        const logs = [];
        page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
        page.on('pageerror', error => logs.push(`[error] ${error.message}`));

        console.log('Navigating to http://127.0.0.1:5173 ...');
        await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded', timeout: 15000 });

        fs.mkdirSync('./artifacts/ui', { recursive: true });

        // Desktop
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.waitForTimeout(1000);
        await page.screenshot({ path: './artifacts/ui/desktop.png', fullPage: true });

        // Mobile
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(1000);
        await page.screenshot({ path: './artifacts/ui/mobile.png', fullPage: true });

        console.log('--- CONSOLE DUMP ---');
        console.log(logs.join('\n') || 'No console logs.');
        console.log('--------------------');
        console.log('Screenshots saved to ./artifacts/ui/');
    } catch (err) {
        console.error('QA Script Error:', err);
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
