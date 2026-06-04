/* ============================================
   Winco Staples — App Logic
   ============================================ */

const API_URL         = 'https://script.google.com/macros/s/AKfycbxYOYqfZ-Xr0-sdzuho6ASAWnJVJ6l2_I_X2XBKEMRLZOLkq10CDXXQqMsTHVNJRLLC/exec';
const STORAGE_KEY     = 'wincoItems';
const STORAGE_BACKUP  = 'wincoItemsBackup';
const STORAGE_UPDATED = 'wincoLastUpdated';
const SESSION_PIN     = 'wincoPinVerified';

// ---- State ----
let allItems      = [];
let currentMode   = 'inventory'; // 'inventory' | 'shopping'
let checkedItems  = new Set();   // item IDs checked off in shopping mode
let currentItem   = null;        // item being edited
let pendingAction = null;

// ---- DOM ----
const screenMain   = document.getElementById('screen-main');
const screenEdit   = document.getElementById('screen-edit');
const itemList     = document.getElementById('item-list');
const loadingOverlay = document.getElementById('loading-overlay');
const lastUpdated  = document.getElementById('last-updated');
const modeTitle    = document.getElementById('mode-title');
const shoppingBar  = document.getElementById('shopping-bar');
const shoppingSummary = document.getElementById('shopping-summary');
const editContent  = document.getElementById('edit-content');
const pinModal     = document.getElementById('pin-modal');
const pinError     = document.getElementById('pin-error');

// ---- Init ----
window.addEventListener('load', init);

async function init() {
  registerSW();
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      allItems = JSON.parse(stored);
      renderList();
      showLastUpdated();
      loadingOverlay.classList.add('hidden');
    } catch(e) {
      await fetchFromWeb();
    }
  } else {
    await fetchFromWeb();
  }
  setupEvents();
}

// ---- Service Worker ----
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          document.getElementById('update-banner').classList.remove('hidden');
          document.getElementById('btn-update').addEventListener('click', () => {
            nw.postMessage('skipWaiting');
            window.location.reload();
          });
          document.getElementById('btn-dismiss-update').addEventListener('click', () => {
            document.getElementById('update-banner').classList.add('hidden');
          });
        }
      });
    });
  }).catch(() => {});
}

// ---- Fetch ----
async function fetchFromWeb() {
  loadingOverlay.classList.remove('hidden');
  try {
    const res  = await fetch(`${API_URL}?action=getItems`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const current = localStorage.getItem(STORAGE_KEY);
    if (current) localStorage.setItem(STORAGE_BACKUP, current);

    allItems = data.items;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(allItems));
    localStorage.setItem(STORAGE_UPDATED, new Date().toLocaleString());
    renderList();
    showLastUpdated();
  } catch(err) {
    console.error(err);
    if (allItems.length === 0) {
      itemList.innerHTML = `<div class="empty-state">⚠️ Could not load data.<br>Check connection and refresh.</div>`;
    }
  } finally {
    loadingOverlay.classList.add('hidden');
  }
}

// ---- Events ----
function setupEvents() {
  document.getElementById('btn-refresh').addEventListener('click', fetchFromWeb);
  document.getElementById('btn-add').addEventListener('click', () => requirePin(() => openEdit(null)));
  document.getElementById('btn-back-edit').addEventListener('click', closeEdit);
  document.getElementById('btn-save').addEventListener('click', saveItem);
  document.getElementById('btn-delete').addEventListener('click', confirmDelete);
  document.getElementById('btn-clear-checks').addEventListener('click', () => {
    checkedItems.clear();
    renderList();
  });

  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentMode = tab.dataset.mode;
      document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      modeTitle.textContent = currentMode === 'inventory' ? 'Inventory' : 'Shopping';
      renderList();
    });
  });

  document.querySelectorAll('.pin-key').forEach(btn => {
    btn.addEventListener('click', () => handlePinKey(btn.dataset.key));
  });
  document.querySelector('.modal-backdrop').addEventListener('click', closePinModal);
}

// ---- Render ----
function renderList() {
  if (currentMode === 'inventory') renderInventory();
  else renderShopping();
}

function renderInventory() {
  shoppingBar.classList.add('hidden');

  const sorted = [...allItems].sort((a, b) => a.invSeq - b.invSeq);

  if (sorted.length === 0) {
    itemList.innerHTML = `<div class="empty-state">No items found. Tap + to add one.</div>`;
    return;
  }

  let html = '';
  sorted.forEach(item => {
    const qty      = Math.max(0, item.par - item.onHand);
    const qtyClass = qty > 0 ? 'need' : 'ok';
    html += `<div class="inv-item">
      <div class="inv-item-top">
        <div class="inv-item-name">${escHtml(item.description)}</div>
        <button class="edit-item-btn" data-id="${item.id}" title="Edit">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
      </div>
      <div class="inv-item-bottom">
        <span class="inv-meta">Par: ${item.par} · $${item.price.toFixed(2)}</span>
        <div class="qty-controls">
          <button class="qty-btn" data-id="${item.id}" data-action="minus">−</button>
          <input type="number" class="qty-display" data-id="${item.id}"
                 value="${item.onHand}" min="0" inputmode="numeric">
          <button class="qty-btn" data-id="${item.id}" data-action="plus">+</button>
        </div>
        <div class="qty-to-buy ${qtyClass}" title="Need to buy">${qty}</div>
      </div>
    </div>`;
  });

  itemList.innerHTML = html;

  // +/- buttons
  document.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id   = btn.dataset.id;
      const item = allItems.find(i => String(i.id) === id);
      if (!item) return;
      const delta = btn.dataset.action === 'plus' ? 1 : -1;
      const newVal = Math.max(0, item.onHand + delta);
      updateOnHand(id, newVal);
    });
  });

  // Direct input
  document.querySelectorAll('.qty-display').forEach(input => {
    input.addEventListener('change', () => {
      const id  = input.dataset.id;
      const val = Math.max(0, parseFloat(input.value) || 0);
      input.value = val;
      updateOnHand(id, val);
    });
    // Select all on focus for easy overtype
    input.addEventListener('focus', () => input.select());
  });

  // Edit buttons
  document.querySelectorAll('.edit-item-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = allItems.find(i => String(i.id) === btn.dataset.id);
      if (item) requirePin(() => openEdit(item));
    });
  });
}

function renderShopping() {
  // Shopping items — only where qtyToBuy > 0, sorted by shopSeq
  const shopItems = allItems
    .map(i => ({ ...i, qtyToBuy: Math.max(0, i.par - i.onHand) }))
    .filter(i => i.qtyToBuy > 0)
    .sort((a, b) => a.shopSeq - b.shopSeq);

  // Running total (unchecked items only)
  const total = shopItems
    .filter(i => !checkedItems.has(String(i.id)))
    .reduce((sum, i) => sum + (i.price * i.qtyToBuy), 0);

  const remaining = shopItems.filter(i => !checkedItems.has(String(i.id))).length;
  const checked   = shopItems.filter(i =>  checkedItems.has(String(i.id))).length;

  shoppingBar.classList.remove('hidden');
  shoppingSummary.textContent =
    `${remaining} items · Est. $${total.toFixed(2)} · ${checked} done`;

  if (shopItems.length === 0) {
    itemList.innerHTML = `<div class="empty-state">🎉 Nothing to buy!<br>Your pantry is fully stocked.</div>`;
    return;
  }

  let html = '';
  shopItems.forEach(item => {
    const isChecked = checkedItems.has(String(item.id));
    html += `<div class="shop-item${isChecked ? ' checked' : ''}" data-id="${item.id}">
      <div class="shop-check"></div>
      <div class="shop-item-info">
        <div class="shop-item-name">${escHtml(item.description)}</div>
        <div class="shop-item-price">$${item.price.toFixed(2)} each · Total: $${(item.price * item.qtyToBuy).toFixed(2)}</div>
      </div>
      <div class="shop-qty-badge">${item.qtyToBuy}</div>
    </div>`;
  });

  itemList.innerHTML = html;

  document.querySelectorAll('.shop-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      if (checkedItems.has(id)) checkedItems.delete(id);
      else checkedItems.add(id);
      el.classList.toggle('checked', checkedItems.has(id));
      // Update summary
      const remaining2 = shopItems.filter(i => !checkedItems.has(String(i.id))).length;
      const checked2   = shopItems.filter(i =>  checkedItems.has(String(i.id))).length;
      const total2 = shopItems
        .filter(i => !checkedItems.has(String(i.id)))
        .reduce((sum, i) => sum + (i.price * i.qtyToBuy), 0);
      shoppingSummary.textContent =
        `${remaining2} items · Est. $${total2.toFixed(2)} · ${checked2} done`;
    });
  });
}

// ---- Update On Hand ----
async function updateOnHand(id, newVal) {
  const item = allItems.find(i => String(i.id) === id);
  if (!item) return;

  const prev   = item.onHand;
  item.onHand  = newVal;
  item.qtyToBuy = Math.max(0, item.par - newVal);
  saveLocal();
  renderList();

  try {
    const res  = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'updateOnHand', id, onHand: newVal })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
  } catch(err) {
    console.error('Save failed:', err);
    item.onHand   = prev;
    item.qtyToBuy = Math.max(0, item.par - prev);
    saveLocal();
    renderList();
  }
}

// ---- Edit / Add ----
function openEdit(item) {
  currentItem = item;
  const isNew = !item;
  document.getElementById('edit-title').textContent = isNew ? 'Add Item' : 'Edit Item';
  document.getElementById('btn-delete').classList.toggle('hidden', isNew);

  const i = item || { description:'', par:1, invSeq:0, shopSeq:0, price:0, onHand:0 };

  editContent.innerHTML = `
    <div class="form-section">
      <div class="form-section-title">Item Details</div>
      <div class="form-row">
        <label class="form-label">Description</label>
        <input class="form-input" id="f-description" value="${escHtml(i.description)}" placeholder="Item name">
      </div>
      <div class="form-row-3">
        <div>
          <label class="form-label">Par</label>
          <input class="form-input" id="f-par" type="number" value="${i.par}" min="0" inputmode="numeric">
        </div>
        <div>
          <label class="form-label">On Hand</label>
          <input class="form-input" id="f-onhand" type="number" value="${i.onHand}" min="0" inputmode="numeric">
        </div>
        <div>
          <label class="form-label">Price</label>
          <input class="form-input" id="f-price" type="number" value="${i.price}" min="0" step="0.01" inputmode="decimal">
        </div>
      </div>
    </div>
    <div class="form-section">
      <div class="form-section-title">Sequences</div>
      <div class="form-row-3">
        <div>
          <label class="form-label">Inv Seq</label>
          <input class="form-input" id="f-invseq" type="number" value="${i.invSeq}" min="0" inputmode="numeric">
        </div>
        <div>
          <label class="form-label">Shop Seq</label>
          <input class="form-input" id="f-shopseq" type="number" value="${i.shopSeq}" min="0" inputmode="numeric">
        </div>
        <div></div>
      </div>
    </div>`;

  screenMain.classList.add('slide-out');
  screenEdit.classList.add('active');
  editContent.scrollTop = 0;
}

function closeEdit() {
  screenEdit.classList.remove('active');
  screenMain.classList.remove('slide-out');
  currentItem = null;
}

async function saveItem() {
  const pin = sessionStorage.getItem(SESSION_PIN);
  if (!pin) { requirePin(() => saveItem()); return; }

  const itemData = {
    description: document.getElementById('f-description').value.trim(),
    par:         parseFloat(document.getElementById('f-par').value)     || 0,
    onHand:      parseFloat(document.getElementById('f-onhand').value)  || 0,
    price:       parseFloat(document.getElementById('f-price').value)   || 0,
    invSeq:      parseFloat(document.getElementById('f-invseq').value)  || 0,
    shopSeq:     parseFloat(document.getElementById('f-shopseq').value) || 0,
  };
  itemData.qtyToBuy = Math.max(0, itemData.par - itemData.onHand);

  if (!itemData.description) { alert('Description is required.'); return; }

  const isNew  = !currentItem;
  const saveBtn = document.getElementById('btn-save');
  saveBtn.textContent = 'Saving…';
  saveBtn.disabled    = true;

  const body = isNew
    ? { action: 'addItem', pin, item: itemData }
    : { action: 'updateItem', pin, id: currentItem.id, item: itemData };

  try {
    const res  = await fetch(API_URL, { method: 'POST', body: JSON.stringify(body) });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    if (isNew) {
      itemData.id = String(data.id);
      allItems.push(itemData);
    } else {
      const idx = allItems.findIndex(i => String(i.id) === String(currentItem.id));
      if (idx >= 0) allItems[idx] = { ...allItems[idx], ...itemData };
    }
    saveLocal();
    closeEdit();
    renderList();
  } catch(err) {
    alert('Save failed: ' + err.message);
  } finally {
    saveBtn.textContent = 'Save';
    saveBtn.disabled    = false;
  }
}

async function confirmDelete() {
  const pin = sessionStorage.getItem(SESSION_PIN);
  if (!pin) { requirePin(() => confirmDelete()); return; }
  if (!currentItem) return;
  if (!confirm(`Delete "${currentItem.description}"?`)) return;

  try {
    const res  = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'deleteItem', pin, id: currentItem.id })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    allItems = allItems.filter(i => String(i.id) !== String(currentItem.id));
    saveLocal();
    closeEdit();
    renderList();
  } catch(err) {
    alert('Delete failed: ' + err.message);
  }
}

// ---- PIN ----
let pinBuffer = '';

function requirePin(callback) {
  if (sessionStorage.getItem(SESSION_PIN)) { callback(); return; }
  pendingAction = callback;
  pinBuffer = '';
  updatePinDots();
  pinError.classList.add('hidden');
  pinModal.classList.remove('hidden');
}

function handlePinKey(key) {
  if (key === 'cancel') { closePinModal(); return; }
  if (key === 'delete') { pinBuffer = pinBuffer.slice(0,-1); updatePinDots(); return; }
  if (pinBuffer.length >= 4) return;
  pinBuffer += key;
  updatePinDots();
  if (pinBuffer.length === 4) verifyPin();
}

function verifyPin() {
  if (pinBuffer === '1234') {
    sessionStorage.setItem(SESSION_PIN, pinBuffer);
    closePinModal();
    if (pendingAction) { pendingAction(); pendingAction = null; }
  } else {
    pinError.classList.remove('hidden');
    pinBuffer = '';
    updatePinDots();
    setTimeout(() => pinError.classList.add('hidden'), 2000);
  }
}

function updatePinDots() {
  for (let i = 0; i < 4; i++) {
    document.getElementById(`dot-${i}`).classList.toggle('filled', i < pinBuffer.length);
  }
}

function closePinModal() {
  pinModal.classList.add('hidden');
  pinBuffer = '';
  updatePinDots();
  pendingAction = null;
}

// ---- Helpers ----
function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(allItems));
}

function showLastUpdated() {
  const ts = localStorage.getItem(STORAGE_UPDATED);
  lastUpdated.textContent = ts ? `Updated ${ts}` : '';
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
