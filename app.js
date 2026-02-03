(() => {
  'use strict';

  const API_ORDERS = '/api/mediblood/orders';
  const API_HEALTH = '/api/health';
  const STORAGE_LAST_ORDER = 'medibloodLastOrderIdV1';
  const STORAGE_LOCAL_ORDERS = 'medibloodOrdersV1';
  const BACKEND_TIMEOUT_MS = 650;

  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const formatMoney = (value) => {
    const n = Number(value);
    const safe = Number.isFinite(n) ? n : 0;
    try {
      return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(safe);
    } catch {
      return `₹${safe.toFixed(2)}`;
    }
  };

  const escapeHtml = (text) =>
    String(text ?? '').replace(/[&<>"']/g, (ch) => {
      switch (ch) {
        case '&':
          return '&amp;';
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '"':
          return '&quot;';
        case "'":
          return '&#39;';
        default:
          return ch;
      }
    });

  const showResult = (host, { ok, html }) => {
    if (!host) return;
    host.hidden = false;
    host.classList.remove('ok', 'bad');
    host.classList.add(ok ? 'ok' : 'bad');
    host.innerHTML = html;
  };

  const hideResult = (host) => {
    if (!host) return;
    host.hidden = true;
    host.classList.remove('ok', 'bad');
    host.textContent = '';
  };

  const fetchJson = async (url, options) => {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data && data.message ? data.message : `Request failed (${res.status})`;
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  };

  const fetchWithTimeout = async (url, options, timeoutMs) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      window.clearTimeout(timer);
    }
  };

  const canUseBackend = () => window.location.protocol === 'http:' || window.location.protocol === 'https:';

  let backendAvailable = false;

  const goOffline = () => {
    if (!backendAvailable) return;
    backendAvailable = false;
    setSystemBanner('offline');
  };

  const setSystemBanner = (mode) => {
    const host = qs('[data-sys-banner]');
    if (!host) return;

    host.hidden = false;
    host.classList.remove('ok', 'bad');

    if (mode === 'online') {
      host.classList.add('ok');
      host.innerHTML = `Backend connected. Orders are saved on the server.`;
      return;
    }

    host.classList.add('bad');
    host.innerHTML = `
      <strong>Offline demo mode:</strong> orders are saved only in this browser.
      <span class="muted small" style="margin-left: 10px;">
        To enable the backend, run <code>node server.js</code> and open <code>http://localhost:5173/mediblood/</code>.
      </span>
    `;
  };

  const checkBackend = async () => {
    if (!canUseBackend()) return false;
    try {
      const res = await fetchWithTimeout(API_HEALTH, { method: 'GET' }, BACKEND_TIMEOUT_MS);
      return Boolean(res && res.ok);
    } catch {
      return false;
    }
  };

  const loadLocalOrders = () => {
    try {
      const raw = localStorage.getItem(STORAGE_LOCAL_ORDERS);
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const saveLocalOrders = (orders) => {
    try {
      localStorage.setItem(STORAGE_LOCAL_ORDERS, JSON.stringify(Array.isArray(orders) ? orders : []));
    } catch {
      // ignore
    }
  };

  const makeLocalOrderId = () => {
    const ts = Date.now().toString(36).toUpperCase();
    const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `MB-${ts}-L${rnd}`;
  };

  const addLocalOrder = (order) => {
    const orders = loadLocalOrders();
    orders.push(order);
    saveLocalOrders(orders);
    return order;
  };

  const findLocalOrder = (id) => loadLocalOrders().find((o) => o && typeof o === 'object' && o.id === id) || null;

  const listLocalOrders = () =>
    loadLocalOrders()
      .slice()
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, 200);

  const products = [
    {
      sku: 'MB-PARA-500',
      name: 'Paracetamol Tablets 500mg (10)',
      price: 2.5,
      tag: 'OTC',
      desc: 'Pain & fever relief (demo listing).'
    },
    {
      sku: 'MB-IBU-200',
      name: 'Ibuprofen Tablets 200mg (10)',
      price: 3.0,
      tag: 'OTC',
      desc: 'Anti-inflammatory (demo listing).'
    },
    {
      sku: 'MB-ORS-200',
      name: 'ORS Sachet (1)',
      price: 1.2,
      tag: 'OTC',
      desc: 'Oral rehydration salts (demo listing).'
    },
    {
      sku: 'MB-INS-TEST',
      name: 'Insulin Pen (Demo)',
      price: 18.0,
      tag: 'Prescription',
      desc: 'Prescription required in many regions.'
    },
    {
      sku: 'MB-ABX-TEST',
      name: 'Antibiotic Capsules (Demo)',
      price: 12.0,
      tag: 'Prescription',
      desc: 'Prescription required in many regions.'
    }
  ];

  const cart = new Map();

  const cartCount = () => {
    let count = 0;
    for (const item of cart.values()) count += item.qty;
    return count;
  };

  const cartTotal = () => {
    let total = 0;
    for (const item of cart.values()) total += item.price * item.qty;
    return Math.round(total * 100) / 100;
  };

  const updateCartHud = () => {
    const pill = qs('[data-cart-count]');
    if (pill) pill.textContent = String(cartCount());
    const totalEl = qs('[data-cart-total]');
    if (totalEl) totalEl.textContent = formatMoney(cartTotal());
  };

  const renderCart = () => {
    const host = qs('[data-cart]');
    if (!host) return;
    host.innerHTML = '';

    if (cart.size === 0) {
      const empty = document.createElement('div');
      empty.className = 'cart-empty';
      empty.textContent = 'Your cart is empty. Add items from the catalog.';
      host.appendChild(empty);
      updateCartHud();
      return;
    }

    for (const item of cart.values()) {
      const row = document.createElement('div');
      row.className = 'cart-item';
      row.innerHTML = `
        <div>
          <div class="cart-item-title">${escapeHtml(item.name)}</div>
          <div class="cart-item-meta">${escapeHtml(item.sku)} • ${formatMoney(item.price)} × ${item.qty}</div>
        </div>
        <div class="cart-item-actions">
          <input class="qty" type="number" min="1" max="99" value="${item.qty}" aria-label="Quantity for ${escapeHtml(
        item.name
      )}" data-cart-qty="${escapeHtml(item.sku)}" />
          <button class="ghost" type="button" data-cart-remove="${escapeHtml(item.sku)}">Remove</button>
        </div>
      `;
      host.appendChild(row);
    }

    qsa('[data-cart-qty]', host).forEach((input) => {
      input.addEventListener('change', () => {
        const sku = input.dataset.cartQty;
        const qty = Math.max(1, Math.min(99, Number.parseInt(input.value, 10) || 1));
        input.value = String(qty);
        const existing = cart.get(sku);
        if (existing) cart.set(sku, { ...existing, qty });
        updateCartHud();
      });
    });

    qsa('[data-cart-remove]', host).forEach((btn) => {
      btn.addEventListener('click', () => {
        const sku = btn.dataset.cartRemove;
        cart.delete(sku);
        renderCart();
      });
    });

    updateCartHud();
  };

  const renderProducts = () => {
    const host = qs('[data-products]');
    if (!host) return;
    host.innerHTML = '';

    for (const product of products) {
      const row = document.createElement('div');
      row.className = 'product';

      const badgeClass = product.tag === 'Prescription' ? 'badge danger' : 'badge';
      row.innerHTML = `
        <div>
          <div class="product-title">${escapeHtml(product.name)}</div>
          <div class="product-meta">
            <span class="${badgeClass}">${escapeHtml(product.tag)}</span>
            <span class="badge">${formatMoney(product.price)}</span>
          </div>
          <div class="muted small" style="margin-top: 6px;">${escapeHtml(product.desc)}</div>
        </div>
        <div class="product-actions">
          <input class="qty" type="number" min="1" max="99" value="1" aria-label="Quantity" data-qty="${escapeHtml(
        product.sku
      )}" />
          <button class="primary" type="button" data-add="${escapeHtml(product.sku)}">Add</button>
        </div>
      `;
      host.appendChild(row);
    }

    qsa('[data-add]', host).forEach((btn) => {
      btn.addEventListener('click', () => {
        const sku = btn.dataset.add;
        const product = products.find((p) => p.sku === sku);
        if (!product) return;
        const qtyInput = qs(`[data-qty="${CSS.escape(sku)}"]`, host);
        const qty = Math.max(1, Math.min(99, Number.parseInt(qtyInput?.value, 10) || 1));
        const existing = cart.get(sku);
        cart.set(sku, {
          sku,
          name: product.name,
          price: product.price,
          qty: (existing ? existing.qty : 0) + qty
        });
        renderCart();
      });
    });
  };

  const showView = (name) => {
    qsa('[data-view]').forEach((el) => {
      el.hidden = el.dataset.view !== name;
    });

    qsa('[data-nav]').forEach((el) => {
      if (el instanceof HTMLButtonElement) {
        el.setAttribute('aria-current', el.dataset.nav === name ? 'page' : 'false');
      } else if (el instanceof HTMLAnchorElement) {
        el.setAttribute('aria-current', el.dataset.nav === name ? 'page' : 'false');
      }
    });
  };

  const initNav = () => {
    qsa('[data-nav]').forEach((el) => {
      el.addEventListener('click', (ev) => {
        ev.preventDefault();
        const target = el.dataset.nav;
        if (!target) return;
        showView(target);
        if (target === 'admin') refreshAdmin();
      });
    });
  };

  const getFormValue = (form, name) => {
    const el = form.elements.namedItem(name);
    if (!el) return '';
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      return el.value;
    }
    return '';
  };

  const setFormValue = (form, name, value) => {
    const el = form.elements.namedItem(name);
    if (!el) return;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      el.value = String(value ?? '');
    }
  };

  const saveLastOrderId = (orderId) => {
    try {
      localStorage.setItem(STORAGE_LAST_ORDER, String(orderId));
    } catch {
      // ignore
    }
  };

  const loadLastOrderId = () => {
    try {
      return localStorage.getItem(STORAGE_LAST_ORDER) || '';
    } catch {
      return '';
    }
  };

  const setupCheckout = () => {
    const form = qs('[data-checkout-form]');
    if (!form) return;
    const resultHost = qs('[data-checkout-result]');

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      hideResult(resultHost);

      if (cart.size === 0) {
        showResult(resultHost, { ok: false, html: 'Add at least one item to your cart.' });
        return;
      }

      const order = {
        type: 'medicine',
        customer: {
          name: getFormValue(form, 'name'),
          phone: getFormValue(form, 'phone'),
          address: getFormValue(form, 'address'),
          city: getFormValue(form, 'city')
        },
        items: Array.from(cart.values()).map((it) => ({ sku: it.sku, name: it.name, price: it.price, qty: it.qty })),
        note: getFormValue(form, 'note')
      };

      try {
        let id = '';
        if (backendAvailable) {
          const data = await fetchJson(API_ORDERS, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order })
          });
          id = data.orderId || (data.order && data.order.id) || '';
        } else {
          const createdAt = new Date().toISOString();
          const stored = {
            id: makeLocalOrderId(),
            createdAt,
            type: 'medicine',
            status: 'Placed',
            customer: order.customer,
            items: order.items,
            note: order.note,
            total: order.items.reduce((sum, it) => sum + Number(it.price || 0) * Number(it.qty || 0), 0)
          };
          addLocalOrder(stored);
          id = stored.id;
        }

        if (id) saveLastOrderId(id);

        cart.clear();
        renderCart();

        showResult(resultHost, {
          ok: true,
          html: `
            <div><strong>Order placed!</strong></div>
            <div class="muted small" style="margin-top: 6px;">Your Order ID:</div>
            <div style="margin-top: 8px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
              <code style="font-size: 14px;">${escapeHtml(id)}</code>
              <button class="ghost" type="button" data-copy-order-id="${escapeHtml(id)}">Copy</button>
              <button class="secondary" type="button" data-nav="track">Track</button>
            </div>
          `
        });

        const copyBtn = qs('[data-copy-order-id]', resultHost);
        if (copyBtn) {
          copyBtn.addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(id);
              copyBtn.textContent = 'Copied';
              window.setTimeout(() => (copyBtn.textContent = 'Copy'), 1200);
            } catch {
              // ignore
            }
          });
        }

        const trackForm = qs('[data-track-form]');
        if (trackForm) setFormValue(trackForm, 'orderId', id);
      } catch (err) {
        // If backend is down, fall back to local storage.
        if (!backendAvailable) {
          showResult(resultHost, { ok: false, html: escapeHtml(err.message || 'Failed to place order.') });
          return;
        }

        try {
          goOffline();
          const createdAt = new Date().toISOString();
          const stored = {
            id: makeLocalOrderId(),
            createdAt,
            type: 'medicine',
            status: 'Placed',
            customer: order.customer,
            items: order.items,
            note: order.note,
            total: order.items.reduce((sum, it) => sum + Number(it.price || 0) * Number(it.qty || 0), 0)
          };
          addLocalOrder(stored);
          saveLastOrderId(stored.id);
          cart.clear();
          renderCart();
          showResult(resultHost, {
            ok: true,
            html: `
              <div><strong>Order placed (offline mode).</strong></div>
              <div class="muted small" style="margin-top: 6px;">Your Order ID:</div>
              <div style="margin-top: 8px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                <code style="font-size: 14px;">${escapeHtml(stored.id)}</code>
                <button class="secondary" type="button" data-nav="track">Track</button>
              </div>
            `
          });
          const trackForm = qs('[data-track-form]');
          if (trackForm) setFormValue(trackForm, 'orderId', stored.id);
        } catch (fallbackErr) {
          showResult(resultHost, { ok: false, html: escapeHtml(err.message || 'Failed to place order.') });
        }
      }
    });
  };

  const setupBloodForm = () => {
    const form = qs('[data-blood-form]');
    if (!form) return;
    const resultHost = qs('[data-blood-result]');

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      hideResult(resultHost);

      const order = {
        type: 'blood',
        customer: {
          name: getFormValue(form, 'name'),
          phone: getFormValue(form, 'phone'),
          address: '',
          city: getFormValue(form, 'city')
        },
        request: {
          bloodType: getFormValue(form, 'bloodType'),
          units: getFormValue(form, 'units'),
          urgency: getFormValue(form, 'urgency'),
          hospital: getFormValue(form, 'hospital'),
          patientName: getFormValue(form, 'patientName')
        },
        note: getFormValue(form, 'note')
      };

      try {
        let id = '';
        if (backendAvailable) {
          const data = await fetchJson(API_ORDERS, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order })
          });
          id = data.orderId || (data.order && data.order.id) || '';
        } else {
          const createdAt = new Date().toISOString();
          const stored = {
            id: makeLocalOrderId(),
            createdAt,
            type: 'blood',
            status: 'Requested',
            customer: order.customer,
            request: order.request,
            note: order.note
          };
          addLocalOrder(stored);
          id = stored.id;
        }

        if (id) saveLastOrderId(id);

        showResult(resultHost, {
          ok: true,
          html: `
            <div><strong>Request submitted.</strong></div>
            <div class="muted small" style="margin-top: 6px;">Request ID:</div>
            <div style="margin-top: 8px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
              <code style="font-size: 14px;">${escapeHtml(id)}</code>
              <button class="ghost" type="button" data-copy-order-id="${escapeHtml(id)}">Copy</button>
              <button class="secondary" type="button" data-nav="track">Track</button>
            </div>
          `
        });

        const copyBtn = qs('[data-copy-order-id]', resultHost);
        if (copyBtn) {
          copyBtn.addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(id);
              copyBtn.textContent = 'Copied';
              window.setTimeout(() => (copyBtn.textContent = 'Copy'), 1200);
            } catch {
              // ignore
            }
          });
        }

        const trackForm = qs('[data-track-form]');
        if (trackForm) setFormValue(trackForm, 'orderId', id);
      } catch (err) {
        if (!backendAvailable) {
          showResult(resultHost, { ok: false, html: escapeHtml(err.message || 'Failed to submit request.') });
          return;
        }

        try {
          goOffline();
          const createdAt = new Date().toISOString();
          const stored = {
            id: makeLocalOrderId(),
            createdAt,
            type: 'blood',
            status: 'Requested',
            customer: order.customer,
            request: order.request,
            note: order.note
          };
          addLocalOrder(stored);
          saveLastOrderId(stored.id);
          showResult(resultHost, {
            ok: true,
            html: `
              <div><strong>Request submitted (offline mode).</strong></div>
              <div class="muted small" style="margin-top: 6px;">Request ID:</div>
              <div style="margin-top: 8px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                <code style="font-size: 14px;">${escapeHtml(stored.id)}</code>
                <button class="secondary" type="button" data-nav="track">Track</button>
              </div>
            `
          });
          const trackForm = qs('[data-track-form]');
          if (trackForm) setFormValue(trackForm, 'orderId', stored.id);
        } catch (fallbackErr) {
          showResult(resultHost, { ok: false, html: escapeHtml(err.message || 'Failed to submit request.') });
        }
      }
    });
  };

  const renderOrderDetails = (order) => {
    if (!order || typeof order !== 'object') return '<div class="muted">Invalid order.</div>';

    const header = `
      <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:baseline;">
        <div><strong>${escapeHtml(order.id || '')}</strong></div>
        <div class="muted small">${escapeHtml(order.type || '')} • ${escapeHtml(order.status || '')}</div>
        <div class="muted small">${escapeHtml(order.createdAt || '')}</div>
      </div>
    `;

    const customer = order.customer || {};
    const customerHtml = `
      <div style="margin-top: 10px;">
        <div class="muted small">Contact</div>
        <div>${escapeHtml(customer.name || '')} • ${escapeHtml(customer.phone || '')}</div>
        ${customer.address ? `<div class="muted small" style="margin-top: 4px;">${escapeHtml(customer.address)}</div>` : ''}
        ${customer.city ? `<div class="muted small">${escapeHtml(customer.city)}</div>` : ''}
      </div>
    `;

    if (order.type === 'medicine') {
      const items = Array.isArray(order.items) ? order.items : [];
      const itemsHtml = items
        .map(
          (it) => `
          <tr>
            <td>${escapeHtml(it.name || '')}</td>
            <td>${escapeHtml(it.sku || '')}</td>
            <td>${escapeHtml(String(it.qty ?? ''))}</td>
            <td>${formatMoney(it.price)}</td>
          </tr>
        `
        )
        .join('');

      return `
        ${header}
        ${customerHtml}
        <div style="margin-top: 12px;" class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>SKU</th>
                <th>Qty</th>
                <th>Price</th>
              </tr>
            </thead>
            <tbody>${itemsHtml || ''}</tbody>
          </table>
        </div>
        <div style="margin-top: 12px; display:flex; justify-content:space-between; gap:10px;">
          <span class="muted">Total</span>
          <strong>${formatMoney(order.total)}</strong>
        </div>
        ${order.note ? `<div class="muted small" style="margin-top: 10px;">Note: ${escapeHtml(order.note)}</div>` : ''}
      `;
    }

    const req = order.request || {};
    return `
      ${header}
      ${customerHtml}
      <div style="margin-top: 12px;">
        <div class="muted small">Request</div>
        <div style="margin-top: 6px; display:grid; gap:6px;">
          <div><strong>Blood type:</strong> ${escapeHtml(req.bloodType || '')}</div>
          <div><strong>Units:</strong> ${escapeHtml(String(req.units ?? ''))}</div>
          <div><strong>Urgency:</strong> ${escapeHtml(req.urgency || '')}</div>
          ${req.patientName ? `<div><strong>Patient:</strong> ${escapeHtml(req.patientName)}</div>` : ''}
          ${req.hospital ? `<div><strong>Hospital:</strong> ${escapeHtml(req.hospital)}</div>` : ''}
        </div>
      </div>
      ${order.note ? `<div class="muted small" style="margin-top: 10px;">Note: ${escapeHtml(order.note)}</div>` : ''}
    `;
  };

  const setupTrackForm = () => {
    const form = qs('[data-track-form]');
    if (!form) return;
    const resultHost = qs('[data-track-result]');

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      hideResult(resultHost);
      const id = getFormValue(form, 'orderId').trim();
      if (!id) return;

      try {
        let order = null;

        if (backendAvailable) {
          const data = await fetchJson(`${API_ORDERS}/${encodeURIComponent(id)}`, { method: 'GET' });
          order = data.order;
        } else {
          order = findLocalOrder(id);
        }

        if (!order) throw new Error('Order not found.');
        showResult(resultHost, { ok: true, html: renderOrderDetails(order) });
      } catch (err) {
        const local = findLocalOrder(id);
        if (local) {
          showResult(resultHost, { ok: true, html: renderOrderDetails(local) });
          return;
        }
        if (backendAvailable && (!err || typeof err.status !== 'number' || err.status >= 500)) {
          goOffline();
        }
        showResult(resultHost, { ok: false, html: escapeHtml(err.message || 'Order not found.') });
      }
    });

    const last = loadLastOrderId();
    if (last) setFormValue(form, 'orderId', last);
  };

  const refreshAdmin = async () => {
    const resultHost = qs('[data-admin-result]');
    const tableHost = qs('[data-admin-table]');
    hideResult(resultHost);
    if (tableHost) tableHost.innerHTML = '';

    try {
      let orders = [];

      if (backendAvailable) {
        const data = await fetchJson(API_ORDERS, { method: 'GET' });
        orders = Array.isArray(data.orders) ? data.orders : [];
      } else {
        orders = listLocalOrders();
      }

      if (orders.length === 0) {
        showResult(resultHost, { ok: true, html: 'No orders yet.' });
        return;
      }

      const rows = orders
        .map((o) => {
          const customer = o.customer || {};
          const summary =
            o.type === 'medicine'
              ? `${formatMoney(o.total)} • ${(Array.isArray(o.items) ? o.items.length : 0)} items`
              : `${escapeHtml(o.request?.bloodType || '')} • ${escapeHtml(String(o.request?.units ?? ''))} units`;

          return `
            <tr>
              <td><code>${escapeHtml(o.id || '')}</code></td>
              <td>${escapeHtml(o.type || '')}</td>
              <td>${escapeHtml(o.status || '')}</td>
              <td>${escapeHtml(o.createdAt || '')}</td>
              <td>${escapeHtml(customer.name || '')}<div class="muted small">${escapeHtml(customer.phone || '')}</div></td>
              <td>${summary}</td>
            </tr>
          `;
        })
        .join('');

      if (tableHost) {
        tableHost.innerHTML = `
          <table>
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Type</th>
                <th>Status</th>
                <th>Created</th>
                <th>Contact</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        `;
      }
    } catch (err) {
      const fallback = listLocalOrders();
      if (fallback.length) {
        if (backendAvailable && err && typeof err.status !== 'number') goOffline();
        showResult(resultHost, { ok: true, html: 'Showing offline/local orders (admin API unavailable).' });
        if (tableHost) {
          const rows = fallback
            .map((o) => {
              const customer = o.customer || {};
              const summary =
                o.type === 'medicine'
                  ? `${formatMoney(o.total)} • ${(Array.isArray(o.items) ? o.items.length : 0)} items`
                  : `${escapeHtml(o.request?.bloodType || '')} • ${escapeHtml(String(o.request?.units ?? ''))} units`;
              return `
                <tr>
                  <td><code>${escapeHtml(o.id || '')}</code></td>
                  <td>${escapeHtml(o.type || '')}</td>
                  <td>${escapeHtml(o.status || '')}</td>
                  <td>${escapeHtml(o.createdAt || '')}</td>
                  <td>${escapeHtml(customer.name || '')}<div class="muted small">${escapeHtml(customer.phone || '')}</div></td>
                  <td>${summary}</td>
                </tr>
              `;
            })
            .join('');
          tableHost.innerHTML = `
            <table>
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Contact</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          `;
        }
        return;
      }

      const message =
        err && err.status === 403
          ? 'Admin list is available only from the same computer (localhost).'
          : escapeHtml(err.message || 'Failed to load admin list.');
      showResult(resultHost, { ok: false, html: message });
    }
  };

  const initActions = () => {
    qsa('[data-action="clear-cart"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        cart.clear();
        renderCart();
      });
    });

    qsa('[data-action="refresh-admin"]').forEach((btn) => {
      btn.addEventListener('click', refreshAdmin);
    });
  };

  const main = async () => {
    backendAvailable = await checkBackend();
    setSystemBanner(backendAvailable ? 'online' : 'offline');

    initNav();
    initActions();
    renderProducts();
    renderCart();
    setupCheckout();
    setupBloodForm();
    setupTrackForm();
    showView('home');
    updateCartHud();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void main());
  } else {
    void main();
  }
})();
