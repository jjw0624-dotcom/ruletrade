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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const clickText = async (label) => {
    const point = await evaluate(`(() => { const button=[...document.querySelectorAll('button')].reverse().find((item)=>{ if(item.textContent.trim()!==${JSON.stringify(label)}) return false; const rect=item.getBoundingClientRect(); if(!rect.width||!rect.height) return false; const top=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2); return top===item||item.contains(top); }); if(!button) throw new Error('Missing visible button: '+${JSON.stringify(label)}); const rect=button.getBoundingClientRect(); return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}; })()`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  };
  const clickTextContaining = async (label) => {
    const point = await evaluate(`(() => { const button=[...document.querySelectorAll('button')].reverse().find((item)=>{ if(!item.textContent.includes(${JSON.stringify(label)})||item.disabled) return false; const rect=item.getBoundingClientRect(); return Boolean(rect.width&&rect.height); }); if(!button) throw new Error('Missing enabled visible button containing: '+${JSON.stringify(label)}); const rect=button.getBoundingClientRect(); return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}; })()`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  };
  const clickQuickTest = async () => evaluate(`(() => { const button=[...document.querySelectorAll('.builder-actions button.primary-button')].reverse().find((item)=>{ const rect=item.getBoundingClientRect(); return item.textContent.trim().startsWith('Test')&&!item.textContent.trim().startsWith('Tests')&&!item.disabled&&rect.width&&rect.height; }); if(!button) throw new Error('Missing enabled Quick Test button'); button.click(); return true; })()`);
  const clickAriaLabel = async (label) => {
    const point = await evaluate(`(() => { const item=document.querySelector('[aria-label='+CSS.escape(${JSON.stringify(label)})+']'); if(!item) throw new Error('Missing aria-label: '+${JSON.stringify(label)}); const rect=item.getBoundingClientRect(); if(!rect.width||!rect.height) throw new Error('Hidden aria-label: '+${JSON.stringify(label)}); return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}; })()`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  };
  const setControlValue = async (label, value) => evaluate(`(() => { const item=document.querySelector('[aria-label='+CSS.escape(${JSON.stringify(label)})+']'); if(!item) throw new Error('Missing control: '+${JSON.stringify(label)}); const prototype=item instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype; const setter=Object.getOwnPropertyDescriptor(prototype,'value').set; setter.call(item,${JSON.stringify(value)}); item.dispatchEvent(new Event('input',{bubbles:true})); item.dispatchEvent(new Event('change',{bubbles:true})); return item.value; })()`);
  const scrollButtonIntoView = async (label) => evaluate(`(() => { const item=[...document.querySelectorAll('button')].reverse().find((button)=>button.textContent.trim()===${JSON.stringify(label)}&&!button.disabled); if(!item) throw new Error('Missing enabled button: '+${JSON.stringify(label)}); item.scrollIntoView({block:'center',inline:'center'}); return true; })()`);
  const clickBlocklyCategory = async (label) => {
    const point = await evaluate(`(() => { const row=[...document.querySelectorAll('.blocklyToolboxCategory')].find((item)=>item.textContent.trim()===${JSON.stringify(label)}); if(!row) throw new Error('Missing Blockly category: '+${JSON.stringify(label)}); const rect=row.getBoundingClientRect(); return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}; })()`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  };
  const screenshot = async (name) => { const result = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); await writeFile(`${output}/${name}.png`, Buffer.from(result.data, "base64")); };
  const waitSelector = async (selector) => { for (let i=0;i<60;i+=1) { if (await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return; await sleep(100); } const diagnostic = await evaluate(`({body:document.body.innerText.slice(0,1200),blockly:[...document.querySelectorAll('[class*=blockly]')].map((item)=>item.className?.baseVal ?? item.className).slice(0,40)})`); throw new Error(`Missing selector ${selector}: ${JSON.stringify(diagnostic)}`); };
  const waitExpression = async (expression, label) => { for (let i=0;i<60;i+=1) { if (await evaluate(expression)) return; await sleep(100); } throw new Error(`Timed out waiting for ${label}`); };
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
    await clickText("Add"); await waitSelector('.blocky-representation[data-native-add-open="true"]'); await waitSelector('[data-ruletrade-native-toolbox="true"]'); await sleep(250);
    const geometry = await evaluate(`(() => { const canvas=document.querySelector('.representation-workspace').getBoundingClientRect(); const toolboxElement=document.querySelector('[data-ruletrade-native-toolbox="true"]'); const toolbox=toolboxElement.getBoundingClientRect(); const style=getComputedStyle(toolboxElement); const firstCategory=document.querySelector('.blocklyToolboxCategory')?.getBoundingClientRect(); const tabs=document.querySelector('.workspace-panel-tabs')?.getBoundingClientRect(); return {canvas:{x:canvas.x,width:canvas.width},toolbox:{x:toolbox.x,width:toolbox.width},tabs:tabs?{bottom:tabs.bottom}:null,firstCategory:firstCategory?{y:firstCategory.y,width:firstCategory.width,height:firstCategory.height}:null,visible:style.display!=='none'&&style.visibility!=='hidden'}; })()`);
    if (!geometry.visible || !geometry.firstCategory?.height || !geometry.firstCategory?.width || geometry.firstCategory.y < (geometry.tabs?.bottom ?? 0) || Math.abs(geometry.toolbox.x) > 2 || Math.abs(geometry.toolbox.width - 88) > 3) throw new Error(`Unified Add geometry failed at ${width}: ${JSON.stringify(geometry)}`);
    console.log(`Unified Add geometry passed at ${width}: ${JSON.stringify(geometry)}`);
    await screenshot(`builder-add-${width}x${height}`);
  }

  await clickText("Guide"); await waitSelector('[aria-label="Guided strategy editor"]');
  await clickText("One investment"); await waitSelector('[data-intent-recipe="single_asset"]');
  const guideDraft = await evaluate(`({guide:Boolean(document.querySelector('[aria-label="Guided strategy editor"]')),concept:window.__RULETRADE_BROWSER_DRAFT__?.perspectiveDrafts?.guided,blockCount:Object.keys(window.__RULETRADE_BROWSER_DRAFT__?.canvasBlocks??{}).length})`);
  if (!guideDraft.guide || guideDraft.concept?.startPath !== "asset_first" || guideDraft.concept?.recipe !== "single_asset" || guideDraft.blockCount !== 0) throw new Error(`Independent Guide draft failed: ${JSON.stringify(guideDraft)}`);
  await screenshot("builder-independent-guide");
  await clickText("Discard draft");

  await clickText("Flow"); await waitSelector('[aria-label="Flow capital projection"]');
  const flowSurface = await evaluate(`(() => { const surface=document.querySelector('[aria-label="Flow capital projection"]'); return { text:surface?.innerText??'', duplicateActions:[...surface.querySelectorAll('button')].filter((item)=>item.textContent.includes('Create Investment')||item.textContent.includes('Create Split')).length }; })()`);
  if (flowSurface.duplicateActions || flowSurface.text.includes("Flow drafts stay independent") || flowSurface.text.includes("complete typed intent passes validation")) throw new Error(`Flow exposed duplicate authoring controls or architecture prose: ${JSON.stringify(flowSurface)}`);
  await clickText("Rules"); await waitSelector('[aria-label="Rules authoring"]');
  await clickText("Add investment rule"); await waitSelector('[aria-label="Rules intent editor"] [data-intent-recipe="single_asset"]');
  const rulesDraft = await evaluate(`({concept:window.__RULETRADE_BROWSER_DRAFT__?.perspectiveDrafts?.rules,blockCount:Object.keys(window.__RULETRADE_BROWSER_DRAFT__?.canvasBlocks??{}).length})`);
  if (rulesDraft.concept?.startPath !== "rules_first" || rulesDraft.concept?.recipe !== "single_asset" || rulesDraft.blockCount !== 0) throw new Error(`Independent Rules draft failed: ${JSON.stringify(rulesDraft)}`);
  await screenshot("builder-independent-flow-rules");
  await clickText("Discard draft");
  await clickText("Blocky"); await clickText("Add"); await waitSelector('.blocky-representation[data-native-add-open="true"]');
  await clickText("Flow"); await waitSelector('[aria-label="Flow capital projection"]');
  if (!await evaluate(`window.__RULETRADE_BROWSER_DRAFT__?.blockyAddOpen===true`)) throw new Error("Blocky Add state was discarded by a perspective switch.");
  await clickText("Blocky"); await waitSelector('.blocky-representation[data-native-add-open="true"]');
  const manualGraphChrome = await evaluate(`({ commit:document.body.innerText.includes('Commit active graph'), root:document.body.innerText.includes('Active graph root') })`);
  if (manualGraphChrome.commit || manualGraphChrome.root) throw new Error(`Manual Active Graph transaction leaked into product chrome: ${JSON.stringify(manualGraphChrome)}`);

  await clickBlocklyCategory("Start"); await sleep(250);
  const initialStartState = await evaluate(`(() => ({projected:[...document.querySelectorAll('.blocklyBlockCanvas>.blocklyDraggable')].filter((block)=>block.textContent.includes('Daily close')).length,draftStarts:Object.values(window.__RULETRADE_BROWSER_DRAFT__?.canvasBlocks??{}).filter((block)=>block.definitionId==='start-daily').length}))()`);
  if (initialStartState.projected || initialStartState.draftStarts) throw new Error(`Bootstrap clock leaked into Blocky as an executable Start: ${JSON.stringify(initialStartState)}`);
  // Assets contains the widest financial previews. It is the regression case
  // that previously let native flyout measurement consume most of the canvas.
  await clickBlocklyCategory("Assets"); await sleep(250);
  console.log("Blockly category state:", JSON.stringify(await evaluate(`(() => ({addOpen:document.querySelector('.blocky-representation')?.dataset.nativeAddOpen,categories:[...document.querySelectorAll('.blocklyToolboxCategory')].slice(0,2).map((item)=>({text:item.textContent.trim(),selected:item.getAttribute('aria-selected'),className:item.className})),flyouts:[...document.querySelectorAll('[class*=Flyout],[class*=flyout]')].map((item)=>{const rect=item.getBoundingClientRect();return {className:item.className?.baseVal??item.className,width:rect.width,height:rect.height,display:getComputedStyle(item).display,visibility:getComputedStyle(item).visibility}})}))()`)));
  const hoverBefore = await evaluate(`(() => { const flyoutElement=document.querySelector('.blocklyFlyout'); const flyout=flyoutElement.getBoundingClientRect(); const canvas=document.querySelector('.blocklyMainBackground').getBoundingClientRect(); const workbench=document.querySelector('.builder-workbench').getBoundingClientRect(); const left=document.querySelector('.workspace-left-root').getBoundingClientRect(); const blockCanvas=document.querySelector('.blocklyBlockCanvas'); return {left:{x:left.x,right:left.right,width:left.width},flyout:{x:flyout.x,y:flyout.y,width:flyout.width,height:flyout.height,clip:getComputedStyle(flyoutElement).clipPath},canvas:{x:canvas.x,y:canvas.y,width:canvas.width,height:canvas.height},workbench:{x:workbench.x,y:workbench.y,width:workbench.width,height:workbench.height},blockTransform:blockCanvas.getAttribute('transform')}; })()`);
  if (!hoverBefore.flyout.clip.includes("180px")) throw new Error(`Add preview was not clipped to the fixed left workspace before hover: ${JSON.stringify(hoverBefore)}`);
  if (Math.abs(hoverBefore.flyout.width - 180) > 2) throw new Error(`The native flyout did not retain its fixed 180px geometry before hover: ${JSON.stringify(hoverBefore)}`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hoverBefore.canvas.x + hoverBefore.canvas.width - 80, y: hoverBefore.canvas.y + 220 });
  await sleep(80);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hoverBefore.flyout.x + Math.min(80, hoverBefore.flyout.width / 2), y: hoverBefore.flyout.y + 120 });
  await sleep(250);
  const hoverAfter = await evaluate(`(() => { const flyoutElement=document.querySelector('.blocklyFlyout'); const flyout=flyoutElement.getBoundingClientRect(); const canvas=document.querySelector('.blocklyMainBackground').getBoundingClientRect(); const blockCanvas=document.querySelector('.blocklyBlockCanvas'); const previewRight=Math.max(flyout.right,...[...document.querySelectorAll('.blocklyFlyout .blocklyDraggable')].map((item)=>item.getBoundingClientRect().right)); const visibleRight=Math.min(previewRight,canvas.right); const maxVisible=Math.min(380,innerWidth*.42); const scrollbar=[...document.querySelectorAll('.blocklyFlyoutScrollbar')].map((item)=>{const rect=item.getBoundingClientRect();return{x:rect.x,y:rect.y,width:rect.width,height:rect.height,visible:getComputedStyle(item).visibility!=='hidden'}}); return {flyoutWidth:flyout.width,previewRight,visibleWidth:Math.max(0,visibleRight-flyout.x),maxVisible,clip:getComputedStyle(flyoutElement).clipPath,canvas:{x:canvas.x,y:canvas.y,width:canvas.width,height:canvas.height},blockTransform:blockCanvas.getAttribute('transform'),scrollbar}; })()`);
  if (hoverAfter.clip === hoverBefore.flyout.clip || hoverAfter.visibleWidth <= 180 || hoverAfter.blockTransform !== hoverBefore.blockTransform || Math.abs(hoverAfter.flyoutWidth-180)>2 || Math.abs(hoverAfter.canvas.x-hoverBefore.canvas.x)>1 || Math.abs(hoverAfter.canvas.y-hoverBefore.canvas.y)>1 || Math.abs(hoverAfter.canvas.width-hoverBefore.canvas.width)>1 || Math.abs(hoverAfter.canvas.height-hoverBefore.canvas.height)>1 || hoverAfter.scrollbar.some((item)=>item.visible&&item.x>hoverBefore.flyout.x+382)) throw new Error(`Add hover expansion changed or obscured the Blockly viewport: ${JSON.stringify({hoverBefore,hoverAfter})}`);
  await screenshot("builder-add-expanded");
  // Return to Start before exercising native drag persistence. The preceding
  // geometry regression intentionally uses Assets because it is the widest category.
  await clickBlocklyCategory("Start"); await sleep(250);
  const points = await evaluate(`(() => { const tabsBottom=document.querySelector('.workspace-panel-tabs').getBoundingClientRect().bottom; const sourceElement=[...document.querySelectorAll('.blocklyFlyout .blocklyDraggable')].find((item)=>{const rect=item.getBoundingClientRect();const hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);return rect.top>tabsBottom+2&&(hit===item||item.contains(hit));}); if(!sourceElement) throw new Error('Missing hit-testable native flyout block below tabs'); const source=sourceElement.getBoundingClientRect(); const target=document.querySelector('.blocklyMainBackground').getBoundingClientRect(); return {from:{x:source.x+source.width/2,y:source.y+source.height/2},to:{x:target.x+Math.min(420,target.width*.45),y:target.y+240},before:document.querySelectorAll('.blocklyBlockCanvas>.blocklyDraggable').length}; })()`);
  await drag(points.from, points.to); await sleep(350);
  const dragResult = await evaluate(`(() => ({after:document.querySelectorAll('.blocklyBlockCanvas>.blocklyDraggable').length,addOpen:document.querySelector('.blocky-representation')?.dataset.nativeAddOpen,flyoutVisible:getComputedStyle(document.querySelector('.blocklyFlyout')).visibility,flyoutText:document.querySelector('.blocklyFlyout')?.textContent,canvas:(()=>{const rect=document.querySelector('.blocklyMainBackground').getBoundingClientRect();return{x:rect.x,width:rect.width}})()}))()`);
  if (dragResult.after <= points.before || dragResult.addOpen !== "true" || dragResult.flyoutVisible !== "visible" || !dragResult.flyoutText?.replace(/\s+/g, " ").includes("Every daily close")) throw new Error(`Native flyout drag did not preserve Add (${points.before} -> ${JSON.stringify(dragResult)}).`);
  await drag(points.from, { x: points.to.x + 180, y: points.to.y + 80 }); await sleep(350);
  const duplicateStart = await evaluate(`(() => ({count:Object.values(window.__RULETRADE_BROWSER_DRAFT__?.canvasBlocks??{}).filter((block)=>block.definitionId==='start-daily').length,warnings:[...document.querySelectorAll('.blocklyWarningText')].map((item)=>item.textContent).filter(Boolean)}))()`);
  if (duplicateStart.count !== 1) throw new Error(`Duplicate daily Start was not rejected at creation time: ${JSON.stringify(duplicateStart)}`);
  await clickText("Objects"); await sleep(100); await clickText("Add"); await sleep(150);
  const reopenedAdd = await evaluate(`(() => { const canvas=document.querySelector('.blocklyMainBackground').getBoundingClientRect(); const flyout=document.querySelector('.blocklyFlyout'); return {addOpen:document.querySelector('.blocky-representation')?.dataset.nativeAddOpen,flyout:getComputedStyle(flyout).visibility,flyoutText:flyout?.textContent,canvas:{x:canvas.x,width:canvas.width}}; })()`);
  if (reopenedAdd.addOpen !== "true" || reopenedAdd.flyout !== "visible" || !reopenedAdd.flyoutText?.replace(/\s+/g, " ").includes("Every daily close") || Math.abs(reopenedAdd.canvas.x-dragResult.canvas.x)>1 || Math.abs(reopenedAdd.canvas.width-dragResult.canvas.width)>1) throw new Error(`Add tab did not restore native flyout without moving the canvas: ${JSON.stringify(reopenedAdd)}`);
  await screenshot("builder-native-drag.png");

  await clickText("Objects"); await clickText("Create Group"); await waitSelector('[data-object-definition-workspace="group"]'); await sleep(250);
  const workspaceState = await evaluate(`(() => { const workspace=document.querySelector('[data-object-definition-workspace="group"]'); const workbench=document.querySelector('.builder-workbench'); const core=document.querySelector('.program-builder-core'); const left=document.querySelector('.workspace-left-root'); const leftRect=left.getBoundingClientRect(); const hit=document.elementFromPoint(leftRect.x+Math.min(30,leftRect.width/2),leftRect.y+Math.min(80,leftRect.height/2)); return {workspace:workspace.getBoundingClientRect(),workbench:workbench.getBoundingClientRect(),workspaceParent:workspace.parentElement===workbench,coreHidden:core.getAttribute('aria-hidden'),coreInert:core.hasAttribute('inert'),leftHit:Boolean(hit&&(hit===left||left.contains(hit))),basket:Boolean(document.querySelector('[aria-label="Selection basket"]'))}; })()`);
  if (!workspaceState.basket || !workspaceState.workspaceParent || workspaceState.coreHidden !== "true" || !workspaceState.coreInert || workspaceState.leftHit || Math.abs(workspaceState.workspace.x-workspaceState.workbench.x)>2 || Math.abs(workspaceState.workspace.width-workspaceState.workbench.width)>2) throw new Error(`Group Workspace isolation failed: ${JSON.stringify(workspaceState)}`);
  await screenshot("group-asset-workspace.png");
  await evaluate(`(() => { const details=document.querySelector('input[aria-label="Manual asset symbol"]').closest('details'); details.open=true; const input=details.querySelector('input'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(input,'QQQ'); input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await clickText("Add symbol");
  await waitExpression(`[...document.querySelectorAll('button')].some((button)=>button.textContent.trim()==='Use selected assets'&&!button.disabled)`, "selected asset basket readiness");
  await clickText("Use selected assets"); await sleep(200);
  await clickText("Create Group");
  await waitExpression(`document.querySelectorAll('.object-library-insert').length===1`, "committed Group object row");
  const definitionOnly = await evaluate(`({groupBlocks:Object.values(window.__RULETRADE_BROWSER_DRAFT__?.canvasBlocks??{}).filter((block)=>block.definitionId==='group-reference'||block.definitionId==='create-group').length, inspector:Boolean(document.querySelector('[aria-label="Semantic Inspector"]')), references:[...document.querySelectorAll('.object-library-insert')].length})`);
  if (definitionOnly.groupBlocks || definitionOnly.inspector || definitionOnly.references !== 1) throw new Error(`Group definition/reference separation failed: ${JSON.stringify(definitionOnly)}`);
  await clickText("Add"); await clickBlocklyCategory("Action"); await sleep(250);
  const investPoints = await evaluate(`(() => { const blocks=[...document.querySelectorAll('.blocklyFlyout .blocklyDraggable')]; const source=blocks.find((block)=>block.textContent.includes('Buy'))?.getBoundingClientRect(); const target=document.querySelector('.blocklyMainBackground').getBoundingClientRect(); if(!source) throw new Error('Missing Invest flyout block'); return {from:{x:source.x+source.width/2,y:source.y+source.height/2},to:{x:target.x+420,y:target.y+360}}; })()`);
  await drag(investPoints.from, investPoints.to); await sleep(300);
  await clickText("Group 1"); await sleep(300);
  const connectedReference = await evaluate(`(() => { const snapshot=window.__RULETRADE_BROWSER_DRAFT__; const refs=Object.values(snapshot?.canvasBlocks??{}).filter((block)=>block.definitionId==='group-reference'); const ref=refs[0]; return {count:refs.length,objectRef:ref?.objectRef,connection:ref?snapshot.blockConnections[ref.id]:null}; })()`);
  if (connectedReference.count !== 1 || connectedReference.objectRef !== "group-1" || connectedReference.connection?.inputName !== "TARGET") throw new Error(`Connected stable Group reference failed: ${JSON.stringify(connectedReference)}`);
  await screenshot("builder-connected-reference");

  for (const [label, selector, expected] of [
    ["Summary", '[data-projection-contract="summary"]', "Next inputs"],
    ["Guide", '[aria-label="Guided strategy editor"]', "How this strategy works"],
    ["Rules", '[data-projection-contract="rules"]', "Rules"],
    ["Code", '.code-representation[aria-label="Code representation"]', "canonical_strategy"],
  ]) {
    await clickText(label); await waitSelector(selector); await sleep(150);
    const state = await evaluate(`(() => { const surface=document.querySelector(${JSON.stringify(selector)}); const heading=surface.querySelector('h1,h2'); const tabs=document.querySelector('.workspace-panel-tabs'); const body=surface.innerText; return {body,headingTop:heading?.getBoundingClientRect().top,tabsBottom:tabs?.getBoundingClientRect().bottom}; })()`);
    if (!state.body.includes(expected) || state.body.includes("production Program lowering") || (state.headingTop ?? 0) < (state.tabsBottom ?? 0)) throw new Error(`${label} perspective failed: ${JSON.stringify(state)}`);
    await screenshot(`builder-${label.toLowerCase()}-perspective`);
  }

  await send("Page.navigate", { url: "http://127.0.0.1:4173/browser-harness.html?journey=blocky-group-handoff" });
  await waitSelector('[data-projection-contract="blocky"]');
  await sleep(300);
  const blockyGroupState = await evaluate(`(() => { const projection=document.querySelector('[data-projection-contract="blocky"]'); const test=[...document.querySelectorAll('button')].find((item)=>item.textContent.trim().startsWith('Test')); const draft=window.__RULETRADE_BROWSER_DRAFT__; return {candidate:projection?.getAttribute('data-execution-candidate'),testDisabled:test?.disabled,testTitle:test?.title,connections:draft?.blockConnections,blocks:draft?.canvasBlocks}; })()`);
  if (blockyGroupState.candidate !== "ready" || blockyGroupState.testDisabled) throw new Error(`Blocky Group graph was not test-ready: ${JSON.stringify(blockyGroupState)}`);
  const blockyGroupBefore = await evaluate(`(() => { const draft=window.__RULETRADE_BROWSER_DRAFT__; return {blocks:Object.keys(draft?.canvasBlocks??{}).sort(),connections:draft?.blockConnections,positions:draft?.blockPositions}; })()`);
  await clickQuickTest();
  await waitExpression(`window.__RULETRADE_BLOCKY_GROUP_HANDOFF__?.operation?.kind==='set_program_investment'`, "typed Blocky Group investment handoff");
  const blockyGroupHandoff = await evaluate(`({operation:window.__RULETRADE_BLOCKY_GROUP_HANDOFF__?.operation,canonical:window.__RULETRADE_BROWSER_CANONICAL__,draft:window.__RULETRADE_BROWSER_DRAFT__})`);
  if (blockyGroupHandoff.operation?.target_kind !== "group" || blockyGroupHandoff.operation?.target_ref !== "group-1" || blockyGroupHandoff.operation?.clock_id !== "daily-close") throw new Error(`Blocky Group handoff changed typed investment meaning: ${JSON.stringify(blockyGroupHandoff.operation)}`);
  const blockyGroupAfter = { blocks: Object.keys(blockyGroupHandoff.draft?.canvasBlocks ?? {}).sort(), connections: blockyGroupHandoff.draft?.blockConnections, positions: blockyGroupHandoff.draft?.blockPositions };
  if (JSON.stringify(blockyGroupBefore) !== JSON.stringify(blockyGroupAfter)) throw new Error(`Testing mutated Blocky canvas state: ${JSON.stringify({blockyGroupBefore,blockyGroupAfter})}`);
  await sleep(100);
  const blockyRoundTrip = await evaluate(`(() => { const canvas=[...document.querySelectorAll('.blocklyBlockCanvas')].find((item)=>item.getAttribute('transform')?.includes('scale')); const text=canvas?.textContent?.replace(/\\s+/g,' ')??''; return {text,blocks:canvas?.querySelectorAll('.blocklyDraggable').length??0,transforms:[...document.querySelectorAll('.blocklyBlockCanvas')].map((item)=>item.getAttribute('transform'))}; })()`);
  if (blockyRoundTrip.text.includes("Investment · Group 1") || blockyRoundTrip.blocks !== blockyGroupBefore.blocks.length) throw new Error(`Canonical projection replaced or duplicated the native Blocky grammar: ${JSON.stringify(blockyRoundTrip)}`);
  await clickText("Guide"); await waitSelector('[aria-label="Guided strategy editor"] [data-semantic-address="blocky-investment-draft-start"]');
  await evaluate(`document.querySelector('[data-semantic-address="blocky-investment-draft-start"]').click()`);
  await waitExpression(`[...document.querySelectorAll('button')].some((item)=>item.textContent.trim()==='Change target or weighting')`, "editable Guide Investment inspector");
  if (!await evaluate(`document.querySelector('[aria-label="Semantic Inspector"]')?.innerText.includes('Capital target')`)) throw new Error("Guide allocation did not open the editable Investment inspector.");
  await screenshot("builder-blocky-group-guide-handoff");

  await send("Page.navigate", { url: "http://127.0.0.1:4173/browser-harness.html?journey=blocky-filter-choose-buy" });
  await waitSelector('[data-projection-contract="blocky"]');
  await waitExpression(`document.querySelector('[data-projection-contract="blocky"]')?.getAttribute('data-execution-candidate')==='ready'`, "V2B-02 executable candidate");
  const v2b02Before = await evaluate(`(() => { const draft=window.__RULETRADE_BROWSER_DRAFT__; return { blocks:Object.keys(draft?.canvasBlocks??{}).sort(), connections:draft?.blockConnections, filter:draft?.canvasBlocks?.['draft:filter']?.fieldValues?.FILTER_SPEC, source:draft?.canvasBlocks?.['draft:source']?.objectRef }; })()`);
  if (v2b02Before.blocks.length !== 9 || v2b02Before.source !== "group-1" || !String(v2b02Before.filter).includes("positive-126")) throw new Error(`V2B-02 native graph did not preserve Group and Filter identity: ${JSON.stringify(v2b02Before)}`);
  await clickQuickTest();
  await waitExpression(`window.__RULETRADE_V2B02_HANDOFF__?.operation?.kind==='insert_program_statement'`, "typed V2B-02 Program handoff");
  const v2b02 = await evaluate(`(() => { const operation=window.__RULETRADE_V2B02_HANDOFF__?.operation; const event=operation?.statement; const select=event?.statements?.find((item)=>item.kind==='select'); const buy=event?.statements?.find((item)=>item.kind==='buy'); const draft=window.__RULETRADE_BROWSER_DRAFT__; return { operationKind:operation?.kind, eventKind:event?.kind, clock:event?.event?.clock_id, universe:select?.selection?.universe_id, eligibility:select?.selection?.eligibility, ranking:select?.selection?.ranking, count:select?.selection?.count, shortage:select?.selection?.shortage_policy, output:select?.output_id, buyTarget:buy?.target, buyAmount:buy?.amount, blocks:Object.keys(draft?.canvasBlocks??{}).sort(), connections:draft?.blockConnections, canonical:window.__RULETRADE_BROWSER_CANONICAL__ }; })()`);
  if (v2b02.eventKind !== "on_event" || v2b02.clock !== "daily-close" || v2b02.universe !== "group-1" || v2b02.eligibility?.operator !== "gt" || v2b02.ranking?.kind !== "trailing_return" || v2b02.ranking?.observations !== 63 || v2b02.count !== 1 || v2b02.shortage !== "choose_all" || v2b02.buyTarget?.kind !== "selection" || v2b02.buyTarget?.ref !== v2b02.output || v2b02.buyAmount?.kind !== "units_each" || v2b02.buyAmount?.units !== 1) throw new Error(`V2B-02 typed handoff changed composed meaning: ${JSON.stringify(v2b02)}`);
  if (JSON.stringify(v2b02Before.blocks) !== JSON.stringify(v2b02.blocks) || JSON.stringify(v2b02Before.connections) !== JSON.stringify(v2b02.connections)) throw new Error(`V2B-02 handoff mutated the native graph: ${JSON.stringify({v2b02Before,v2b02})}`);
  await clickText("Rules"); await waitSelector('[data-projection-contract="rules"]');
  const v2b02Rules = await evaluate(`document.querySelector('[data-projection-contract="rules"]')?.innerText??''`);
  if (!v2b02Rules.includes("Group 1") || !v2b02Rules.includes("Buy") || !v2b02Rules.includes("1 unit")) throw new Error(`Rules did not preserve V2B-02 Group and Buy meaning: ${v2b02Rules}`);
  await clickText("Code"); await waitSelector('.code-representation[aria-label="Code representation"]');
  const v2b02Code = await evaluate(`document.querySelector('.code-representation[aria-label="Code representation"]')?.innerText??''`);
  if (!v2b02Code.includes("blocky-select-draft-start-pipeline") || !v2b02Code.includes("units_each") || !v2b02Code.includes("group-1")) throw new Error(`Code projection did not preserve V2B-02 semantic identity: ${v2b02Code}`);
  await screenshot("builder-v2b02-filter-topn-buy-roundtrip");

  await send("Page.navigate", { url: "http://127.0.0.1:4173/browser-harness.html?journey=branch-fallback" });
  await waitSelector('[data-projection-contract="rules"]');
  const v2b03RulesBefore = await evaluate(`document.querySelector('[data-projection-contract="rules"]')?.innerText??''`);
  if (!v2b03RulesBefore.includes("if incomplete, use TLT") || !v2b03RulesBefore.includes("DO:") || !v2b03RulesBefore.includes("OTHERWISE (when False or Unknown):") || !v2b03RulesBefore.includes("OTHERWISE omitted; when False or Unknown, retain current holdings.")) throw new Error(`V2B-03 Rules did not distinguish branches and selection fallback: ${v2b03RulesBefore}`);
  await clickText("Flow"); await waitSelector('[aria-label="Flow capital projection"]');
  await evaluate(`(async () => { for(let attempt=0;attempt<60;attempt+=1){ const node=[...document.querySelectorAll('.react-flow__node')].find((item)=>(item.textContent??'').includes('TLT')&&(item.textContent??'').includes('Shortage fallback')); if(node){ node.dispatchEvent(new MouseEvent('click',{bubbles:true,button:0})); return true; } await new Promise((resolve)=>setTimeout(resolve,100)); } throw new Error('Missing selection fallback Flow node'); })()`);
  await waitSelector('input[aria-label="Fallback asset"]');
  await setControlValue("Fallback asset", "IEF");
  await evaluate(`(() => { const input=document.querySelector('input[aria-label="Fallback asset"]'); input.focus(); input.blur(); })()`);
  await waitExpression(`window.__RULETRADE_V2B03_OPERATION__?.kind==='set_program_fallback'&&window.__RULETRADE_BROWSER_CANONICAL__?.program?.statements?.[0]?.selection?.fallback_asset==='IEF'`, "typed selection shortage fallback edit");
  const v2b03After = await evaluate(`(() => { const statements=window.__RULETRADE_BROWSER_CANONICAL__?.program?.statements??[]; return { fallback:statements[0]?.selection?.fallback_asset, explicit:statements[1], omitted:statements[2], operation:window.__RULETRADE_V2B03_OPERATION__ }; })()`);
  if (v2b03After.fallback !== "IEF" || v2b03After.operation?.kind !== "set_program_fallback" || v2b03After.explicit?.otherwise_statements?.[0]?.semantic_id !== "explicit-otherwise" || v2b03After.explicit?.unknown_policy !== "otherwise" || v2b03After.omitted?.otherwise_statements?.length !== 0 || v2b03After.omitted?.unknown_policy !== "retain") throw new Error(`V2B-03 fallback edit changed control branch meaning: ${JSON.stringify(v2b03After)}`);
  await clickText("Rules"); await waitSelector('[data-projection-contract="rules"]');
  const v2b03RulesAfter = await evaluate(`document.querySelector('[data-projection-contract="rules"]')?.innerText??''`);
  if (!v2b03RulesAfter.includes("if incomplete, use IEF") || !v2b03RulesAfter.includes("OTHERWISE (when False or Unknown):") || !v2b03RulesAfter.includes("OTHERWISE omitted; when False or Unknown, retain current holdings.")) throw new Error(`V2B-03 roundtrip lost branch or fallback meaning: ${v2b03RulesAfter}`);
  await clickText("Code"); await waitSelector('.code-representation[aria-label="Code representation"]');
  const v2b03Code = await evaluate(`document.querySelector('.code-representation[aria-label="Code representation"]')?.innerText??''`);
  if (!v2b03Code.includes('"fallback_asset": "IEF"') || !v2b03Code.includes('"unknown_policy": "otherwise"') || !v2b03Code.includes('"unknown_policy": "retain"')) throw new Error(`V2B-03 Code projection lost distinct semantics: ${v2b03Code}`);
  await screenshot("builder-v2b03-branch-fallback-roundtrip");

  await send("Page.navigate", { url: "http://127.0.0.1:4173/browser-harness.html?journey=flow-removal" });
  await waitSelector('[aria-label="Flow capital projection"]');
  await evaluate(`(async () => { for(let attempt=0;attempt<60;attempt+=1){ const path=[...document.querySelectorAll('.react-flow__edge-interaction')].find((item)=>item.isConnected&&item.getTotalLength()>0); if(path){ const local=path.getPointAtLength(path.getTotalLength()/2); const screen=local.matrixTransform(path.getScreenCTM()); path.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:screen.x,clientY:screen.y,button:0})); return true; } await new Promise((resolve)=>setTimeout(resolve,100)); } throw new Error('Missing stable Flow route interaction path'); })()`);
  await waitExpression(`document.querySelector('.react-flow__edge')?.classList.contains('selected')`, "selected Flow route");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
  await waitExpression(`window.__RULETRADE_BROWSER_CANONICAL__?.program?.statements.length===0`, "typed Flow route removal");
  const flowRemoval = await evaluate(`({statements:window.__RULETRADE_BROWSER_CANONICAL__?.program?.statements.length,draft:window.__RULETRADE_BROWSER_DRAFT__?.perspectiveDrafts?.flow,empty:document.body.innerText.includes('No capital route has been defined yet.')})`);
  if (flowRemoval.statements !== 0 || flowRemoval.draft || !flowRemoval.empty) throw new Error(`Typed Flow removal failed: ${JSON.stringify(flowRemoval)}`);
  await screenshot("builder-typed-flow-removal");

  await send("Page.navigate", { url: "http://127.0.0.1:4173/browser-harness.html?journey=catalog-mvp" });
  await waitExpression(`document.body.innerText.includes('What would you like to try?')`, "catalog MVP home");
  await clickText("Learning");
  await waitSelector('.challenge-workspace[aria-labelledby="challenge-hub-title"]');
  await waitExpression(`document.body.innerText.includes('Monthly allocation fundamentals')`, "Learning problem index");
  await evaluate(`([...document.querySelectorAll(".challenge-problem-list button")].find((item)=>item.textContent.includes("Monthly allocation fundamentals"))).click()`);
  await waitExpression(`location.pathname.startsWith('/learning/problems/')&&document.body.innerText.includes('Create constrained strategy')`, "Learning problem detail");
  await clickText("Create constrained strategy");
  await waitSelector('[aria-labelledby="catalog-title"]');
  const constrainedAuthoring = await evaluate(`(() => {
    const asset=document.querySelector('select[aria-label="Asset"]');
    const rebalance=document.querySelector('select[aria-label="Rebalance"]');
    const rules=[...document.querySelectorAll('.picker-group button')];
    return {
      body:document.body.innerText,
      ruleCount:rules.length,
      ruleText:rules.map((item)=>item.textContent),
      assets:asset?[...asset.options].map((item)=>item.value):[],
      rebalanceValue:rebalance?.value,
      rebalanceDisabled:Boolean(rebalance?.disabled),
    };
  })()`);
  if (constrainedAuthoring.ruleCount !== 1 || !constrainedAuthoring.ruleText.some((item) => item.includes("Single asset periodic")) || JSON.stringify(constrainedAuthoring.assets) !== JSON.stringify(["QQQ", "SPY"]) || constrainedAuthoring.rebalanceValue !== "monthly" || !constrainedAuthoring.rebalanceDisabled || !constrainedAuthoring.body.includes("Policy v1 applied")) throw new Error(`Problem-first constrained authoring failed: ${JSON.stringify(constrainedAuthoring)}`);
  await screenshot("problem-first-constrained-rules-authoring");
  await clickAriaLabel("Close");
  await waitExpression(`document.body.innerText.includes('Monthly allocation fundamentals')`, "return to Learning problem page");
  await clickTextContaining("+ New strategy");
  await waitSelector('[aria-labelledby="picker-title"]');
  await clickTextContaining("Choose a strategy rule");
  await waitSelector('[aria-labelledby="catalog-title"]');
  await setControlValue("Strategy name", "QQQ monthly");
  await setControlValue("Asset", "QQQ");
  await setControlValue("Rebalance", "monthly");
  await clickText("Create and save strategy");
  await waitSelector('[aria-label="Strategy detail"]');
  await waitExpression(`document.body.innerText.includes('One strategy, separate workspaces')&&document.body.innerText.includes('QQQ monthly')`, "independent Strategy detail");
  await screenshot("catalog-mvp-strategy-detail");
  await clickText("Edit in Builder");
  await waitSelector('[data-production-builder-shell="true"]');
  await waitExpression(`document.body.innerText.includes('QQQ monthly')`, "persisted catalog strategy");
  await waitExpression(`Boolean([...document.querySelectorAll('.builder-actions button.primary-button')].find((item)=>item.textContent.trim().startsWith('Test')&&!item.textContent.trim().startsWith('Tests')&&!item.disabled))`, "catalog strategy Test");
  await evaluate(`(() => { const button=[...document.querySelectorAll('.builder-actions button.primary-button')].reverse().find((item)=>{ const rect=item.getBoundingClientRect(); return item.textContent.trim()==='Test ▶'&&!item.disabled&&rect.width&&rect.height; }); if(!button) throw new Error('Missing enabled Quick Test button'); button.click(); return true; })()`); await waitSelector('.quick-test-panel');
  await clickText("Run Quick Test"); await waitSelector('.quick-test-dashboard .result-workspace');
  const catalogJourney = await evaluate(`({body:document.body.innerText,requests:window.__RULETRADE_BROWSER_REQUESTS__??[]})`);
  const catalogListIndex = catalogJourney.requests.findIndex((item) => item.url === "/api/v2/strategy-catalog");
  const catalogCreateIndex = catalogJourney.requests.findIndex((item) => item.url === "/api/v2/strategy-catalog/create" && item.method === "POST");
  const catalogSaveIndex = catalogJourney.requests.findIndex((item) => item.url === "/api/v1/strategies" && item.method === "POST");
  const catalogRunIndex = catalogJourney.requests.findIndex((item) => item.url === "/api/v2/revisions/revision-catalog-mvp/backtest-runs" && item.method === "POST");
  if (catalogListIndex < 0 || catalogCreateIndex <= catalogListIndex || catalogSaveIndex <= catalogCreateIndex || catalogRunIndex <= catalogSaveIndex || !catalogJourney.body.includes("HOW DID IT DO?") || catalogJourney.requests.some((item) => item.url.includes("/api/v1/backtest-runs"))) throw new Error(`Catalog MVP create-to-test journey failed: ${JSON.stringify(catalogJourney)}`);
  await screenshot("catalog-mvp-created-saved-and-executed");
  await clickAriaLabel("Close Quick Test Dashboard");
  const builderActions = await evaluate(`([...document.querySelectorAll('.builder-actions button')].map((item)=>item.textContent.trim()))`);
  if (builderActions.some((label) => ["Research", "Detail BT", "Hidden BT", "Tests", "Forward"].includes(label))) throw new Error(`Builder leaked durable evaluation tools: ${JSON.stringify(builderActions)}`);
  await clickAriaLabel("Back to Home");
  await waitSelector('[aria-label="Strategy detail"]');
  await clickText("Research");
  await waitSelector('.research-portfolio[aria-labelledby="strategy-research-title"]');
  await waitExpression(`Boolean([...document.querySelectorAll("button")].find((item)=>item.textContent.includes("Detail BT")))`, "research actions");
  await waitExpression(`Boolean(document.querySelector('[aria-labelledby="detail-bt-title"]')) || (([...document.querySelectorAll(".research-portfolio .strategy-card")].find((item)=>item.textContent.includes("Detail BT")))?.click(), false)`, "open Detail BT");
  await clickText("Run Detailed BT");
  await waitExpression(`(window.__RULETRADE_BROWSER_REQUESTS__??[]).some((item)=>item.url==='/api/v2/revisions/revision-catalog-mvp/research-experiments/detail')`, "Detailed BT experiment request");
  await sleep(300);
  const detailJourney = await evaluate(`({body:document.body.innerText,requests:window.__RULETRADE_BROWSER_REQUESTS__??[]})`);
  if (!detailJourney.requests.some((item) => item.url === "/api/v2/revisions/revision-catalog-mvp/research-experiments/detail" && item.method === "POST") || !detailJourney.body.includes("10%") || !detailJourney.body.includes("$110,000") || !detailJourney.body.includes("Open full result")) throw new Error(`Detailed BT browser journey failed: ${JSON.stringify(detailJourney)}`);
  await screenshot("detailed-bt-single-run");
  await clickAriaLabel("Close Detailed BT");
  await waitExpression(`Boolean(document.querySelector('[aria-labelledby="hidden-bt-title"]')) || (([...document.querySelectorAll(".research-portfolio .strategy-card")].find((item)=>item.textContent.includes("Hidden BT")))?.click(), false)`, "open Hidden BT");
  await waitExpression(`(window.__RULETRADE_BROWSER_REQUESTS__??[]).some((item)=>item.url==='/api/v2/research-experiments/hidden-policies')`, "Hidden BT policy request");
  await waitSelector('[aria-label="Server-owned holdout policy"]');
  await setControlValue("Hidden values", "QQQ, SPY");
  const hiddenSetup = await evaluate(`({body:document.body.innerText,hasPolicy:Boolean(document.querySelector('[aria-label="Server-owned holdout policy"]')),inputs:[...document.querySelectorAll('input')].map((item)=>item.getAttribute('aria-label'))})`);
  if (!hiddenSetup.hasPolicy || hiddenSetup.inputs.some((item) => ["Hidden start date", "Hidden end date", "Hidden dataset"].includes(item))) throw new Error(`Hidden BT exposed client-owned policy fields: ${JSON.stringify(hiddenSetup)}`);
  await clickText("Run Hidden BT");
  await waitExpression(`(window.__RULETRADE_BROWSER_REQUESTS__??[]).some((item)=>item.url==='/api/v2/revisions/revision-catalog-mvp/research-experiments/hidden')`, "Hidden BT experiment request");
  await sleep(300);
  const hiddenJourney = await evaluate(`({body:document.body.innerText,requests:window.__RULETRADE_BROWSER_REQUESTS__??[]})`);
  if (!hiddenJourney.requests.some((item) => item.url === "/api/v2/revisions/revision-catalog-mvp/research-experiments/hidden" && item.method === "POST") || !hiddenJourney.body.includes("SELECTED CANDIDATE #1") || !hiddenJourney.body.includes("4% calibration") || !hiddenJourney.body.includes("10%") || !hiddenJourney.body.includes("8%") || !hiddenJourney.body.includes("6%") || !hiddenJourney.body.includes("$106,000")) throw new Error(`Hidden BT browser journey failed: ${JSON.stringify(hiddenJourney)}`);
  await screenshot("hidden-bt-parameter-selection");
  await clickAriaLabel("Close Hidden BT");
  await waitExpression(`Boolean(document.querySelector('[aria-labelledby="research-tests-title"]')) || (([...document.querySelectorAll(".research-portfolio .strategy-card")].find((item)=>item.textContent.includes("Tests")))?.click(), false)`, "open Tests");
  await waitExpression(`(window.__RULETRADE_BROWSER_REQUESTS__??[]).some((item)=>item.url==='/api/v2/research-experiments/robustness-policies')`, "Robustness policy request");
  await waitSelector('[aria-label="Server-owned robustness policy"]');
  await waitExpression(`Boolean([...document.querySelectorAll('button')].find((item)=>item.textContent==='Run Robustness'&&!item.disabled))`, "enabled Robustness action");
  await clickText("Run Robustness");
  await waitExpression(`(window.__RULETRADE_BROWSER_REQUESTS__??[]).some((item)=>item.url.endsWith('/research-experiments/robustness'))`, "Robustness experiment request");
  await sleep(300);
  const robustnessJourney = await evaluate(`({body:document.body.innerText,requests:window.__RULETRADE_BROWSER_REQUESTS__??[]})`);
  if (!robustnessJourney.body.includes("Reference 10%") || !robustnessJourney.body.includes("Variants: 7% to 11%") || !robustnessJourney.body.includes("-3%") || !robustnessJourney.body.includes("1%")) throw new Error(`Robustness browser journey failed: ${JSON.stringify(robustnessJourney)}`);
  await screenshot("tests-robustness-distribution");
  await clickText("New Test");
  await clickText("Random Baseline");
  await setControlValue("Random baseline seeds", "7, 11, 23");
  await clickText("Run Random Baseline");
  await waitExpression(`(window.__RULETRADE_BROWSER_REQUESTS__??[]).some((item)=>item.url.endsWith('/research-experiments/random-baseline'))`, "Random Baseline experiment request");
  await sleep(300);
  const randomJourney = await evaluate(`({body:document.body.innerText,requests:window.__RULETRADE_BROWSER_REQUESTS__??[]})`);
  if (!randomJourney.body.includes("Reference 10%") || !randomJourney.body.includes("Variants: 4% to 12%") || !randomJourney.body.includes("-6%") || !randomJourney.body.includes("2%") || !randomJourney.body.includes("seeded_random_asset")) throw new Error(`Random Baseline browser journey failed: ${JSON.stringify(randomJourney)}`);
  await screenshot("tests-random-baseline-comparison");
  await clickAriaLabel("Close Tests");


  await send("Page.navigate", { url: "http://127.0.0.1:4173/browser-harness.html?journey=persisted-v2" });
  await waitSelector('[data-production-builder-shell="true"]');
  const builderBeforeDashboard = await evaluate(`(() => { const canvas=document.querySelector('.representation-workspace').getBoundingClientRect(); const workbench=document.querySelector('.builder-workbench').getBoundingClientRect(); return {canvas:{x:canvas.x,y:canvas.y,width:canvas.width,height:canvas.height},workbench:{width:workbench.width}}; })()`);
  await waitExpression(`Boolean([...document.querySelectorAll('.builder-actions button.primary-button')].find((item)=>item.textContent.trim().startsWith('Test')&&!item.textContent.trim().startsWith('Tests')&&!item.disabled))`, "enabled persisted V2 Test");
  await clickQuickTest(); await waitSelector('.quick-test-panel');
  await clickText("Run Quick Test"); await waitSelector('.quick-test-dashboard .result-workspace');
  const dashboardGeometry = await evaluate(`(() => { const canvas=document.querySelector('.representation-workspace').getBoundingClientRect(); const workbench=document.querySelector('.builder-workbench').getBoundingClientRect(); const dashboard=document.querySelector('.quick-test-dashboard').getBoundingClientRect(); return {canvas:{x:canvas.x,y:canvas.y,width:canvas.width,height:canvas.height},workbench:{width:workbench.width},dashboard:{width:dashboard.width}}; })()`);
  if (Math.abs(builderBeforeDashboard.canvas.x-dashboardGeometry.canvas.x)>1 || Math.abs(builderBeforeDashboard.canvas.y-dashboardGeometry.canvas.y)>1 || Math.abs(builderBeforeDashboard.canvas.width-dashboardGeometry.canvas.width)>1 || Math.abs(builderBeforeDashboard.canvas.height-dashboardGeometry.canvas.height)>1 || dashboardGeometry.dashboard.width/dashboardGeometry.workbench.width < .68 || dashboardGeometry.dashboard.width/dashboardGeometry.workbench.width > .72) throw new Error(`Quick Test Dashboard changed Builder geometry: ${JSON.stringify({builderBeforeDashboard,dashboardGeometry})}`);
  if (!await evaluate(`Boolean(document.querySelector('.quick-test-dashboard-scrim'))`)) throw new Error("Quick Test Dashboard did not soften the underlying Builder.");
  await clickAriaLabel("Collapse Run run-v2-b"); await waitSelector('[aria-label="Open Run run-v2-b"]');
  const collapsedGeometry = await evaluate(`(() => { const canvas=document.querySelector('.representation-workspace').getBoundingClientRect(); return {x:canvas.x,y:canvas.y,width:canvas.width,height:canvas.height}; })()`);
  if (Math.abs(builderBeforeDashboard.canvas.x-collapsedGeometry.x)>1 || Math.abs(builderBeforeDashboard.canvas.width-collapsedGeometry.width)>1 || await evaluate(`Boolean(document.querySelector('.quick-test-dashboard-scrim'))`)) throw new Error(`Collapsed Dashboard changed Builder geometry or left its backdrop mounted: ${JSON.stringify({builderBeforeDashboard,collapsedGeometry})}`);
  await clickAriaLabel("Open Run run-v2-b"); await waitSelector('.quick-test-dashboard[data-dashboard-state="open"] .result-workspace');
  await waitSelector('[data-decision-id="decision-v2-browser"]');
  await evaluate(`document.querySelector('[data-decision-id="decision-v2-browser"]').click()`);
  await waitExpression(`(window.__RULETRADE_BROWSER_REQUESTS__??[]).some((item)=>item.url==='/api/v2/backtest-runs/run-v2-browser/decision-events/decision-v2-browser')`, "persisted V2 decision detail request");
  await waitExpression(`document.body.innerText.includes('QQQ 100%')`, "persisted V2 decision detail");
  const persistedJourney = await evaluate(`({body:document.body.innerText,requests:window.__RULETRADE_BROWSER_REQUESTS__??[]})`);
  if (!persistedJourney.body.includes("What happened, and why?") || !persistedJourney.body.includes("QQQ 100%") || !persistedJourney.requests.some((item)=>item.url==="/api/v2/revisions/revision-v2-browser/backtest-runs"&&item.method==="POST") || !persistedJourney.requests.some((item)=>item.url==="/api/v2/backtest-runs/run-v2-browser/decision-events") || persistedJourney.requests.some((item)=>item.url.includes("/api/v1/backtest-runs"))) throw new Error(`Persisted V2 browser journey failed: ${JSON.stringify(persistedJourney)}`);
  await screenshot("persisted-v2-result-evidence");
  await clickAriaLabel("Close Quick Test Dashboard");
  await waitSelector('[aria-label="Open Run run-v2-b"]');
  const closedDashboard = await evaluate(`({open:document.querySelector(\'.quick-test-dashboard\')?.getAttribute(\'data-dashboard-state\')===\'open\',scrim:Boolean(document.querySelector(\'.quick-test-dashboard-scrim\'))})`);
  if (closedDashboard.open || closedDashboard.scrim) throw new Error(`Closing Quick Test Dashboard did not restore the Builder: ${JSON.stringify(closedDashboard)}`);
  await clickAriaLabel("Open Run run-v2-b");
  await waitSelector('.quick-test-dashboard[data-dashboard-state="open"] .result-workspace');
  await clickText("Blocky"); await clickText("Objects"); await clickText("Create Group"); await waitSelector('[data-object-definition-workspace="group"]');
  const overlayOwnership = await evaluate(`({ dashboard:Boolean(document.querySelector('[aria-label="Quick Test Dashboard"]')), bookmarks:Boolean(document.querySelector('[aria-label="Recent Quick Test results"]')), scrim:Boolean(document.querySelector('.quick-test-dashboard-scrim')) })`);
  if (overlayOwnership.dashboard || overlayOwnership.bookmarks || overlayOwnership.scrim) throw new Error(`Quick Test UI leaked above Group Workspace: ${JSON.stringify(overlayOwnership)}`);
  await clickAriaLabel("Cancel Group creation"); await waitSelector('[aria-label="Collapse Run run-v2-b"]');
  await clickText("Back"); await waitSelector('[data-production-builder-shell="true"]');
  await screenshot("persisted-v2-builder-reopened");

  await send("Page.navigate", { url: "http://127.0.0.1:4173/browser-harness.html?journey=ui-authored-equivalence" });
  await waitSelector('[data-production-builder-shell="true"]');
  await waitExpression(`document.body.innerText.includes('UI Authored Monthly QQQ')`, "ui-authored journey navigation");
  await clickText("Guide"); await waitSelector('[aria-label="Guided strategy editor"]');
  await clickText("Choose QQQ first"); await waitSelector('[data-intent-recipe="single_asset"]');
  await evaluate(`(() => { const details=document.querySelector('input[aria-label="Manual asset symbol"]').closest('details'); details.open=true; })()`);
  await setControlValue("Manual asset symbol", "QQQ");
  await clickText("Add symbol");
  await waitExpression(`Boolean([...document.querySelectorAll('button')].find((item)=>item.textContent.trim()==='Use selected assets'&&!item.disabled))`, "selected QQQ asset");
  await scrollButtonIntoView("Use selected assets"); await sleep(100);
  await clickText("Use selected assets"); await sleep(200);
  await setControlValue("Intent timing", "monthly");
  await setControlValue("Timing meaning", "rebalance");
  await waitExpression(`Boolean([...document.querySelectorAll('button')].find((item)=>item.textContent.trim()==='Commit strategy meaning'&&!item.disabled))`, "complete Guide intent");
  await scrollButtonIntoView("Commit strategy meaning"); await sleep(100);
  await clickText("Commit strategy meaning");
  await waitExpression(`window.__RULETRADE_UI_EQUIVALENCE__?.operation?.kind==='commit_single_asset_intent'`, "typed Guide operation");
  await waitExpression(`Boolean([...document.querySelectorAll('.builder-actions button.primary-button')].find((item)=>item.textContent.trim().startsWith('Test')&&!item.textContent.trim().startsWith('Tests')&&!item.disabled))`, "enabled Test with unsaved committed semantics");
  await clickQuickTest(); await waitSelector('.quick-test-panel');
  await clickText("Run Quick Test");
  await waitExpression(`window.__RULETRADE_UI_EQUIVALENCE__?.savedRevision==='revision-ui-authored-2'`, "Quick Test auto-saved UI-authored revision");
  await waitSelector('.quick-test-dashboard .result-workspace');
  const authoredBeforeReopen = await evaluate(`window.__RULETRADE_UI_EQUIVALENCE__`);
  const autoSaveRequests = await evaluate(`window.__RULETRADE_BROWSER_REQUESTS__??[]`);
  const autoSaveIndex = autoSaveRequests.findIndex((item) => item.url==='/api/v1/strategies/strategy-ui-authored/revisions'&&item.method==='POST');
  const autoRunIndex = autoSaveRequests.findIndex((item) => item.url==='/api/v2/revisions/revision-ui-authored-2/backtest-runs'&&item.method==='POST');
  if (JSON.stringify(authoredBeforeReopen.appliedCanonical) !== JSON.stringify(authoredBeforeReopen.savedCanonical) || autoSaveIndex < 0 || autoRunIndex <= autoSaveIndex || autoSaveRequests.some((item) => item.url==='/api/v2/revisions/revision-ui-authored-1/backtest-runs'&&item.method==='POST')) throw new Error(`UI-authored Quick Test revision ownership failed: ${JSON.stringify({ authoredBeforeReopen, autoSaveRequests })}`);
  await screenshot("ui-authored-monthly-qqq-auto-saved-and-executed");
  await clickAriaLabel("Back to Home"); await waitSelector('[aria-label="Strategy home"]');
  await clickText("Reopen saved strategy"); await waitSelector('[data-production-builder-shell="true"]');
  await clickText("Guide"); await waitExpression(`document.body.innerText.includes('monthly close')&&document.body.innerText.includes('QQQ')`, "reopened Guide meaning");
  await clickText("Rules"); await waitExpression(`document.querySelector('[data-projection-contract="rules"]')?.innerText.includes('QQQ')`, "reopened Rules meaning");
  await evaluate(`document.querySelector('[data-projection-contract="rules"] button[data-semantic-address="single-asset-allocation"]').click()`);
  await waitSelector('select[aria-label="Single asset rule schedule"]');
  await setControlValue("Single asset rule schedule", "daily");
  await waitExpression(`window.__RULETRADE_UI_EQUIVALENCE__?.rulesOperation?.timeframe==='daily'`, "typed Rules edit operation");
  const rulesEdit = await evaluate(`window.__RULETRADE_UI_EQUIVALENCE__`);
  if (rulesEdit.rulesOperation?.kind !== "commit_single_asset_intent" || rulesEdit.rulesAppliedCanonical?.program?.clocks?.[0]?.timeframe !== "daily") throw new Error(`Rules typed edit did not produce daily Canonical: ${JSON.stringify(rulesEdit)}`);
  await screenshot("ui-authored-rules-daily-edit");

  const advancedJourneys = [
    { id: "split_portfolio", view: "Flow", recipe: "Growth + Defensive", kind: "commit_split_portfolio_intent", mutate: [["Growth share (%)", "69"], ["Growth share (%)", "70"]] },
    { id: "weighted_score", recipe: "Weighted Score allocation", kind: "commit_weighted_score_intent", mutate: [["Short return observations", "20"], ["Short return observations", "21"], ["Select Top N", "3"]] },
    { id: "temporal_sequence", recipe: "Breakout, retest, confirmation", kind: "commit_temporal_sequence_intent", mutate: [["Breakout adjusted close", "11"], ["Breakout adjusted close", "12"], ["Expiry state", "expired"]] },
    { id: "multi_clock_policy", recipe: "Weekly context, daily signal", kind: "commit_multi_clock_policy_intent", mutate: [["Completed weekly threshold", "1"], ["Completed weekly threshold", "0"], ["Unknown risk guard", "block"]] },
  ];
  for (const advanced of advancedJourneys) {
    await send("Page.navigate", { url: `http://127.0.0.1:4173/browser-harness.html?journey=ui-authored-advanced&case=${advanced.id}` });
    await waitSelector('[data-production-builder-shell="true"]');
    const authoringView = advanced.view ?? "Guide";
    await clickText(authoringView); await waitSelector(authoringView === "Flow" ? '[aria-label="Flow capital projection"]' : '[aria-label="Guided strategy editor"]');
    if (authoringView === "Flow") { await clickText("Add"); await clickText("Capital"); }
    if (authoringView === "Flow") await clickTextContaining(advanced.recipe); else await clickText(advanced.recipe);
    await waitSelector(`[data-intent-recipe="${advanced.id}"]`);
    for (const [label, value] of advanced.mutate) await setControlValue(label, value);
    await waitExpression(`Boolean([...document.querySelectorAll('button')].find((item)=>item.textContent.trim()==='Commit strategy meaning'&&!item.disabled))`, `${advanced.id} complete intent`);
    await scrollButtonIntoView("Commit strategy meaning"); await clickText("Commit strategy meaning");
    await waitExpression(`window.__RULETRADE_ADVANCED_EQUIVALENCE__?.operation?.kind===${JSON.stringify(advanced.kind)}`, `${advanced.id} typed operation`);
    await waitExpression(`Boolean([...document.querySelectorAll('button')].find((item)=>item.textContent.trim()==='Save'&&!item.disabled))`, `${advanced.id} enabled Save`);
    await clickText("Save");
    await waitExpression(`window.__RULETRADE_ADVANCED_EQUIVALENCE__?.savedRevision==='revision-advanced-2'`, `${advanced.id} persisted revision`);
    const beforeReopen = await evaluate(`window.__RULETRADE_ADVANCED_EQUIVALENCE__`);
    if (JSON.stringify(beforeReopen.appliedCanonical) !== JSON.stringify(beforeReopen.savedCanonical)) throw new Error(`${advanced.id} Canonical changed at Save: ${JSON.stringify(beforeReopen)}`);
    await screenshot(`ui-authored-${advanced.id}-saved`);
    await clickAriaLabel("Back to Home"); await waitSelector('[aria-label="Strategy home"]');
    await clickText("Reopen saved strategy"); await waitSelector('[data-production-builder-shell="true"]');
    const projectionEvidence = {};
    for (const [label, selector] of [["Guide", '[aria-label="Guided strategy editor"]'], ["Flow", '[aria-label="Flow capital projection"]'], ["Blocky", '.blocky-representation'], ["Rules", '[data-projection-contract="rules"]'], ["Code", '.code-representation[aria-label="Code representation"]']]) {
      await clickText(label); await waitSelector(selector);
      if (label === "Flow") await waitExpression(`(document.querySelector(${JSON.stringify(selector)})?.innerText??'').trim()!=='React Flow'`, `${advanced.id} rendered Flow projection`);
      const projection = await evaluate(`document.querySelector(${JSON.stringify(selector)})?.innerText??''`);
      projectionEvidence[label] = projection;
      if (!projection.trim() || projection.includes("production Program lowering")) throw new Error(`${advanced.id} ${label} projection failed: ${projection}`);
    }
    if (advanced.id === "split_portfolio") {
      await clickText("Flow"); await waitSelector('[aria-label="Flow capital projection"]');
      const flow = projectionEvidence.Flow ?? "";
      await clickText("Blocky"); await waitSelector('.blocky-representation');
      const blocky = (projectionEvidence.Blocky ?? "").replace(/\u00a0/g, " ");
      const manifest = await evaluate(`document.querySelector('[data-projection-contract="blocky"]')?.getAttribute('data-block-connection-manifest')??''`);
      if (!flow.includes("70%") || !flow.includes("30%") || !flow.includes("IEF") || !blocky.includes("Split Portfolio capital") || !blocky.includes("70% portfolio weight") || !blocky.includes("30% portfolio weight") || !manifest.includes("statement:portfolio-split:LEG_1->investment-leg:growth-sleeve-leg") || !manifest.includes("statement:portfolio-split:LEG_2->investment-leg:defensive-sleeve-leg") || manifest.includes("investment-leg:growth-sleeve-leg:NEXT->investment-leg:defensive-sleeve-leg")) throw new Error(`V2B-04 did not preserve parallel split ownership: ${JSON.stringify({flow,blocky,manifest})}`);
    }
    await waitExpression(`Boolean([...document.querySelectorAll('.builder-actions button.primary-button')].find((item)=>item.textContent.trim().startsWith('Test')&&!item.textContent.trim().startsWith('Tests')&&!item.disabled))`, `${advanced.id} executable Test`);
    await clickQuickTest(); await waitSelector('.quick-test-panel');
    await clickText("Run Quick Test"); await waitSelector('.quick-test-dashboard .result-workspace');
    const advancedJourney = await evaluate(`({state:window.__RULETRADE_ADVANCED_EQUIVALENCE__,requests:window.__RULETRADE_BROWSER_REQUESTS__??[],dashboard:Boolean(document.querySelector('.quick-test-dashboard .result-workspace'))})`);
    if (!advancedJourney.requests.some((item)=>item.url==='/api/v2/revisions/revision-advanced-2/backtest-runs'&&item.method==='POST') || !advancedJourney.dashboard) throw new Error(`${advanced.id} execution equivalence failed: ${JSON.stringify(advancedJourney)}`);
    await screenshot(`ui-authored-${advanced.id}-executed`);
  }
  await writeFile(`${output}/browser-trace.json`, JSON.stringify(trace, null, 2));
  console.log(`Browser acceptance passed; artifacts: ${output}`);
} finally {
  socket?.close(); vite.kill("SIGTERM"); chrome.kill("SIGTERM");
}
