const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const code = fs.readFileSync('docs/designs/prototypes/assets/prototype.js', 'utf8');

const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="app"></div></body></html>`, {
  runScripts: "dangerously",
});

dom.window.eval(code);

const document = dom.window.document;
const app = document.getElementById('app');

// Simulate first render
dom.window.eval("renderPrototype()");

// Find the "APIs" button in Logs
const apisBtn = document.querySelector('[data-action="open-app-apis"]');
if (!apisBtn) {
  console.error("APIs button not found initially!");
} else {
  apisBtn.click();
}

// Check if activeTabId changed
console.log("activeTabId:", dom.window.activeTabId);
console.log("apiSelectedAppId:", dom.window.apiSelectedAppId);

// Find Products button
const productBtn = document.querySelector('button[data-entity-name="Products"]');
if (productBtn) {
  console.log("FOUND productBtn!");
  console.log(productBtn.outerHTML);
} else {
  console.error("NOT FOUND: productBtn");
  // Let's dump all buttons in the APIs container
  const apiContainer = document.querySelector('.apis-workspace-container');
  if (apiContainer) {
    console.log("apiContainer exists.");
    console.log("HTML:", apiContainer.innerHTML);
  } else {
    console.log("apiContainer not found either!");
    console.log("app HTML:", app.innerHTML);
  }
}
