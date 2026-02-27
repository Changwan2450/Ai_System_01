const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();

    // Set viewport to a typical desktop size
    await page.setViewport({ width: 1280, height: 800 });

    console.log('Navigating to http://localhost:5173 ...');
    await page.goto('http://localhost:5173', { waitUntil: 'load' });

    // Wait just enough to render but before 200ms state transition
    await new Promise(r => setTimeout(r, 50));

    // Capture first screenshot (phase:hidden)
    const hiddenPath = '/Users/changwan2450/.gemini/antigravity/brain/23625353-08c6-4f74-8f28-313dbdcbd27b/1_hidden.png';
    await page.screenshot({ path: hiddenPath });
    console.log('Saved hidden screenshot to', hiddenPath);

    // Wait for animation to largely finish (1 second)
    await new Promise(r => setTimeout(r, 1000));

    // Capture second screenshot (phase:show)
    const showPath = '/Users/changwan2450/.gemini/antigravity/brain/23625353-08c6-4f74-8f28-313dbdcbd27b/2_show.png';
    await page.screenshot({ path: showPath });
    console.log('Saved show screenshot to', showPath);

    await browser.close();
})();
