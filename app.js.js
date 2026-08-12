// ========================================================================
// UNION CNC PWA - FULL APP (Performance Enhanced)
// ========================================================================
const API_URL = 'https://script.google.com/macros/s/AKfycbw7j1vijV2Zr18oxpakcFG6x3Rv8aCaMTORzyALA0otdpDOJN_dhBniMDSmzr4jSeH3Yw/exec'; // سيتم تحديثه
let currentToken = localStorage.getItem('token') || '';
let currentUserId = localStorage.getItem('userId') || 1;
let selectedInstId = null;
let selectedOrderForVisit = null;
let gpsCoords = '';
let salesChartInstance = null, maintenanceChartInstance = null;

// ==================== IndexedDB Cache ====================
const DB_NAME = 'UnionCNC_Cache';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('cache')) {
        db.createObjectStore('cache', { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getCached(key) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('cache', 'readonly');
      const store = tx.objectStore('cache');
      const get = store.get(key);
      get.onsuccess = () => {
        const entry = get.result;
        if (entry && entry.expiry > Date.now()) resolve(entry.value);
        else resolve(null);
      };
      get.onerror = () => resolve(null);
    });
  } catch(e) { return null; }
}

async function setCached(key, value, ttlMs = 300000) {
  try {
    const db = await openDB();
    const tx = db.transaction('cache', 'readwrite');
    const store = tx.objectStore('cache');
    store.put({ key, value, expiry: Date.now() + ttlMs });
  } catch(e) { /* ignore */ }
}

// ==================== API Call with Cache ====================
async function callAPI(action, data = {}) {
  const cacheKey = `api_${action}_${JSON.stringify(data)}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  const payload = { action, ...data };
  if (currentToken) payload.token = currentToken;
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (result.status === 'success' && !action.includes('record') && !action.includes('add') && !action.includes('create')) {
      await setCached(cacheKey, result, 60000); // 1 دقيقة
    }
    return result;
  } catch (e) {
    return { status: 'offline', msg: 'غير متصل، تم الحفظ محلياً' };
  }
}

// ==================== Authentication ====================
async function login() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const res = await callAPI('login', { email, password });
  if (res.status === 'success') {
    currentToken = res.token;
    currentUserId = res.userId;
    localStorage.setItem('token', res.token);
    localStorage.setItem('userId', res.userId);
    localStorage.setItem('userName', res.name);
    showDashboard();
  } else {
    document.getElementById('loginError').innerText = res.msg;
  }
}
function logout() { localStorage.clear(); location.reload(); }

// ==================== Dashboard ====================
async function showDashboard() {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('dashboardScreen').classList.add('active');
  document.getElementById('userName').innerText = localStorage.getItem('userName') || 'مدير';
  // تحميل دفعة واحدة
  const batch = await callAPI('batch', {
    requests: {
      stats: { action: 'getDashboard' },
      customers: { action: 'getCustomers' },
      bankAccounts: { action: 'getBankAccounts' },
      notifications: { action: 'getNotifications', userId: currentUserId }
    }
  });
  if (batch.status === 'success') {
    const data = batch.data;
    if (data.stats && data.stats.status === 'success') updateStats(data.stats.data);
    if (data.customers && data.customers.status === 'success') renderCustomers(data.customers.data);
    if (data.bankAccounts && data.bankAccounts.status === 'success') renderBankAccounts(data.bankAccounts.data);
    if (data.notifications && data.notifications.status === 'success') renderNotifications(data.notifications.data);
  }
  // تحميل باقي التبويبات
  await loadContractSelect();
  await loadEmployeesForSelect();
  await loadAllReports();
}

function updateStats(d) {
  document.getElementById('statRevenue').innerText = d.totalRevenueEGP.toFixed(0) + ' EGP';
  document.getElementById('statDueSoon').innerText = d.dueSoonInstallments;
  document.getElementById('statOverdue').innerText = d.overdueInstallments;
}

function renderCustomers(customers) {
  const container = document.getElementById('customerList');
  container.innerHTML = '';
  const select = document.getElementById('custSelect');
  select.innerHTML = '<option value="">اختر عميل</option>';
  customers.forEach(c => {
    const div = document.createElement('div');
    div.className = 'list-item';
    div.innerHTML = `<div class="info"><strong>${c.name}</strong><small>${c.phone}</small></div>`;
    container.appendChild(div);
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.text = c.name;
    select.appendChild(opt);
  });
  // تحديث قائمة العملاء في الصيانة
  const assetSelect = document.getElementById('assetCustomer');
  assetSelect.innerHTML = '<option value="">اختر العميل</option>';
  customers.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.text = c.name;
    assetSelect.appendChild(opt);
  });
}

function renderBankAccounts(accounts) {
  const select = document.getElementById('payBankAccount');
  select.innerHTML = '<option value="">اختر الخزينة</option>';
  accounts.forEach(acc => {
    const opt = document.createElement('option');
    opt.value = acc.id;
    opt.text = `${acc.name} (${acc.currency}) - ${acc.balance}`;
    select.appendChild(opt);
  });
}

function renderNotifications(notifs) {
  const list = document.getElementById('notifList');
  const badge = document.getElementById('notifBadge');
  const unread = notifs.filter(n => n.isRead === 'FALSE' || n.isRead === false);
  if (unread.length > 0) {
    badge.style.display = 'inline';
    badge.innerText = unread.length;
  } else {
    badge.style.display = 'none';
  }
  list.innerHTML = '';
  if (notifs.length === 0) {
    list.innerHTML = '<div style="color:gray;padding:10px;">لا توجد إشعارات</div>';
  } else {
    notifs.slice(0, 10).forEach(n => {
      const div = document.createElement('div');
      div.style.cssText = `padding:10px; border-bottom:1px solid #222; background:${n.isRead === 'TRUE' ? 'transparent' : '#2a2a35'}; border-radius:8px; cursor:pointer;`;
      div.onclick = () => markRead(n.id);
      div.innerHTML = `<strong>${n.title}</strong><br><small>${n.message}</small><br><span style="color:gray;font-size:0.6rem;">${new Date(n.createdAt).toLocaleString()}</span>`;
      list.appendChild(div);
    });
  }
}

async function markRead(id) {
  await callAPI('markNotificationRead', { notificationId: id });
  const notifs = await callAPI('getNotifications', { userId: currentUserId });
  if (notifs.status === 'success') renderNotifications(notifs.data);
}

function toggleNotifications() {
  const dropdown = document.getElementById('notifDropdown');
  dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
}

// ==================== Tab Switching ====================
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  const btnIndex = { 'sales': 0, 'maintenance': 1, 'hr': 2, 'reports': 3 };
  document.querySelectorAll('.tab-btn')[btnIndex[tab]].classList.add('active');
  document.getElementById(tab + 'Tab').classList.add('active');
  if (tab === 'sales') { loadInstallments(); }
  else if (tab === 'maintenance') { loadAssets(); loadOrders(); loadEngineersForSelect(); }
  else if (tab === 'hr') { loadLoans(); loadPayrolls(); getGPSLocation(); }
  else if (tab === 'reports') { loadAllReports(); }
}

// ==================== Customers ====================
function refreshCustomers() { showDashboard(); }

// ==================== Contracts & Installments ====================
async function createContract() {
  const customerId = document.getElementById('custSelect').value;
  const totalUSD = parseFloat(document.getElementById('totalUSD').value);
  const rate = parseFloat(document.getElementById('rateInput').value) || 48.5;
  const num = parseInt(document.getElementById('instCount').value) || 6;
  if (!customerId || !totalUSD) { alert('املأ جميع الحقول'); return; }
  const res = await callAPI('addContract', {
    data: {
      customerId: parseInt(customerId),
      date: new Date().toISOString().split('T')[0],
      totalUSD, exchangeRate: rate, numInstallments: num,
      createdBy: parseInt(currentUserId)
    }
  });
  document.getElementById('contractMsg').innerText = res.msg;
  if (res.status === 'success') {
    await loadContractSelect();
    document.getElementById('totalUSD').value = '';
    showDashboard(); // تحديث الإحصائيات
  }
}

async function loadContractSelect() {
  // نأخذ العقود من جدول الأقساط بطريقة مبسطة: نجلب كل العقود من خلال getContractDetails لجميع العقود؟ لكننا سنضيف دالة getContractsList
  // بدلاً من ذلك، نستخدم طريقة مباشرة: نقرأ من جدول Contracts
  // سنضيف دالة getContractsList في الـ Backend ونستدعيها هنا
  try {
    const res = await callAPI('getContractsList');
    if (res.status === 'success') {
      const select = document.getElementById('contractSelect');
      select.innerHTML = '<option value="">اختر عقداً</option>';
      res.data.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.text = `عقد #${c.id} - ${c.status}`;
        select.appendChild(opt);
      });
    }
  } catch(e) { /* تجاهل */ }
}

async function loadInstallments() {
  const contractId = document.getElementById('contractSelect').value;
  if (!contractId) return;
  const res = await callAPI('getContractDetails', { contractId: parseInt(contractId) });
  if (res.status === 'success') {
    const container = document.getElementById('installmentContainer');
    container.innerHTML = '';
    res.data.forEach(inst => {
      const div = document.createElement('div');
      div.className = 'list-item';
      const dueDate = new Date(inst.dueDate).toLocaleDateString('ar-EG');
      div.innerHTML = `
        <div class="info">
          <strong>قسط #${inst.num} - ${inst.amountUSD} USD (${inst.amountEGP} EGP)</strong>
          <small>تاريخ الاستحقاق: ${dueDate} | المدفوع: ${inst.paidUSD} USD</small>
        </div>
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <span class="status-badge ${inst.status}">${inst.status}</span>
          ${inst.status !== 'مسدد' ? `<button class="pay-btn" onclick="openPaymentModal(${inst.id}, ${inst.num}, ${inst.amountUSD}, ${inst.amountEGP})">دفع</button>` : ''}
        </div>
      `;
      container.appendChild(div);
    });
  }
}

function openPaymentModal(instId, num, dueUSD, dueEGP) {
  selectedInstId = instId;
  document.getElementById('modalInstNum').innerText = num;
  document.getElementById('modalDueUSD').innerText = dueUSD;
  document.getElementById('modalDueEGP').innerText = dueEGP;
  document.getElementById('payUSD').value = dueUSD;
  document.getElementById('payEGP').value = dueEGP;
  callAPI('getExchangeRate').then(res => {
    if (res.status === 'success') document.getElementById('payRate').value = res.rate;
  });
  document.getElementById('paymentModal').classList.remove('hidden');
}

function closeModal() { document.getElementById('paymentModal').classList.add('hidden'); }

async function confirmPayment() {
  const paidUSD = parseFloat(document.getElementById('payUSD').value);
  const paidEGP = parseFloat(document.getElementById('payEGP').value);
  const rate = parseFloat(document.getElementById('payRate').value);
  const bankAccountId = document.getElementById('payBankAccount').value;
  if (!paidUSD || !paidEGP || !rate || !bankAccountId) { alert('املأ جميع الحقول'); return; }
  const res = await callAPI('recordPayment', {
    data: {
      installmentId: selectedInstId,
      paidUSD, paidEGP,
      exchangeRate: rate,
      bankAccountId: parseInt(bankAccountId),
      paymentDate: new Date().toISOString().split('T')[0]
    }
  });
  document.getElementById('payMsg').innerText = res.msg;
  if (res.status === 'success') {
    setTimeout(() => { closeModal(); loadInstallments(); showDashboard(); loadNotifications(); }, 1500);
  }
}

// ==================== Maintenance ====================
async function addAsset() {
  const serial = document.getElementById('assetSerial').value;
  const product = document.getElementById('assetProduct').value;
  const customerId = document.getElementById('assetCustomer').value;
  const purchase = document.getElementById('assetPurchase').value;
  const warranty = document.getElementById('assetWarranty').value;
  if (!serial || !product || !customerId) { alert('املأ الحقول الأساسية'); return; }
  const res = await callAPI('addAsset', {
    data: { serialNumber: serial, productId: product, customerId: parseInt(customerId),
            purchaseDate: purchase, warrantyExpiry: warranty, status: 'في المخزن' }
  });
  document.getElementById('assetMsg').innerText = res.msg;
  if (res.status === 'success') loadAssets();
}

async function loadAssets() {
  const res = await callAPI('getAssets');
  if (res.status === 'success') {
    const container = document.getElementById('assetList');
    const select = document.getElementById('orderAsset');
    container.innerHTML = '';
    select.innerHTML = '<option value="">اختر ماكينة</option>';
    res.data.forEach(a => {
      const div = document.createElement('div');
      div.className = 'list-item';
      div.innerHTML = `<div class="info"><strong>${a.serial}</strong><small>الحالة: ${a.status}</small></div>`;
      container.appendChild(div);
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.text = `${a.serial} - ${a.status}`;
      select.appendChild(opt);
    });
  }
}

async function loadEngineersForSelect() {
  const res = await callAPI('getEmployees');
  if (res.status === 'success') {
    const select = document.getElementById('orderEngineer');
    select.innerHTML = '<option value="">اختر المهندس</option>';
    res.data.forEach(emp => {
      const opt = document.createElement('option');
      opt.value = emp.id;
      opt.text = emp.name;
      select.appendChild(opt);
    });
  }
}

async function createOrder() {
  const assetId = document.getElementById('orderAsset').value;
  const engineerId = document.getElementById('orderEngineer').value;
  const issue = document.getElementById('orderIssue').value;
  const priority = document.getElementById('orderPriority').value;
  const schedule = document.getElementById('orderSchedule').value;
  if (!assetId || !issue) { alert('املأ الحقول الأساسية'); return; }
  const assetsRes = await callAPI('getAssets');
  let customerId = null;
  if (assetsRes.status === 'success') {
    const asset = assetsRes.data.find(a => a.id == assetId);
    if (asset) customerId = asset.customerId;
  }
  const res = await callAPI('createMaintenanceOrder', {
    data: {
      assetId: parseInt(assetId), customerId: parseInt(customerId),
      reportedDate: new Date().toISOString().split('T')[0],
      issueDescription: issue, priority, assignedTo: parseInt(engineerId) || '',
      scheduledDate: schedule, createdBy: parseInt(currentUserId)
    }
  });
  document.getElementById('orderMsg').innerText = res.msg;
  if (res.status === 'success') loadOrders();
}

async function loadOrders() {
  const filter = document.getElementById('filterOrders').value;
  const statusParam = filter === 'all' ? null : filter;
  const res = await callAPI('getMaintenanceOrders', { status: statusParam });
  if (res.status === 'success') {
    const container = document.getElementById('orderList');
    container.innerHTML = '';
    res.data.forEach(o => {
      const div = document.createElement('div');
      div.className = 'list-item';
      const statusColor = o.status === 'مفتوح' ? 'yellow' : (o.status === 'قيد التنفيذ' ? 'orange' : 'green');
      div.innerHTML = `
        <div class="info">
          <strong>#${o.id} - ${o.issue.substring(0,30)}</strong>
          <small>الأولوية: ${o.priority} | الحالة: <span style="color:${statusColor};">${o.status}</span></small>
        </div>
        ${o.status !== 'مغلق' ? `<button class="pay-btn" onclick="openVisitModal(${o.id})">تسجيل زيارة</button>` : ''}
      `;
      container.appendChild(div);
    });
  }
}

function openVisitModal(orderId) {
  selectedOrderForVisit = orderId;
  document.getElementById('visitOrderId').value = orderId;
  document.getElementById('visitModal').classList.remove('hidden');
  getGPSLocation();
  initSignaturePad();
}
function closeVisitModal() { document.getElementById('visitModal').classList.add('hidden'); }

function getGPSLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      gpsCoords = `${pos.coords.latitude}, ${pos.coords.longitude}`;
      document.getElementById('visitGPS').innerText = `📍 ${gpsCoords}`;
      document.getElementById('liveGPS').innerText = `📍 ${gpsCoords}`;
    }, () => {
      document.getElementById('visitGPS').innerText = '⚠️ لم يتم تحديد الموقع';
      document.getElementById('liveGPS').innerText = '⚠️ لم يتم تحديد الموقع';
    });
  } else {
    document.getElementById('visitGPS').innerText = '⚠️ GPS غير مدعوم';
    document.getElementById('liveGPS').innerText = '⚠️ GPS غير مدعوم';
  }
}

function initSignaturePad() {
  const canvas = document.getElementById('signatureCanvas');
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth * 2;
  canvas.height = canvas.offsetHeight * 2;
  ctx.scale(2, 2);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  let isDrawing = false, lastX = 0, lastY = 0;
  function startDraw(e) {
    isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX || e.touches[0].clientX) - rect.left;
    const y = (e.clientY || e.touches[0].clientY) - rect.top;
    lastX = x; lastY = y;
  }
  function draw(e) {
    if (!isDrawing) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX || e.touches[0].clientX) - rect.left;
    const y = (e.clientY || e.touches[0].clientY) - rect.top;
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    lastX = x; lastY = y;
  }
  function endDraw() { isDrawing = false; }
  canvas.addEventListener('mousedown', startDraw);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', endDraw);
  canvas.addEventListener('mouseleave', endDraw);
  canvas.addEventListener('touchstart', startDraw, { passive: false });
  canvas.addEventListener('touchmove', draw, { passive: false });
  canvas.addEventListener('touchend', endDraw);
}

function clearSignature() {
  const canvas = document.getElementById('signatureCanvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  document.getElementById('signatureData').value = '';
}

function saveSignature() {
  const canvas = document.getElementById('signatureCanvas');
  const dataUrl = canvas.toDataURL('image/png');
  if (dataUrl.length < 1000) { alert('الرجاء التوقيع أولاً'); return; }
  document.getElementById('signatureData').value = dataUrl;
  alert('تم حفظ التوقيع');
}

function readFilesAsBase64(files) {
  return new Promise((resolve) => {
    const readers = [];
    for (let i=0; i<files.length; i++) {
      readers.push(new Promise((res) => {
        const reader = new FileReader();
        reader.onload = (e) => res(e.target.result);
        reader.readAsDataURL(files[i]);
      }));
    }
    Promise.all(readers).then(resolve);
  });
}

async function submitVisit() {
  const orderId = document.getElementById('visitOrderId').value;
  const notes = document.getElementById('visitNotes').value;
  const signature = document.getElementById('signatureData').value;
  const files = document.getElementById('visitPhotos').files;
  if (!gpsCoords) { alert('الرجاء تحديد الموقع'); return; }
  let photosBase64 = [];
  if (files.length > 0) photosBase64 = await readFilesAsBase64(files);
  const res = await callAPI('saveFieldVisit', {
    data: {
      orderId: parseInt(orderId),
      engineerId: parseInt(currentUserId),
      visitDate: new Date().toISOString().split('T')[0],
      startTime: new Date().toTimeString().split(' ')[0],
      gpsLocation: gpsCoords,
      notes: notes,
      signatureBase64: signature,
      photosBase64: photosBase64
    }
  });
  document.getElementById('visitMsg').innerText = res.msg;
  if (res.status === 'success') {
    setTimeout(() => { closeVisitModal(); loadOrders(); }, 1500);
  }
}

// ==================== HR Module ====================
async function clockIn() {
  if (!gpsCoords) { alert('الرجاء تحديد الموقع'); return; }
  const res = await callAPI('clockIn', { data: { employeeId: parseInt(currentUserId), gps: gpsCoords } });
  document.getElementById('attendanceMsg').innerText = res.msg;
  document.getElementById('attendanceMsg').style.color = res.status === 'success' ? 'var(--green)' : 'var(--red)';
}

async function clockOut() {
  if (!gpsCoords) { alert('الرجاء تحديد الموقع'); return; }
  const res = await callAPI('clockOut', { data: { employeeId: parseInt(currentUserId), gps: gpsCoords } });
  document.getElementById('attendanceMsg').innerText = res.msg + (res.hours ? ` (ساعات العمل: ${res.hours})` : '');
  document.getElementById('attendanceMsg').style.color = res.status === 'success' ? 'var(--green)' : 'var(--red)';
}

async function loadEmployeesForSelect() {
  const res = await callAPI('getEmployees');
  if (res.status === 'success') {
    const selects = ['loanEmployee', 'payrollEmployee'];
    selects.forEach(id => {
      const select = document.getElementById(id);
      select.innerHTML = '<option value="">اختر موظف</option>';
      res.data.forEach(emp => {
        const opt = document.createElement('option');
        opt.value = emp.id;
        opt.text = `${emp.name} - ${emp.department}`;
        select.appendChild(opt);
      });
    });
  }
}

async function addLoan() {
  const empId = document.getElementById('loanEmployee').value;
  const amount = parseFloat(document.getElementById('loanAmount').value);
  const deduction = parseFloat(document.getElementById('loanDeduction').value);
  if (!empId || !amount) { alert('املأ الحقول'); return; }
  const res = await callAPI('addLoan', {
    data: {
      employeeId: parseInt(empId),
      amountUSD: amount,
      amountEGP: amount * 48.5,
      deductionPerMonth: deduction || amount / 6,
      startDate: new Date().toISOString().split('T')[0]
    }
  });
  document.getElementById('loanMsg').innerText = res.msg;
  if (res.status === 'success') loadLoans();
}

async function loadLoans() {
  const empId = document.getElementById('loanEmployee').value || currentUserId;
  const res = await callAPI('getLoans', { employeeId: parseInt(empId) });
  if (res.status === 'success') {
    const container = document.getElementById('loanList');
    container.innerHTML = '';
    res.data.forEach(l => {
      const div = document.createElement('div');
      div.className = 'list-item';
      div.innerHTML = `<div class="info"><strong>${l.amountUSD} USD</strong><small>المتبقي: ${l.remaining} | الخصم: ${l.deduction} | ${l.status}</small></div>`;
      container.appendChild(div);
    });
  }
}

async function generatePayroll() {
  const empId = document.getElementById('payrollEmployee').value;
  const month = document.getElementById('payrollMonth').value;
  const currency = document.getElementById('payrollCurrency').value;
  if (!empId || !month) { alert('املأ البيانات'); return; }
  const res = await callAPI('generatePayroll', {
    data: { employeeId: parseInt(empId), monthYear: month, currency: currency }
  });
  document.getElementById('payrollMsg').innerText = res.msg + (res.netSalary ? ` | الصافي: ${res.netSalary} ${currency}` : '');
  if (res.status === 'success') loadPayrolls();
}

async function loadPayrolls() {
  const status = document.getElementById('filterPayrolls').value;
  const statusParam = status === 'all' ? null : status;
  const res = await callAPI('getPayrolls', { status: statusParam });
  if (res.status === 'success') {
    const container = document.getElementById('payrollList');
    container.innerHTML = '';
    res.data.forEach(p => {
      const div = document.createElement('div');
      div.className = 'list-item';
      const isPaid = p.status === 'مدفوع';
      div.innerHTML = `
        <div class="info">
          <strong>${p.monthYear}</strong>
          <small>الصافي: ${p.net} ${p.currency}</small>
        </div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <span class="status-badge ${isPaid ? 'مسدد' : 'معلق'}">${p.status}</span>
          ${!isPaid ? `<button class="pay-btn" onclick="paySalary(${p.id})">صرف</button>` : ''}
        </div>
      `;
      container.appendChild(div);
    });
  }
}

async function paySalary(payrollId) {
  const bankId = prompt('أدخل معرف الخزينة لصرف الراتب (اختياري)');
  const res = await callAPI('markPayrollPaid', {
    data: {
      payrollId: payrollId,
      paymentDate: new Date().toISOString().split('T')[0],
      bankAccountId: bankId ? parseInt(bankId) : null
    }
  });
  alert(res.msg);
  if (res.status === 'success') loadPayrolls();
}

// ==================== Reports ====================
async function loadAllReports() {
  await loadFinancialSummary();
  await loadMonthlySales();
  await loadMaintenanceReport();
  await loadInstallmentDetails();
  await loadHRSummary();
}

async function loadFinancialSummary() {
  const period = document.getElementById('reportPeriod').value;
  const res = await callAPI('getFinancialSummary', { period });
  if (res.status === 'success') {
    const d = res.data;
    const rate = 48.5;
    document.getElementById('kpiRevenue').innerText = (d.totalCollectedEGP || d.totalCollectedUSD * rate).toFixed(0) + ' EGP';
    document.getElementById('kpiRemaining').innerText = ((d.totalValueEGP - d.totalCollectedEGP) || (d.totalValueUSD - d.totalCollectedUSD) * rate).toFixed(0) + ' EGP';
    document.getElementById('kpiOverdue').innerText = d.overdueCount;
    document.getElementById('kpiCollection').innerText = d.collectionRate + '%';
  }
}

async function loadMonthlySales() {
  const year = new Date().getFullYear();
  const res = await callAPI('getMonthlySalesReport', { year });
  if (res.status === 'success') {
    const labels = res.data.map(d => d.month);
    const values = res.data.map(d => d.egp);
    const ctx = document.getElementById('salesChart').getContext('2d');
    if (salesChartInstance) salesChartInstance.destroy();
    salesChartInstance = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'المبيعات (EGP)', data: values, backgroundColor: '#2ecc71', borderRadius: 6 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#aaa' } } }, scales: { x: { ticks: { color: '#aaa' } }, y: { ticks: { color: '#aaa' } } } }
    });
  }
}

async function loadMaintenanceReport() {
  const res = await callAPI('getMaintenanceReport');
  if (res.status === 'success') {
    const d = res.data;
    const ctx = document.getElementById('maintenanceChart').getContext('2d');
    if (maintenanceChartInstance) maintenanceChartInstance.destroy();
    maintenanceChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['مفتوح', 'قيد التنفيذ', 'مغلق'],
        datasets: [{ data: [d.open, d.inProgress, d.closed], backgroundColor: ['#f1c40f', '#e67e22', '#2ecc71'], borderColor: '#1c1c24', borderWidth: 2 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#aaa' } } } }
    });
  }
}

async function loadInstallmentDetails() {
  const res = await callAPI('getInstallmentReport');
  if (res.status === 'success') {
    const d = res.data;
    document.getElementById('detailTotalDue').innerText = d.totalDueUSD.toFixed(2) + ' USD';
    document.getElementById('detailTotalPaid').innerText = d.totalPaidUSD.toFixed(2) + ' USD';
    document.getElementById('detailRemaining').innerText = d.remainingUSD.toFixed(2) + ' USD';
    document.getElementById('detailCommissions').innerText = d.totalCommissionsUSD.toFixed(2) + ' USD';
  }
}

async function loadHRSummary() {
  const month = new Date().toISOString().slice(0, 7);
  const res = await callAPI('getHRReport', { monthYear: month });
  if (res.status === 'success') {
    const d = res.data;
    document.getElementById('hrTotalEmployees').innerText = d.totalEmployees;
    document.getElementById('hrTotalPayroll').innerText = d.totalPayrollEGP.toFixed(0) + ' EGP';
    document.getElementById('hrAttendance').innerText = d.attendanceRate + '%';
  }
}

async function exportCSV(type) {
  const period = document.getElementById('reportPeriod').value;
  const res = await callAPI('exportReportData', { type, params: { period, year: new Date().getFullYear() } });
  if (res.status === 'success' && res.csv) {
    const blob = new Blob([res.csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `report_${type}_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } else alert('لا توجد بيانات للتصدير');
}

function printReport() {
  const content = document.getElementById('reportsTab').innerHTML;
  const win = window.open('', '_blank');
  win.document.write(`
    <html><head><title>تقرير Union CNC</title>
    <style>body{font-family:Arial;direction:rtl;background:#fff;color:#000;padding:20px;}
    .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;}
    .stat{border-right:4px solid #2ecc71;padding:10px;background:#f5f5f5;}
    .card{border:1px solid #ddd;padding:15px;margin:10px 0;border-radius:8px;}
    </style></head>
    <body><h1 style="color:#2ecc71;">📊 Union CNC - تقرير شامل</h1>
    <div>${content.replace(/<canvas[^>]*>/g, '<div style="background:#eee;padding:20px;">[رسم بياني]</div>')}</div>
    <p style="margin-top:30px;color:#888;">تم التوليد: ${new Date().toLocaleString('ar-EG')}</p>
    </body></html>
  `);
  win.document.close();
  win.print();
}

// ==================== Service Worker & Init ====================
window.onload = function() {
  if (localStorage.getItem('token')) {
    showDashboard();
  }
  // تفعيل GPS
  getGPSLocation();
  // تحديث الإشعارات كل 30 ثانية
  setInterval(() => {
    if (localStorage.getItem('token')) {
      callAPI('getNotifications', { userId: currentUserId }).then(res => {
        if (res.status === 'success') renderNotifications(res.data);
      });
    }
  }, 30000);
};