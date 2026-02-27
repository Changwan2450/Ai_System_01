#!/usr/bin/env node
/**
 * playwright-mcp-local
 * MCP server exposing Playwright tools: open, screenshot, console dump, close.
 *
 * Tools:
 *   pw_open            – Launch a browser page and navigate to a URL
 *   pw_screenshot      – Capture a screenshot (desktop or mobile viewport)
 *   pw_console_dump    – Return all captured console messages
 *   pw_close           – Close the current page / browser
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { chromium } from "playwright";

// ── State ──────────────────────────────────────────────────────────────────
let browser = null;
let page = null;
/** @type {Array<{type:string, text:string}>} */
let consoleLogs = [];

// ── Helpers ────────────────────────────────────────────────────────────────
async function ensureBrowser() {
  if (!browser) {
    browser = await chromium.launch({ headless: true });
  }
}

async function ensurePage() {
  await ensureBrowser();
  if (!page || page.isClosed()) {
    page = await browser.newPage();
    consoleLogs = [];
    page.on("console", (msg) => {
      consoleLogs.push({ type: msg.type(), text: msg.text() });
    });
  }
}

async function closePage() {
  if (page && !page.isClosed()) {
    await page.close();
  }
  page = null;
  consoleLogs = [];
}

async function closeBrowser() {
  await closePage();
  if (browser) {
    await browser.close();
    browser = null;
  }
}

// ── MCP Server ─────────────────────────────────────────────────────────────
const server = new McpServer({
  name: "playwright-mcp-local",
  version: "0.1.0",
});

// ── Tool: pw_open ──────────────────────────────────────────────────────────
server.tool(
  "pw_open",
  "Open a URL in a headless Chromium browser. Returns the final URL and page title.",
  {
    url: z.string().url().describe("The URL to navigate to"),
    waitUntil: z
      .enum(["load", "domcontentloaded", "networkidle"])
      .default("domcontentloaded")
      .describe("Navigation wait condition"),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .default(15000)
      .describe("Navigation timeout in milliseconds"),
  },
  async ({ url, waitUntil, timeoutMs }) => {
    try {
      await ensurePage();
      await page.goto(url, { waitUntil, timeout: timeoutMs });
      const title = await page.title();
      const finalUrl = page.url();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, url: finalUrl, title }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: false, error: String(err) }) }],
        isError: true,
      };
    }
  }
);

// ── Tool: pw_screenshot ────────────────────────────────────────────────────
server.tool(
  "pw_screenshot",
  "Take a screenshot of the current page. Supports desktop and mobile viewport presets.",
  {
    outputPath: z
      .string()
      .describe("Absolute or relative path where the PNG will be saved"),
    viewport: z
      .enum(["desktop", "mobile"])
      .default("desktop")
      .describe("Viewport preset: desktop (1440×900) or mobile (390×844)"),
    fullPage: z
      .boolean()
      .default(false)
      .describe("Capture the full scrollable page"),
  },
  async ({ outputPath, viewport, fullPage }) => {
    if (!page || page.isClosed()) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: false, error: "No open page. Call pw_open first." }),
          },
        ],
        isError: true,
      };
    }
    try {
      const viewports = {
        desktop: { width: 1440, height: 900 },
        mobile: { width: 390, height: 844 },
      };
      await page.setViewportSize(viewports[viewport]);
      await page.screenshot({ path: outputPath, fullPage });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, savedTo: outputPath, viewport }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: false, error: String(err) }) }],
        isError: true,
      };
    }
  }
);

// ── Tool: pw_console_dump ──────────────────────────────────────────────────
server.tool(
  "pw_console_dump",
  "Return all console messages captured since the last pw_open call.",
  {
    filter: z
      .enum(["all", "error", "warning", "log"])
      .default("all")
      .describe("Filter by message type"),
  },
  async ({ filter }) => {
    const filtered =
      filter === "all"
        ? consoleLogs
        : consoleLogs.filter((m) => m.type === filter);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ ok: true, count: filtered.length, messages: filtered }),
        },
      ],
    };
  }
);

// ── Tool: pw_close ─────────────────────────────────────────────────────────
server.tool(
  "pw_close",
  "Close the current page and browser, freeing all resources.",
  {},
  async () => {
    try {
      await closeBrowser();
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, message: "Browser closed." }) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: false, error: String(err) }) }],
        isError: true,
      };
    }
  }
);

// ── Start ──────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
