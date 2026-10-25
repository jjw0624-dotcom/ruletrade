import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const output = `${root}build/browser-acceptance`;
await mkdir(output, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(url, attempts = 80) {
  for (let index = 0; index < attempts; index += 1) {
    try { const response = await fetch(url); if (response.ok) return response; } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const vite = spawn("npm", ["--prefix", `${root}frontend`, "run", "dev", "--", "--host", "127.0.0.1", "--port", "4173"], { stdio: "inherit" });
const chromeBinary = process.env.CHROME_BIN ?? "google-chrome";
const chrome = spawn(chromeBinary, ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--remote-debugging-port=9222", "--user-data-dir=/tmp/ruletrade-browser-acceptance", "about:blank"], { stdio: "inherit" });

let socket;
try {
  await waitFor("http://127.0.0.1:4173/browser-harness.html");
  await waitFor("http://127.0.0.1:9222/json/version");
  const target = await fetch("http://127.0.0.1:9222/json/new?http://127.0.0.1:4173/browser-harness.html", { method: "PUT" }).then((response) => response.json());
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 1;
  const pending = new Map();
  const trace = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) { const { resolve, reject } = pending.get(message.id); pending.delete(message.id); message.error ? reject(new Error(message.error.message)) : resolve(message.result); }
    else trace.push(message);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const clickText = (label) => evaluate(`(() => { const button=[...document.querySelectorAll('button')].find((item)=>item.textContent.trim()===${JSON.stringify(label)}); if(!button) throw new Error('Missing button: '+${JSON.stringify(label)}); button.click(); return true; })()`);
  const clickBlocklyCategory = (label) => evaluate(`(() => { const row=[...document.querySelectorAll('.blocklyTreeRow')].find((item)=>item.textContent.trim()===${JSON.stringify(label)}); if(!row) throw new Error('Missing Blockly category: '+${JSON.stringify(label)}); row.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:row.getBoundingClientRect().x+8,clientY:row.getBoundingClientRect().y+8})); row.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); row.click(); return true; })()`);
  const screenshot = async (name) => { const result = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); await writeFile(`${output}/${name}.png`, Buffer.from(result.data, "base64")); };
  const waitSelector = async (selector) => { for (let i=0;i<60;i+=1) { if (await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return; await sleep(100); } throw new Error(`Missing selector ${selector}`); };
  const drag = async (from, to) => {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", clickCount: 1 });
    for (let step=1;step<=8;step+=1) await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x+(to.x-from.x)*step/8, y: from.y+(to.y-from.y)*step/8, button: "left", buttons: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", clickCount: 1 });
  };

  await send("Page.enable"); await send("Runtime.enable");
  for (const [width, height] of [[1366,768],[1440,900],[1920,1080]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: "http://127.0.0.1:4173/browser-harness.html" });
    await waitSelector('.blocky-representation[data-blocky-contract="entry-style-v2-native"]');
    await clickText("Add"); await waitSelector('.blocklyToolboxDiv'); await sleep(250);
    const geometry = await evaluate(`(() => { const canvas=document.querySelector('.representation-workspace').getBoundingClientRect(); const toolbox=document.querySelector('.blocklyToolboxDiv').getBoundingClientRect(); return {canvas:{x:canvas.x,width:canvas.width},toolbox:{x:toolbox.x,width:toolbox.width},visible:getComputedStyle(document.querySelector('.blocklyToolboxDiv')).display!=='none'}; })()`);
    if (!geometry.visible || Math.abs(geometry.toolbox.x) > 2 || Math.abs(geometry.toolbox.width - 268) > 3) throw new Error(`Unified Add geometry failed at ${width}: ${JSON.stringify(geometry)}`);
    await screenshot(`builder-add-${width}x${height}`);
  }

  await clickBlocklyCategory("Start"); await sleep(250);
  const hoverBefore = await evaluate(`(() => { const flyout=document.querySelector('.blocklyFlyout').getBoundingClientRect(); const canvas=document.querySelector('.blocklyMainBackground').getBoundingClientRect(); return {flyout:{x:flyout.x,y:flyout.y,width:flyout.width,height:flyout.height},canvas:{x:canvas.x,width:canvas.width}}; })()`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hoverBefore.flyout.x + Math.min(80, hoverBefore.flyout.width / 2), y: hoverBefore.flyout.y + 120 });
  await sleep(250);
  const hoverAfter = await evaluate(`(() => { const flyout=document.querySelector('.blocklyFlyout').getBoundingClientRect(); const canvas=document.querySelector('.blocklyMainBackground').getBoundingClientRect(); return {flyoutWidth:flyout.width,canvas:{x:canvas.x,width:canvas.width}}; })()`);
  if (hoverAfter.flyoutWidth <= hoverBefore.flyout.width || Math.abs(hoverAfter.canvas.x-hoverBefore.canvas.x)>1 || Math.abs(hoverAfter.canvas.width-hoverBefore.canvas.width)>1) throw new Error(`Add hover expansion changed canvas geometry: ${JSON.stringify({hoverBefore,hoverAfter})}`);
  const points = await evaluate(`(() => { const source=document.querySelector('.blocklyFlyout .blocklyDraggable').getBoundingClientRect(); const target=document.querySelector('.blocklyMainBackground').getBoundingClientRect(); return {from:{x:source.x+source.width/2,y:source.y+source.height/2},to:{x:target.x+Math.min(420,target.width*.45),y:target.y+240},before:document.querySelectorAll('.blocklyBlockCanvas>.blocklyDraggable').length}; })()`);
  await drag(points.from, points.to); await sleep(350);
  const after = await evaluate(`document.querySelectorAll('.blocklyBlockCanvas>.blocklyDraggable').length`);
  if (after <= points.before) throw new Error(`Native flyout drag did not create a block (${points.before} -> ${after}).`);
  await screenshot("builder-native-drag.png");

  await clickText("Objects"); await clickText("Create Group"); await waitSelector('[data-object-definition-workspace="group"]'); await sleep(250);
  const workspaceState = await evaluate(`(() => ({toolbox:getComputedStyle(document.querySelector('.blocklyToolboxDiv')).visibility, workspace:document.querySelector('[data-object-definition-workspace="group"]').getBoundingClientRect(), basket:Boolean(document.querySelector('[aria-label="Selection basket"]'))}))()`);
  if (workspaceState.toolbox !== "hidden" || !workspaceState.basket || workspaceState.workspace.x > 2) throw new Error(`Group Workspace isolation failed: ${JSON.stringify(workspaceState)}`);
  await screenshot("group-asset-workspace.png");
  await clickText("Cancel");
  if (await evaluate(`Boolean(document.querySelector('[data-object-definition-workspace="group"]'))`)) throw new Error("Group cancellation did not restore Builder context.");
  await writeFile(`${output}/browser-trace.json`, JSON.stringify(trace, null, 2));
  console.log(`Browser acceptance passed; artifacts: ${output}`);
} finally {
  socket?.close(); vite.kill("SIGTERM"); chrome.kill("SIGTERM");
}
