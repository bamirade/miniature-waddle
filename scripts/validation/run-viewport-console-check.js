#!/usr/bin/env node

const fs = require('fs/promises');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (error) {
  console.error('Missing dependency: playwright');
  console.error('Install and provision Chromium before running:');
  console.error('  npm install --no-save playwright');
  console.error('  npx playwright install chromium');
  process.exit(1);
}

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SERVER_ENTRY = path.join('src', 'server.js');
const HOST_VIEWPORT = { width: 1366, height: 768 };
const STUDENT_VIEWPORT = { width: 390, height: 844 };
const READY_TIMEOUT_MS = 20_000;
const FLOW_TIMEOUT_MS = 60_000;
const SHUTDOWN_TIMEOUT_MS = 4_000;

function requestUrl(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`request timeout for ${url}`));
    });
    req.on('error', reject);
  });
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address !== 'object') {
        server.close(() => reject(new Error('Could not read free port')));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function startServer(port) {
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      HOST_IP: '127.0.0.1',
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logs = [];
  const append = (source, chunk) => {
    const lines = String(chunk)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines) {
      logs.push(`[${source}] ${line}`);
      if (logs.length > 220) {
        logs.shift();
      }
    }
  };

  child.stdout.on('data', (chunk) => append('stdout', chunk));
  child.stderr.on('data', (chunk) => append('stderr', chunk));

  return {
    child,
    getLogs: () => logs.join('\n'),
  };
}

async function waitForServerReady(baseUrl, serverProcess) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (serverProcess.child.exitCode !== null) {
      throw new Error(`server exited early with code ${serverProcess.child.exitCode}`);
    }

    try {
      const response = await requestUrl(`${baseUrl}/config`, 1_000);
      if (response.statusCode >= 200 && response.statusCode < 300) {
        return;
      }
    } catch (error) {
      // retry until timeout
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error('server readiness timeout');
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve(true);
      return;
    }

    const onExit = () => {
      cleanup();
      resolve(true);
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      child.off('exit', onExit);
    }

    child.once('exit', onExit);
  });
}

async function stopServer(serverProcess) {
  if (!serverProcess || serverProcess.child.exitCode !== null) {
    return;
  }

  serverProcess.child.kill('SIGTERM');
  let exited = await waitForExit(serverProcess.child, SHUTDOWN_TIMEOUT_MS);

  if (!exited && serverProcess.child.exitCode === null) {
    serverProcess.child.kill('SIGKILL');
    exited = await waitForExit(serverProcess.child, SHUTDOWN_TIMEOUT_MS);
  }

  if (!exited) {
    throw new Error('server did not exit after SIGKILL');
  }
}

function wireConsoleCapture(page, bucket) {
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') {
      bucket.consoleErrors.push(text);
    } else if (msg.type() === 'warning') {
      bucket.consoleWarnings.push(text);
    }
  });

  page.on('pageerror', (error) => {
    bucket.pageErrors.push(error && error.message ? error.message : String(error));
  });
}

async function run() {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverProcess = startServer(port);

  let browser = null;
  const report = {
    timestamp: new Date().toISOString(),
    baseUrl,
    hostViewport: HOST_VIEWPORT,
    studentViewport: STUDENT_VIEWPORT,
    host: {
      consoleErrors: [],
      consoleWarnings: [],
      pageErrors: [],
      criticalVisible: null,
      criticalElements: null,
    },
    student: {
      consoleErrors: [],
      consoleWarnings: [],
      pageErrors: [],
      hudOverlap: null,
      minOptionHeight: null,
      optionCountMeasured: 0,
    },
    failures: [],
    serverLogTail: null,
  };

  try {
    await waitForServerReady(baseUrl, serverProcess);

    browser = await chromium.launch({
      headless: true,
      args: ['--disable-dev-shm-usage', '--no-sandbox'],
    });

    const hostContext = await browser.newContext({ viewport: HOST_VIEWPORT });
    const hostPage = await hostContext.newPage();
    wireConsoleCapture(hostPage, report.host);

    const studentContext = await browser.newContext({
      viewport: STUDENT_VIEWPORT,
      isMobile: true,
      hasTouch: true,
    });

    await studentContext.addInitScript(() => {
      try {
        window.localStorage.setItem('nickname', 'Viewport Student');
      } catch (error) {
        // non-fatal
      }
    });

    const studentPage = await studentContext.newPage();
    wireConsoleCapture(studentPage, report.student);

    await Promise.all([
      hostPage.goto(`${baseUrl}/host`, { waitUntil: 'networkidle' }),
      studentPage.goto(`${baseUrl}/student`, { waitUntil: 'networkidle' }),
    ]);

    await hostPage.waitForFunction(() => {
      const btn = document.getElementById('start-button');
      return !!btn && !btn.disabled;
    }, null, { timeout: FLOW_TIMEOUT_MS / 2 });

    report.host.criticalElements = await hostPage.evaluate(() => {
      const viewportHeight = window.innerHeight;
      const ids = ['host-phase-banner', 'start-button', 'stat-total', 'stat-ready', 'stat-alive'];
      const items = ids.map((id) => {
        const element = document.getElementById(id);
        if (!element) {
          return { id, exists: false, visibleInViewport: false };
        }

        const rect = element.getBoundingClientRect();
        const visibleInViewport = rect.top >= 0 && rect.bottom <= viewportHeight;

        return {
          id,
          exists: true,
          top: rect.top,
          bottom: rect.bottom,
          visibleInViewport,
        };
      });

      return {
        viewportHeight,
        items,
        allVisible: items.every((item) => item.exists && item.visibleInViewport),
      };
    });

    report.host.criticalVisible = !!report.host.criticalElements.allVisible;

    await studentPage.evaluate(() => {
      if (window.__autoPickTimer) {
        return;
      }

      window.__autoPickTimer = window.setInterval(() => {
        const button = document.querySelector('#phase-round:not(.hidden) .option-button:not(:disabled)');
        if (button) {
          button.click();
        }
      }, 250);
    });

    await hostPage.click('#start-button');

    await studentPage.waitForFunction(() => {
      const round = document.getElementById('phase-round');
      if (!round || round.classList.contains('hidden')) {
        return false;
      }
      return !!document.querySelector('#phase-round .option-button');
    }, null, { timeout: FLOW_TIMEOUT_MS });

    const studentViewportEvidence = await studentPage.evaluate(() => {
      const hud = document.querySelector('.student-hud');
      const question = document.querySelector('#phase-round .question-card');
      const options = Array.from(document.querySelectorAll('#phase-round .option-button'));

      const hudRect = hud ? hud.getBoundingClientRect() : null;
      const questionRect = question ? question.getBoundingClientRect() : null;
      const optionHeights = options.map((button) => button.getBoundingClientRect().height);
      const minOptionHeight = optionHeights.length > 0 ? Math.min(...optionHeights) : null;

      const overlap = !!(hudRect && questionRect && questionRect.top < hudRect.bottom);

      return {
        overlap,
        hudBottom: hudRect ? hudRect.bottom : null,
        questionTop: questionRect ? questionRect.top : null,
        minOptionHeight,
        optionCountMeasured: optionHeights.length,
      };
    });

    report.student.hudOverlap = studentViewportEvidence.overlap;
    report.student.minOptionHeight = studentViewportEvidence.minOptionHeight;
    report.student.optionCountMeasured = studentViewportEvidence.optionCountMeasured;

    await Promise.all([
      hostPage.waitForFunction(() => {
        const title = document.getElementById('host-phase-title');
        return !!title && /final/i.test(title.textContent || '');
      }, null, { timeout: FLOW_TIMEOUT_MS }),
      studentPage.waitForFunction(() => {
        const results = document.getElementById('phase-results');
        return !!results && !results.classList.contains('hidden');
      }, null, { timeout: FLOW_TIMEOUT_MS }),
    ]);

    if (report.host.consoleErrors.length > 0 || report.host.pageErrors.length > 0) {
      report.failures.push('host page emitted console/page errors');
    }

    if (report.student.consoleErrors.length > 0 || report.student.pageErrors.length > 0) {
      report.failures.push('student page emitted console/page errors');
    }

    if (!report.host.criticalVisible) {
      report.failures.push('host critical controls/stats are not fully visible at 1366x768');
    }

    if (report.student.hudOverlap) {
      report.failures.push('student HUD overlaps question card at 390x844');
    }

    if (!Number.isFinite(report.student.minOptionHeight) || report.student.minOptionHeight < 44) {
      report.failures.push('student option buttons are below 44px minimum tap target');
    }
  } catch (error) {
    report.failures.push(error && error.message ? error.message : String(error));
  } finally {
    report.serverLogTail = serverProcess.getLogs();

    if (browser) {
      await browser.close();
    }

    try {
      await stopServer(serverProcess);
    } catch (shutdownError) {
      report.failures.push(`shutdown failure: ${shutdownError.message}`);
    }
  }

  const artifactsDir = path.join(REPO_ROOT, 'scripts', 'validation', 'artifacts');
  await fs.mkdir(artifactsDir, { recursive: true });
  const reportPath = path.join(artifactsDir, 'viewport-console-report.json');
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`Viewport/console report written: ${reportPath}`);
  console.log(JSON.stringify({ failures: report.failures, host: report.host, student: report.student }, null, 2));

  if (report.failures.length > 0) {
    process.exitCode = 1;
    return;
  }

  process.exitCode = 0;
}

run().catch((error) => {
  console.error('Viewport/console validation crashed:', error);
  process.exitCode = 1;
});
