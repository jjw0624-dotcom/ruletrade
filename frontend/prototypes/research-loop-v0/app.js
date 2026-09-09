const byId = (id) => document.getElementById(id);
const show = (element) => element.classList.remove("hidden");
const hide = (element) => element.classList.add("hidden");

const researchStage = document.querySelector(".research-stage");
const summary = document.querySelector(".summary");
const compareView = byId("compareView");
const decisionInspector = byId("decisionInspector");
const emptyInspector = byId("emptyInspector");
const whyPanel = byId("whyPanel");
const quickEdit = byId("quickEdit");

function selectJune({ revealWhy = false, edit = false } = {}) {
  hide(emptyInspector);
  show(decisionInspector);
  byId("juneTimeline").classList.add("selected");
  byId("juneMarker").classList.add("selected");
  if (revealWhy) show(whyPanel);
  if (edit) show(quickEdit);
  window.scrollTo({ top: document.querySelector(".workspace-grid").offsetTop - 12, behavior: "smooth" });
}

byId("juneMarker").addEventListener("click", () => selectJune());
byId("juneTimeline").addEventListener("click", () => selectJune());
byId("whyButton").addEventListener("click", () => { show(whyPanel); byId("whyButton").setAttribute("aria-expanded", "true"); });
byId("changeButton").addEventListener("click", () => { show(quickEdit); byId("thresholdInput").focus(); });
byId("closeInspector").addEventListener("click", () => { hide(decisionInspector); show(emptyInspector); byId("juneTimeline").classList.remove("selected"); byId("juneMarker").classList.remove("selected"); });

byId("compareButton").addEventListener("click", () => {
  const value = Number(byId("thresholdInput").value);
  if (value !== -5) byId("thresholdInput").value = "-5";
  hide(researchStage); hide(summary); show(compareView);
  window.scrollTo({ top: 0, behavior: "instant" });
  history.replaceState(null, "", "#compare");
});

function returnToResult(edit = true) {
  hide(compareView); show(summary); show(researchStage); selectJune({ revealWhy: true, edit });
  history.replaceState(null, "", edit ? "#edit" : "#why");
}
byId("backToResult").addEventListener("click", () => returnToResult());
byId("inspectOriginal").addEventListener("click", () => returnToResult(false));

byId("differencesButton").addEventListener("click", () => {
  byId("differencesButton").classList.add("active"); byId("allButton").classList.remove("active");
  byId("timelineTitle").textContent = "Only the four changed decisions";
  document.querySelector(".divergence-card").classList.add("differences-only");
  history.replaceState(null, "", "#differences");
});
byId("allButton").addEventListener("click", () => {
  byId("allButton").classList.add("active"); byId("differencesButton").classList.remove("active");
  byId("timelineTitle").textContent = "The strategies diverged four times";
  document.querySelector(".divergence-card").classList.remove("differences-only");
  history.replaceState(null, "", "#compare");
});

document.querySelectorAll(".difference-row").forEach((row) => row.addEventListener("click", () => {
  document.querySelectorAll(".difference-row").forEach((item) => item.classList.remove("selected"));
  row.classList.add("selected");
  const id = row.dataset.difference;
  const content = {
    june: ["Why different? · June 3", "VGT crossed only the Candidate rule", "VGT 126-day return = −3.2%"],
    july: ["Why different? · July 1", "The prior decision carried into July", "No new portfolio execution · holdings persisted"],
    sep: ["Why different? · September 3", "SOXX narrowly crossed −5%", "SOXX 126-day return = −4.6%"],
    nov: ["Why different? · November 1", "The same names received different weights", "Prior candidate path changed available capital"],
  }[id];
  const inspector = byId("differenceInspector");
  inspector.querySelector(".eyebrow").textContent = content[0]; inspector.querySelector("h2").textContent = content[1]; inspector.querySelector(".fact strong").textContent = content[2];
}));

const openDialog = (id) => byId(id).showModal();
byId("strategyButton").addEventListener("click", () => openDialog("strategyDialog"));
byId("detailsButton").addEventListener("click", () => openDialog("detailsDialog"));
byId("advancedButton").addEventListener("click", () => openDialog("detailsDialog"));
document.querySelectorAll(".dialog-close").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));

const initialState = location.hash;
if (initialState === "#decision") selectJune();
if (initialState === "#why") selectJune({ revealWhy: true });
if (initialState === "#edit") selectJune({ revealWhy: true, edit: true });
if (initialState === "#compare" || initialState === "#differences") {
  hide(researchStage); hide(summary); show(compareView);
  if (initialState === "#differences") byId("differencesButton").click();
}
