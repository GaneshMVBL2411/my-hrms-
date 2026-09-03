#!/usr/bin/env node
/**
 * HRMS browser driver — headless Chrome over the DevTools Protocol.
 *
 * Zero dependencies on purpose. The project has no Playwright, no test runner,
 * and no `chromium-cli` on this host; Node 22+ ships a global WebSocket, and
 * Chrome is already installed on any machine that can develop this app, so CDP
 * over a raw socket needs nothing that isn't already here.
 *
 * Reads newline-separated commands from stdin (or -c "cmd; cmd") and runs them
 * in order against a real page. Every command prints a line, so the transcript
 * is the test result.
 *
 *   node .claude/skills/run-hrms/driver.mjs <<'EOF'
 *   nav /login
 *   login hr@whhoohhpath.com HrAdmin@123
 *   wait-for text=Dashboard
 *   screenshot dashboard
 *   errors
 *   EOF
 */

import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const SHOTS = process.env.HRMS_SHOTS ?? join(HERE, "shots")
const BASE = (process.env.HRMS_BASE_URL ?? "http://localhost:5173").replace(/\/+$/, "")
const HEADED = process.argv.includes("--headed")

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  `${process.env.LOCALAPPDATA ?? ""}/Google/Chrome/Application/chrome.exe`,
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean)

function findChrome() {
  const hit = CHROME_CANDIDATES.find((p) => existsSync(p))
  if (!hit) {
    console.error("No Chrome/Edge found. Set CHROME_PATH to the executable.")
    process.exit(1)
  }
  return hit
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- CDP client

class Cdp {
  #ws
  #id = 0
  #pending = new Map()
  session = null
  /** Console errors and page exceptions, drained by the `errors` command. */
  problems = []

  async connect(url) {
    this.#ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      this.#ws.addEventListener("open", resolve, { once: true })
      this.#ws.addEventListener("error", () => reject(new Error(`WebSocket failed: ${url}`)), {
        once: true,
      })
    })

    this.#ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data)

      if (msg.id && this.#pending.has(msg.id)) {
        const { resolve, reject } = this.#pending.get(msg.id)
        this.#pending.delete(msg.id)
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
        return
      }

      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        this.problems.push(msg.params.args.map((a) => a.value ?? a.description ?? "?").join(" "))
      }
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails
        this.problems.push(d.exception?.description ?? d.text)
      }
    })
  }

  send(method, params = {}, useSession = true) {
    const id = ++this.#id
    const payload = { id, method, params }
    // Flattened sessions: page-scoped commands carry sessionId on the envelope
    // rather than needing a second socket per target.
    if (useSession && this.session) payload.sessionId = this.session
    this.#ws.send(JSON.stringify(payload))
    return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }))
  }

  close() {
    try {
      this.#ws?.close()
    } catch {
      /* already gone */
    }
  }
}

// ------------------------------------------------------------ page utilities

/**
 * Injected before every DOM command. `text=` resolves to the DEEPEST element
 * containing the string — matching the outermost would return <body> for any
 * text on the page, and clicking <body> silently does nothing.
 */
const RESOLVER = `
window.__hrms = window.__hrms || {
  find(sel) {
    if (!sel.startsWith('text=')) return document.querySelector(sel);
    const needle = sel.slice(5).toLowerCase();
    const hits = [...document.querySelectorAll('body *')].filter(
      (el) => (el.textContent || '').toLowerCase().includes(needle) && el.offsetParent !== null
    );
    return hits[hits.length - 1] || null;
  },
  /**
   * React tracks the previous value on the DOM node and swallows an onChange
   * whose value it thinks it already has, so assigning .value directly updates
   * the pixel and not the state. Going through the prototype setter is what
   * makes React see the change.
   */
  fill(el, value) {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  },
};
`

async function evaluate(cdp, expression) {
  const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
    expression: `(() => { ${RESOLVER}; return (${expression}); })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? "eval failed")
  return result.value
}

async function waitFor(cdp, selector, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = await evaluate(cdp, `!!window.__hrms.find(${JSON.stringify(selector)})`)
    if (found) return true
    await sleep(200)
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${selector}`)
}

/**
 * Real mouse events at the element's centre rather than el.click(). shadcn/ui
 * is built on Radix, which opens dialogs and dropdowns from pointerdown — a
 * synthetic .click() never fires that and the menu simply never appears.
 */
async function click(cdp, selector) {
  await waitFor(cdp, selector)
  const box = await evaluate(
    cdp,
    `(() => {
      const el = window.__hrms.find(${JSON.stringify(selector)});
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`
  )
  for (const type of ["mousePressed", "mouseReleased"]) {
    await cdp.send("Input.dispatchMouseEvent", {
      type,
      x: Math.round(box.x),
      y: Math.round(box.y),
      button: "left",
      clickCount: 1,
    })
  }
}

async function screenshot(cdp, name) {
  mkdirSync(SHOTS, { recursive: true })
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" })
  const file = join(SHOTS, `${name}.png`)
  writeFileSync(file, Buffer.from(data, "base64"))
  return file
}

// ------------------------------------------------------------------- command

async function run(cdp, line) {
  const [cmd, ...rest] = line.trim().split(/\s+/)
  const arg = rest.join(" ")

  switch (cmd) {
    case "nav": {
      const url = arg.startsWith("http") ? arg : `${BASE}${arg.startsWith("/") ? arg : `/${arg}`}`
      await cdp.send("Page.navigate", { url })
      // Vite compiles routes on demand, so the first navigation can take
      // seconds. Waiting for #root to have children beats a fixed sleep.
      await waitFor(cdp, "#root > *", 30000)
      return `nav ${url}`
    }

    case "wait-for":
      await waitFor(cdp, arg)
      return `wait-for ${arg} ✓`

    case "click":
      await click(cdp, arg)
      return `click ${arg} ✓`

    case "fill": {
      const sel = rest[0]
      const value = rest.slice(1).join(" ")
      await waitFor(cdp, sel)
      await evaluate(
        cdp,
        `(() => { const el = window.__hrms.find(${JSON.stringify(sel)});
          el.focus(); window.__hrms.fill(el, ${JSON.stringify(value)}); return true; })()`
      )
      return `fill ${sel} ✓`
    }

    case "press":
      for (const type of ["keyDown", "keyUp"]) {
        await cdp.send("Input.dispatchKeyEvent", { type, key: arg, windowsVirtualKeyCode: 13 })
      }
      return `press ${arg} ✓`

    case "text": {
      const value = await evaluate(
        cdp,
        `(window.__hrms.find(${JSON.stringify(arg)})?.innerText ?? '<not found>')`
      )
      return `text ${arg} → ${String(value).slice(0, 400).replace(/\s+/g, " ")}`
    }

    case "url":
      return `url → ${await evaluate(cdp, "location.pathname")}`

    case "screenshot":
      return `screenshot → ${await screenshot(cdp, arg || `shot-${Date.now()}`)}`

    case "eval":
      return `eval → ${JSON.stringify(await evaluate(cdp, arg))}`

    /**
     * App-specific: everything but /login is behind ProtectedRoute, so almost
     * any useful session starts here. Waits for the sidebar rather than the
     * toast, because a failed sign-in also produces a toast.
     */
    case "login": {
      const [email, password] = rest
      await run(cdp, "nav /login")
      await run(cdp, `fill input#email ${email}`)
      await run(cdp, `fill input#password ${password}`)
      await click(cdp, 'button[type="submit"]')
      await waitFor(cdp, "nav a[href='/dashboard']", 25000)
      return `login ${email} ✓`
    }

    case "errors": {
      const found = cdp.problems.splice(0)
      return found.length ? `errors (${found.length}):\n  ${found.join("\n  ")}` : "errors: none"
    }

    case "":
      return null

    default:
      throw new Error(`unknown command: ${cmd}`)
  }
}

// ---------------------------------------------------------------------- main

const script = process.argv.includes("-c")
  ? process.argv[process.argv.indexOf("-c") + 1].split(";")
  : (await new Promise((resolve) => {
      let buf = ""
      process.stdin.setEncoding("utf8")
      process.stdin.on("data", (d) => (buf += d))
      process.stdin.on("end", () => resolve(buf))
    })).split("\n")

const lines = script.map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
if (lines.length === 0) {
  console.error("No commands given. Pipe a script to stdin or pass -c \"nav /login; screenshot x\".")
  process.exit(1)
}

const profile = join(tmpdir(), `hrms-driver-${Date.now()}`)
const port = 9222 + Math.floor(Math.random() * 500)

const chrome = spawn(
  findChrome(),
  [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    ...(HEADED ? [] : ["--headless=new"]),
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--window-size=1440,900",
    "about:blank",
  ],
  { stdio: "ignore" }
)

const cdp = new Cdp()
let failed = false

try {
  // Chrome writes the port file before the HTTP endpoint answers, so poll it.
  let version
  for (let i = 0; i < 100; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
      break
    } catch {
      await sleep(100)
    }
  }
  if (!version) throw new Error(`Chrome never opened a debugging port on ${port}`)

  await cdp.connect(version.webSocketDebuggerUrl)
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" }, false)
  const { sessionId } = await cdp.send(
    "Target.attachToTarget",
    { targetId, flatten: true },
    false
  )
  cdp.session = sessionId

  await cdp.send("Page.enable")
  await cdp.send("Runtime.enable")
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })

  for (const line of lines) {
    const out = await run(cdp, line)
    if (out) console.log(out)
  }
  console.log("\nOK")
} catch (error) {
  console.error(`\nFAILED: ${error.message}`)
  try {
    console.error(`last screen → ${await screenshot(cdp, "failure")}`)
  } catch {
    /* page may be gone */
  }
  failed = true
} finally {
  cdp.close()
  chrome.kill()
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {
    /* Chrome may still hold a lock; the temp dir is disposable */
  }
  process.exit(failed ? 1 : 0)
}
