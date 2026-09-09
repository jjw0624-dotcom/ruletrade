const screens = [...document.querySelectorAll('.screen')];
const nav = document.getElementById('productNav');
const contextName = document.getElementById('contextName');
const state = { chosen: false, tested: false, whyOpen: false, quickOpen: false, candidate: false, workspaceThreshold: 0, top: 2 };

function showScreen(id, { push = true } = {}) {
  screens.forEach(screen => screen.classList.toggle('active', screen.id === id));
  const inProduct = !['landing', 'templates', 'loading'].includes(id);
  nav.classList.toggle('hidden', !state.chosen && id === 'landing');
  contextName.classList.toggle('hidden', !state.chosen);
  [...nav.querySelectorAll('button')].forEach(button => button.classList.toggle('active', button.dataset.go === id || (id === 'compare' && button.dataset.go === 'results')));
  if (id === 'results' && !state.tested) return runTest();
  if (id === 'compare' && !state.candidate) id = 'results';
  if (push) history.replaceState(null, '', `#${id}`);
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function chooseStrategy() { state.chosen = true; contextName.classList.remove('hidden'); nav.classList.remove('hidden'); showScreen('strategy'); }

function runTest() {
  state.tested = true;
  showScreen('loading');
  setTimeout(() => showScreen('results'), 850);
}

function reset() {
  Object.assign(state, { chosen: false, tested: false, whyOpen: false, quickOpen: false, candidate: false, workspaceThreshold: 0, top: 2 });
  document.getElementById('workspaceThreshold').value = '0';
  document.getElementById('topCount').value = '2';
  document.getElementById('summaryTop').textContent = '2';
  document.getElementById('candidateThreshold').value = '-5';
  document.getElementById('whySection').classList.add('hidden');
  document.getElementById('quickChange').classList.add('hidden');
  contextName.classList.add('hidden'); nav.classList.add('hidden');
  showScreen('landing');
}

document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => showScreen(button.dataset.go)));
document.getElementById('useStrategy').addEventListener('click', chooseStrategy);
document.getElementById('runBacktest').addEventListener('click', runTest);
document.getElementById('resetButton').addEventListener('click', reset);

document.querySelectorAll('.template-card').forEach(card => card.addEventListener('click', () => {
  document.querySelectorAll('.template-card').forEach(item => { item.classList.remove('selected'); item.querySelector('em')?.remove(); });
  card.classList.add('selected');
  const names = { growth: ['Growth + Defensive', 'Try to capture growth when it is positive, and fall back to bonds when too few assets qualify.'], momentum: ['Simple Momentum', 'Hold the two assets with the strongest recent returns.'], monthly: ['Monthly Investing', 'Invest the same amount into a broad market fund every month.'], balanced: ['Balanced Portfolio', 'Keep a steady mix of stocks and bonds, rebalanced monthly.'] };
  const [name, description] = names[card.dataset.template];
  document.querySelector('#templatePreview h2').textContent = name;
  document.querySelector('#templatePreview .preview-lead').textContent = description;
  document.querySelector('#templatePreview .mini-sleeves').classList.toggle('dimmed', card.dataset.template !== 'growth');
  document.getElementById('useStrategy').textContent = card.dataset.template === 'growth' ? 'Use this strategy →' : 'Preview only in this test';
  document.getElementById('useStrategy').disabled = card.dataset.template !== 'growth';
}));

document.getElementById('topCount').addEventListener('change', event => { state.top = Number(event.target.value); document.getElementById('summaryTop').textContent = event.target.value; });
document.getElementById('workspaceThreshold').addEventListener('change', event => { state.workspaceThreshold = Number(event.target.value); });

function revealWhy() {
  state.whyOpen = true;
  const section = document.getElementById('whySection'); section.classList.remove('hidden');
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  history.replaceState(null, '', '#why');
}
document.getElementById('seeWhy').addEventListener('click', revealWhy);
document.getElementById('chartJune').addEventListener('click', revealWhy);
document.getElementById('tryChange').addEventListener('click', () => { state.quickOpen = true; document.getElementById('quickChange').classList.remove('hidden'); document.getElementById('candidateThreshold').focus(); history.replaceState(null, '', '#change'); });
document.getElementById('compareButton').addEventListener('click', () => { state.candidate = true; showScreen('compare'); });

document.getElementById('onlyDifferences').addEventListener('click', () => { document.getElementById('onlyDifferences').classList.add('active'); document.getElementById('allPeriods').classList.remove('active'); document.querySelector('.difference-timeline').classList.add('only'); document.getElementById('differenceTitle').textContent = 'Only the four changed decisions'; history.replaceState(null, '', '#differences'); });
document.getElementById('allPeriods').addEventListener('click', () => { document.getElementById('allPeriods').classList.add('active'); document.getElementById('onlyDifferences').classList.remove('active'); document.querySelector('.difference-timeline').classList.remove('only'); document.getElementById('differenceTitle').textContent = 'Four decisions were different'; history.replaceState(null, '', '#compare'); });
document.getElementById('moreDetails').addEventListener('click', () => document.getElementById('detailsDialog').showModal());
document.querySelector('.dialog-close').addEventListener('click', () => document.getElementById('detailsDialog').close());

const initial = location.hash.slice(1);
if (['strategy','results','why','change','compare','differences'].includes(initial)) state.chosen = true;
if (['results','why','change','compare','differences'].includes(initial)) state.tested = true;
if (['why','change'].includes(initial)) { showScreen('results', { push: false }); revealWhy(); }
else if (initial === 'compare' || initial === 'differences') { state.candidate = true; showScreen('compare', { push: false }); if (initial === 'differences') document.getElementById('onlyDifferences').click(); }
else showScreen(initial || 'landing', { push: false });
if (initial === 'change') document.getElementById('tryChange').click();
