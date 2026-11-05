import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const local = path.join(root, ".local");
mkdirSync(local, { recursive: true });
const invalidFile = path.join(local, "ux-unsupported.txt");
writeFileSync(invalidFile, "not a PDF, Word, or Excel file");
const chromeExecutable = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
].find(existsSync);
if (!chromeExecutable) throw new Error("Chrome or Edge is unavailable");
const profile = path.join(local, "arabic-ui-qa-profile");
const chrome = spawn(chromeExecutable, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--remote-debugging-port=9226", "--remote-allow-origins=*",
  "--user-data-dir=" + profile, "about:blank"
], { stdio: "ignore" });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(condition, timeout = 20000) {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) {
    try { const result = await condition(); if (result) return result; } catch (err) { last = err; }
    await sleep(240);
  }
  throw new Error("Timeout waiting for test condition" + (last ? ": " + last.message : ""));
}

let socket = null, checks = 0;
const pass = message => { checks++; console.log("PASS " + message); };
try {
  const targets = await waitFor(async () => {
    const response = await fetch("http://127.0.0.1:9226/json/list");
    return response.ok ? response.json() : null;
  });
  const target = targets.find(t => t.type === "page");
  if (!target) throw new Error("No browser page was found");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let current = 0;
  const pending = new Map();
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const handler = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) handler.reject(new Error(JSON.stringify(message.error)));
    else handler.resolve(message.result);
  });

  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++current;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error("CDP timeout: " + method));
    }, 14000);
  });
  const evaluate = async expression => {
    const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const screenshot = async name => {
    const value = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(path.join(local, name), Buffer.from(value.data, "base64"));
  };

  await command("Page.enable");
  await command("Runtime.enable");
  await command("DOM.enable");
  await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await command("Page.navigate", { url: "http://localhost:3000/" });
  await waitFor(() => evaluate("document.querySelectorAll('article.card').length >= 2"));

  if (!await evaluate('document.title.includes("وثيقة") && document.querySelector(".brand-type strong")?.textContent.trim() === "وثيقة"'))
    throw new Error("Wathiqa brand name missing from browser title or sidebar logo");
  pass("Wathiqa brand identity in browser title and sidebar");

  if (!await evaluate('([...document.querySelectorAll("link[rel=icon]")].some(x => x.getAttribute("href")?.includes("icon.svg")))'))
    throw new Error("Wathiqa custom icon not present");
  pass("Wathiqa custom favicon replaces Next.js default");

  if (!await evaluate("document.documentElement.lang === 'ar' && document.documentElement.dir === 'rtl'"))
    throw new Error("RTL Arabic document metadata is missing");
  pass("Arabic lang and RTL document direction");

  if (!await evaluate('(()=>{const el=document.querySelector(".sidebar"),r=el.getBoundingClientRect();return getComputedStyle(el).position==="fixed"&&r.top===0&&Math.abs(r.right-document.documentElement.clientWidth)<3})()'))
    throw new Error("Sidebar is not fixed to right viewport edge");
  pass("Sidebar fixed on the right edge");

  if (!await evaluate('document.body.innerText.includes("القوالب") && document.body.innerText.includes("مستنداتي") && document.body.innerText.includes("المستندات المحفوظة") && document.body.innerText.includes("استخدام القالب")'))
    throw new Error("Arabic interface labels are incomplete");
  pass("Arabic navigation, cards and actions");

  await waitFor(() => evaluate('document.documentElement.classList.contains("lenis")'), 10000);
  pass("Official Lenis root integration initialized");

  if (!await evaluate('(()=>[...document.querySelectorAll("article.card")].every(c=>{const x=c.getBoundingClientRect();return [...c.querySelectorAll(".card-footer button")].every(b=>{const y=b.getBoundingClientRect();return y.left>=x.left-2&&y.right<=x.right+2})}))()'))
    throw new Error("Card footer buttons overflow their cards");
  pass("Card action buttons stay inside cards");

  await evaluate('(()=>{const e=document.createElement("div");e.id="qa-page-scroll";e.style.height="1700px";document.querySelector(".content").append(e);window.scrollTo({top:1000,behavior:"instant"});return true})()');
  await waitFor(() => evaluate("window.scrollY > 350"), 8000);
  if (!await evaluate('(()=>{const r=document.querySelector(".sidebar").getBoundingClientRect();return Math.abs(r.top)<1&&Math.abs(r.right-document.documentElement.clientWidth)<3})()'))
    throw new Error("Sidebar moved away from viewport during scroll");
  pass("Sidebar stays fixed after long-page scrolling");

  await evaluate("document.querySelector('a.nav[href=\"/#documents\"]').click()");
  await waitFor(() => evaluate("location.hash === '#documents'"), 8000);
  await sleep(1700);
  const anchorTop = await evaluate("Math.round(document.querySelector('#documents').getBoundingClientRect().top)");
  if (anchorTop < 122 || anchorTop > 700)
    throw new Error("Smooth-scroll anchor is not visible below the sticky header (top=" + anchorTop + ")");
  pass("Lenis anchor navigation keeps section visible below sticky header");

  await evaluate('window.scrollTo({top:0,behavior:"instant"})');
  await waitFor(() => evaluate("window.scrollY < 40"), 8000);
  await screenshot("wathiqa-rtl-desktop.png");

  const dom = await command("DOM.getDocument", { depth: 4 });
  const picker = await command("DOM.querySelector", { nodeId: dom.root.nodeId, selector: 'input[type="file"]' });
  if (!picker.nodeId) throw new Error("Import picker not found");
  await command("DOM.setFileInputFiles", { nodeId: picker.nodeId, files: [invalidFile] });
  await waitFor(() => evaluate('document.querySelector(\'[role="alert"].toast-item\')?.innerText.includes("تعذّر استيراد الملف")'), 10000);
  pass("Invalid import displays understandable Arabic error toast");

  if (!await evaluate('getComputedStyle(document.querySelector(".toast-item.error")).animationName.includes("toastIn")'))
    throw new Error("Error toast lacks entrance animation");
  pass("Toast entrance animation is applied");
  await evaluate("document.querySelector('.toast-item.error button.toast-close').click()");
  await waitFor(() => evaluate("!document.querySelector('.toast-item.error')"), 6000);
  pass("Toast dismisses with animated exit");

  await evaluate("document.querySelector('button.card-delete')?.click()");
  await waitFor(() => evaluate("!!document.querySelector('[role=alertdialog]')"), 5000);
  if (!await evaluate("document.querySelector('[role=alertdialog]')?.innerText.includes('حذف هذا القالب؟')"))
    throw new Error("Deletion dialog was not translated");
  await evaluate("document.querySelector('[role=alertdialog] .dialog-actions button')?.click()");
  await waitFor(() => evaluate("!document.querySelector('[role=alertdialog]')"), 5000);
  pass("Arabic deletion confirmation dialog can be cancelled");

  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(600);
  if (!await evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2"))
    throw new Error("Mobile layout causes horizontal overflow");
  pass("Mobile layout has no horizontal overflow");

  if (!await evaluate("getComputedStyle(document.querySelector('.mobile-menu')).display !== 'none'"))
    throw new Error("Mobile menu button is missing");
  await evaluate("document.querySelector('.mobile-menu').click()");
  await waitFor(() => evaluate("document.querySelector('.sidebar').classList.contains('mobile-open')"), 5000);
  await waitFor(() => evaluate('(()=>{const r=document.querySelector(".sidebar").getBoundingClientRect();return r.width>250&&Math.abs(r.right-document.documentElement.clientWidth)<3})()'), 5000);
  pass("Mobile sidebar drawer opens from the right");
  await screenshot("wathiqa-rtl-mobile.png");
  await evaluate("document.querySelector('.sidebar-close').click()");
  await waitFor(() => evaluate("!document.querySelector('.sidebar').classList.contains('mobile-open')"), 5000);
  pass("Mobile sidebar closes correctly");

  console.log("ARABIC UX PASS COUNT: " + checks);
  console.log("SCREENSHOTS: .local/wathiqa-rtl-desktop.png, .local/wathiqa-rtl-mobile.png");
} finally {
  try { socket?.close(); } catch {}
  try { chrome.kill(); } catch {}
}
