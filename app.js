const DB_NAME = 'monthly-budget-pwa';
const DB_VERSION = 1;
const DEFAULT_GROUPS = [{ id: 'credit', name: 'クレジット' }, { id: 'gasoline', name: 'ガソリン' }];
const $ = id => document.getElementById(id);
const state = { groups: [], budgets: [], expenses: [], groupId: 'credit', month: '', period: 1, settingsMonth: '', settingsGroupId: 'credit', editId: null };

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('groups', { keyPath: 'id' });
      db.createObjectStore('budgets', { keyPath: 'key' });
      db.createObjectStore('expenses', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function allRecords(storeName) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName).objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function putRecord(storeName, value) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readwrite').objectStore(storeName).put(value);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
async function deleteRecord(storeName, key) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readwrite').objectStore(storeName).delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
function localMonth(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; }
function localDate(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function monthParts(month) { const [year, number] = month.split('-').map(Number); return { year, number }; }
function daysInMonth(month) { const { year, number } = monthParts(month); return new Date(year, number, 0).getDate(); }
function getPeriods(month) {
  const total = daysInMonth(month), base = Math.floor(total / 4), extra = total % 4;
  const extraSlots = { 0: [], 1: [0], 2: [0, 3], 3: [0, 1, 3] }[extra];
  let start = 1;
  return Array.from({ length: 4 }, (_, index) => {
    const length = base + (extraSlots.includes(index) ? 1 : 0), result = { start, end: start + length - 1 };
    start = result.end + 1;
    return result;
  });
}
function periodForDate(dateText) {
  const [year, month, day] = dateText.split('-').map(Number), monthKey = `${year}-${String(month).padStart(2, '0')}`;
  return getPeriods(monthKey).findIndex(period => day >= period.start && day <= period.end) + 1;
}
function formatMonth(month) { const { year, number } = monthParts(month); return `${year}年${number}月`; }
function formatYen(value) { return `${Number(value).toLocaleString('ja-JP')}円`; }
function moveMonth(month, delta) { const { year, number } = monthParts(month), date = new Date(year, number - 1 + delta, 1); return localMonth(date); }
function movePeriod(delta) {
  let next = state.period + delta;
  if (next < 1) { state.month = moveMonth(state.month, -1); next = 4; }
  if (next > 4) { state.month = moveMonth(state.month, 1); next = 1; }
  state.period = next;
}
function currentBudget() { return state.budgets.find(item => item.groupId === state.groupId && item.month === state.month && item.period === state.period); }
function periodExpenses() {
  const range = getPeriods(state.month)[state.period - 1];
  return state.expenses.filter(expense => expense.groupId === state.groupId && expense.date.startsWith(`${state.month}-`)).filter(expense => {
    const day = Number(expense.date.slice(-2)); return day >= range.start && day <= range.end;
  }).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function render() {
  if (!state.groups.some(group => group.id === state.groupId)) state.groupId = state.groups[0]?.id;
  $('group-tabs').innerHTML = state.groups.map(group => `<button class="group-tab ${group.id === state.groupId ? 'active' : ''}" data-group="${escapeHtml(group.id)}">${escapeHtml(group.name)}</button>`).join('');
  $('month-label').textContent = formatMonth(state.month);
  const range = getPeriods(state.month)[state.period - 1];
  $('period-label').textContent = `第${state.period}期間`;
  $('period-dates').textContent = `${monthParts(state.month).number}月${range.start}日〜${range.end}日`;
  const budget = currentBudget(), expenses = periodExpenses(), spent = expenses.reduce((sum, item) => sum + item.amount, 0);
  $('budget-value').textContent = budget ? formatYen(budget.amount) : '予算未設定';
  $('spent-value').textContent = formatYen(spent);
  const remaining = budget ? budget.amount - spent : null, exceeded = remaining !== null && remaining < 0;
  $('remaining-title').textContent = exceeded ? '超過' : '残り';
  $('remaining-value').textContent = remaining === null ? '—' : formatYen(Math.abs(remaining));
  $('summary-card').classList.toggle('exceeded', exceeded);
  $('over-budget').hidden = !exceeded;
  $('over-budget').textContent = exceeded ? `予算を${formatYen(Math.abs(remaining))}超えています` : '';
  const rate = budget && budget.amount > 0 ? spent / budget.amount * 100 : null;
  $('rate-label').textContent = rate === null ? (budget ? '予算0円' : '') : `予算消化率 ${rate.toFixed(1)}%`;
  $('progress-bar').style.width = `${Math.min(100, rate || 0)}%`;
  $('expense-list').innerHTML = expenses.length ? expenses.map(item => `<article class="expense-item"><div class="expense-info"><strong>${escapeHtml(item.memo || '（メモなし）')}</strong><small>${escapeHtml(item.date.replaceAll('-', '/'))}</small></div><div class="expense-actions"><strong>${formatYen(item.amount)}</strong><button data-edit="${escapeHtml(item.id)}">編集</button><button data-delete="${escapeHtml(item.id)}">削除</button></div></article>`).join('') : '<div class="empty-state">この期間の支出はありません</div>';
  renderSettings();
}
function renderSettings() {
  $('settings-month-label').textContent = formatMonth(state.settingsMonth || state.month);
  $('group-settings-list').innerHTML = state.groups.map(group => `<div class="group-setting"><span>${escapeHtml(group.name)}</span><button data-remove-group="${escapeHtml(group.id)}">削除</button></div>`).join('');
  $('group-settings-list').querySelectorAll('[data-remove-group]').forEach(button => { button.disabled = state.groups.length <= 1; button.title = button.disabled ? '予算枠は1つ以上必要です' : 'この予算枠と関連データを削除'; });
  $('group-add-form').querySelector('button').disabled = state.groups.length >= 4;
  $('group-name').disabled = state.groups.length >= 4;
  if (!state.groups.some(group => group.id === state.settingsGroupId)) state.settingsGroupId = state.groupId;
  if (!state.groups.some(group => group.id === state.settingsGroupId)) state.settingsGroupId = state.groups[0]?.id;
  $('settings-group').innerHTML = state.groups.map(group => `<option value="${escapeHtml(group.id)}" ${group.id === state.settingsGroupId ? 'selected' : ''}>${escapeHtml(group.name)}</option>`).join('');
  const selected = state.settingsGroupId;
  $('budget-inputs').innerHTML = [1, 2, 3, 4].map(period => {
    const item = state.budgets.find(budget => budget.groupId === selected && budget.month === state.settingsMonth && budget.period === period);
    return `<label class="budget-input-row"><span>第${period}期間</span><input type="number" min="0" step="1" inputmode="numeric" data-budget-period="${period}" value="${item ? item.amount : ''}" placeholder="未設定"></label>`;
  }).join('');
  updateBudgetTotal();
}
function updateBudgetTotal() {
  let total = 0, count = 0;
  document.querySelectorAll('[data-budget-period]').forEach(input => { if (input.value !== '') { total += Number(input.value) || 0; count++; } });
  let node = $('budget-total');
  if (!node) { node = document.createElement('div'); node.id = 'budget-total'; node.className = 'budget-total'; $('budget-inputs').after(node); }
  node.textContent = `設定済み合計 ${formatYen(total)}${count < 4 ? '（未設定の期間あり）' : ''}`;
}
async function reload() { [state.groups, state.budgets, state.expenses] = await Promise.all([allRecords('groups'), allRecords('budgets'), allRecords('expenses')]); render(); }
function showDialog(id) { $(id).showModal(); }
function closeDialog(id) { $(id).close(); }
function openExpense(id = null) {
  state.editId = id;
  const record = id ? state.expenses.find(item => item.id === id) : null;
  $('expense-dialog-title').textContent = record ? '支出を編集' : '支出を追加';
  $('expense-amount').value = record?.amount ?? '';
  $('expense-date').value = record?.date ?? localDate();
  $('expense-memo').value = record?.memo ?? '';
  $('form-error').textContent = '';
  showDialog('expense-dialog');
}
async function saveExpense(event) {
  event.preventDefault();
  const amountText = $('expense-amount').value.trim(), amount = Number(amountText), date = $('expense-date').value, memo = $('expense-memo').value.trim();
  const [dateYear, dateMonth, dateDay] = date.split('-').map(Number);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && dateMonth >= 1 && dateMonth <= 12 && dateDay >= 1 && dateDay <= new Date(dateYear, dateMonth, 0).getDate();
  if (!amountText || !Number.isSafeInteger(amount) || amount <= 0) { $('form-error').textContent = '金額は1円以上の整数で入力してください。'; return; }
  if (!validDate) { $('form-error').textContent = '有効な日付を入力してください。'; return; }
  const old = state.editId ? state.expenses.find(item => item.id === state.editId) : null;
  const record = { id: old?.id || crypto.randomUUID(), groupId: old?.groupId || state.groupId, date, amount, memo, createdAt: old?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
  await putRecord('expenses', record);
  state.month = date.slice(0, 7); state.period = periodForDate(date);
  closeDialog('expense-dialog'); await reload();
}
async function saveBudgets() {
  $('budget-error').textContent = '';
  const inputs = [...document.querySelectorAll('[data-budget-period]')];
  if (inputs.some(input => input.value !== '' && (!Number.isSafeInteger(Number(input.value)) || Number(input.value) < 0))) { $('budget-error').textContent = '予算は0円以上の整数で入力してください。'; return; }
  const groupId = state.settingsGroupId, month = state.settingsMonth;
  for (const input of inputs) {
    const key = `${groupId}|${month}|${input.dataset.budgetPeriod}`;
    if (input.value === '') await deleteRecord('budgets', key);
    else await putRecord('budgets', { key, groupId, month, period: Number(input.dataset.budgetPeriod), amount: Number(input.value) });
  }
  await reload();
}
async function removeGroup(groupId) {
  const group = state.groups.find(item => item.id === groupId);
  if (!group || state.groups.length <= 1) return;
  if (!confirm(`「${group.name}」と、この枠の予算・支出をすべて削除します。この操作は取り消せません。よろしいですか？`)) return;
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['groups', 'budgets', 'expenses'], 'readwrite');
    tx.objectStore('groups').delete(groupId);
    for (const budget of state.budgets.filter(item => item.groupId === groupId)) tx.objectStore('budgets').delete(budget.key);
    for (const expense of state.expenses.filter(item => item.groupId === groupId)) tx.objectStore('expenses').delete(expense.id);
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
  if (state.groupId === groupId) state.groupId = state.groups.find(item => item.id !== groupId)?.id;
  await reload();
}
function bindEvents() {
  $('group-tabs').addEventListener('click', event => { const button = event.target.closest('[data-group]'); if (button) { state.groupId = button.dataset.group; render(); } });
  $('month-prev').addEventListener('click', () => { state.month = moveMonth(state.month, -1); render(); });
  $('month-next').addEventListener('click', () => { state.month = moveMonth(state.month, 1); render(); });
  $('period-prev').addEventListener('click', () => { movePeriod(-1); render(); });
  $('period-next').addEventListener('click', () => { movePeriod(1); render(); });
  $('expense-add').addEventListener('click', () => openExpense());
  $('expense-list').addEventListener('click', async event => {
    const edit = event.target.closest('[data-edit]'), remove = event.target.closest('[data-delete]');
    if (edit) openExpense(edit.dataset.edit);
    if (remove && confirm('この支出を削除しますか？')) { await deleteRecord('expenses', remove.dataset.delete); await reload(); }
  });
  $('expense-form').addEventListener('submit', event => saveExpense(event).catch(showStorageError));
  $('settings-open').addEventListener('click', () => { state.settingsMonth = state.month; state.settingsGroupId = state.groupId; renderSettings(); showDialog('settings-dialog'); });
  $('budget-edit').addEventListener('click', () => { state.settingsMonth = state.month; state.settingsGroupId = state.groupId; renderSettings(); showDialog('settings-dialog'); });
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => closeDialog(button.dataset.close)));
  $('settings-month-prev').addEventListener('click', () => { state.settingsMonth = moveMonth(state.settingsMonth, -1); renderSettings(); });
  $('settings-month-next').addEventListener('click', () => { state.settingsMonth = moveMonth(state.settingsMonth, 1); renderSettings(); });
  $('settings-group').addEventListener('change', event => { state.settingsGroupId = event.target.value; renderSettings(); });
  $('budget-inputs').addEventListener('input', updateBudgetTotal);
  $('budget-save').addEventListener('click', () => saveBudgets().catch(showStorageError));
  $('group-add-form').addEventListener('submit', async event => {
    event.preventDefault(); $('group-error').textContent = '';
    const name = $('group-name').value.trim();
    if (!name) { $('group-error').textContent = '予算枠の名前を入力してください。'; return; }
    if (state.groups.length >= 4) { $('group-error').textContent = '予算枠は4つまでです。'; return; }
    if (state.groups.some(group => group.name.toLocaleLowerCase() === name.toLocaleLowerCase())) { $('group-error').textContent = '同じ名前の予算枠があります。'; return; }
    const group = { id: crypto.randomUUID(), name }; await putRecord('groups', group); state.groupId = group.id; $('group-name').value = ''; await reload();
  });
  $('group-settings-list').addEventListener('click', event => { const button = event.target.closest('[data-remove-group]'); if (button) removeGroup(button.dataset.removeGroup).catch(showStorageError); });
}
function showStorageError(error) { console.error(error); alert('データを保存できませんでした。端末の空き容量とブラウザ設定を確認してください。'); }
async function init() {
  if (!('indexedDB' in window)) { document.body.innerHTML = '<p style="padding:24px">このブラウザではローカル保存を利用できません。</p>'; return; }
  const saved = await allRecords('groups');
  if (!saved.length) for (const group of DEFAULT_GROUPS) await putRecord('groups', group);
  const today = new Date(); state.month = localMonth(today); state.settingsMonth = state.month; state.period = periodForDate(`${state.month}-${String(today.getDate()).padStart(2, '0')}`);
  bindEvents(); await reload();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./service-worker.js').catch(error => console.warn('Service Worker registration failed', error));
}
init().catch(showStorageError);
