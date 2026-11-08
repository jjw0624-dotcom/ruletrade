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
  await clickText("Add symbol"); await sleep(200);
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
  await clickTextContaining("Test");
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

  await send("Page.navigate", { url: "http://127.0.0.1:4173/browser-harness.html?journey=persisted-v2" });
  await waitSelector('[data-production-builder-shell="true"]');
  const builderBeforeDashboard = await evaluate(`(() => { const canvas=document.querySelector('.representation-workspace').getBoundingClientRect(); const workbench=document.querySelector('.builder-workbench').getBoundingClientRect(); return {canvas:{x:canvas.x,y:canvas.y,width:canvas.width,height:canvas.height},workbench:{width:workbench.width}}; })()`);
  await waitExpression(`Boolean([...document.querySelectorAll('button')].find((item)=>item.textContent.includes('Test')&&!item.disabled))`, "enabled persisted V2 Test");
  await clickTextContaining("Test"); await waitSelector('.quick-test-panel');
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
  await clickText("Guide"); await waitSelector('[aria-label="Guided strategy editor"]');
  await clickText("Choose QQQ first"); await waitSelector('[data-intent-recipe="single_asset"]');
  await evaluate(`(() => { const details=document.querySelector('input[aria-label="Manual asset symbol"]').closest('details'); details.open=true; })()`);
  await setControlValue("Manual asset symbol", "QQQ");
  await clickText("Add symbol"); await sleep(200);
  await scrollButtonIntoView("Use selected assets"); await sleep(100);
  await clickText("Use selected assets"); await sleep(200);
  await setControlValue("Intent timing", "monthly");
  await setControlValue("Timing meaning", "rebalance");
  await waitExpression(`Boolean([...document.querySelectorAll('button')].find((item)=>item.textContent.trim()==='Commit strategy meaning'&&!item.disabled))`, "complete Guide intent");
  await scrollButtonIntoView("Commit strategy meaning"); await sleep(100);
  await clickText("Commit strategy meaning");
  await waitExpression(`window.__RULETRADE_UI_EQUIVALENCE__?.operation?.kind==='commit_single_asset_intent'`, "typed Guide operation");
  await waitExpression(`Boolean([...document.querySelectorAll('button')].find((item)=>item.textContent.includes('Test')&&!item.disabled))`, "enabled Test with unsaved committed semantics");
  await clickTextContaining("Test"); await waitSelector('.quick-test-panel');
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
  await waitExpression(`Boolean([...document.querySelectorAll('button')].find((item)=>item.textContent.includes('Test')&&!item.disabled))`, "executable UI-authored Test");
  await clickTextContaining("Test"); await waitSelector('.quick-test-panel');
  await clickText("Run Quick Test"); await waitSelector('.quick-test-dashboard .result-workspace');
  const authoredJourney = await evaluate(`({state:window.__RULETRADE_UI_EQUIVALENCE__,requests:window.__RULETRADE_BROWSER_REQUESTS__??[],dashboard:Boolean(document.querySelector('.quick-test-dashboard .result-workspace'))})`);
  if (!authoredJourney.requests.some((item)=>item.url==='/api/v2/revisions/revision-ui-authored-2/backtest-runs'&&item.method==='POST') || !authoredJourney.dashboard) throw new Error(`UI-authored execution equivalence failed: ${JSON.stringify(authoredJourney)}`);
  await screenshot("ui-authored-monthly-qqq-executed");

  const advancedJourneys = [
    { id: "weighted_score", recipe: "Weighted Score allocation", kind: "commit_weighted_score_intent", mutate: [["Short return observations", "20"], ["Short return observations", "21"], ["Select Top N", "3"]] },
    { id: "temporal_sequence", recipe: "Breakout, retest, confirmation", kind: "commit_temporal_sequence_intent", mutate: [["Breakout adjusted close", "11"], ["Breakout adjusted close", "12"], ["Expiry state", "expired"]] },
    { id: "multi_clock_policy", recipe: "Weekly context, daily signal", kind: "commit_multi_clock_policy_intent", mutate: [["Completed weekly threshold", "1"], ["Completed weekly threshold", "0"], ["Unknown risk guard", "block"]] },
  ];
  for (const advanced of advancedJourneys) {
    await send("Page.navigate", { url: `http://127.0.0.1:4173/browser-harness.html?journey=ui-authored-advanced&case=${advanced.id}` });
    await waitSelector('[data-production-builder-shell="true"]');
    await clickText("Guide"); await waitSelector('[aria-label="Guided strategy editor"]');
    await clickText(advanced.recipe); await waitSelector(`[data-intent-recipe="${advanced.id}"]`);
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
    for (const [label, selector] of [["Guide", '[aria-label="Guided strategy editor"]'], ["Flow", '[aria-label="Flow capital projection"]'], ["Blocky", '.blocky-representation'], ["Rules", '[data-projection-contract="rules"]'], ["Code", '.code-representation[aria-label="Code representation"]']]) {
      await clickText(label); await waitSelector(selector);
      const projection = await evaluate(`document.querySelector(${JSON.stringify(selector)})?.innerText??''`);
      if (!projection.trim() || projection.includes("production Program lowering")) throw new Error(`${advanced.id} ${label} projection failed: ${projection}`);
    }
    await waitExpression(`Boolean([...document.querySelectorAll('button')].find((item)=>item.textContent.includes('Test')&&!item.disabled))`, `${advanced.id} executable Test`);
    await clickTextContaining("Test"); await waitSelector('.quick-test-panel');
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
