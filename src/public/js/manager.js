async function fetchJSON(url, options) {
  try {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (typeof data.ok === 'undefined') data.ok = res.ok;
    return data;
  } catch (err) {
    console.error(err);
    return { ok: false, error: 'network_error' };
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatMs(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts = [];
  if (h > 0) parts.push(h + 'h');
  if (m > 0 || h > 0) parts.push(m + 'm');
  parts.push(s + 's');
  return parts.join(' ');
}

async function loadUsers() {
  const body = document.getElementById('users-body');
  if (!body) return;
  body.innerHTML = '<tr><td colspan="4">Loading...</td></tr>';
  const data = await fetchJSON('/api/accounts');
  body.innerHTML = '';
  if (!data.ok) {
    if (data.error === 'timed_out') {
      window.location.href = '/login';
      return;
    }
    const msg = escapeHtml(data.error || 'Failed to load users');
    body.innerHTML = `<tr><td colspan="4">${msg}</td></tr>`;
    return;
  }
  (data.users || []).forEach((u) => {
    const tr = document.createElement('tr');
    const until = u.webTimeoutUntil ? new Date(u.webTimeoutUntil) : null;
    const left = until && until > new Date() ? Math.max(0, until.getTime() - Date.now()) : 0;
    const fmtLeft = left ? formatMs(left) : '—';
    const disableOwner = u.role === 'owner' ? 'disabled' : '';
    tr.innerHTML = `
      <td>${escapeHtml(u.username)}</td>
      <td>${escapeHtml(u.role)}</td>
      <td>
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="text" placeholder="e.g. 30m or 60000" data-id="${u._id}" class="timeout-input" style="width:180px;" ${disableOwner} />
          <button class="button" data-action="timeout" data-id="${u._id}" ${disableOwner}>Set</button>
          <span class="timeout-left" data-until="${until ? until.toISOString() : ''}" style="margin-left:8px; color: var(--muted);">Current: ${fmtLeft}</span>
        </div>
      </td>
      <td>
        <button class="button-danger" data-action="delete" data-id="${u._id}" ${disableOwner}>Delete</button>
      </td>
    `;
    body.appendChild(tr);
  });

  body.querySelectorAll('button[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (!id) return;
      if (!confirm('Delete this user?')) return;
      const res = await fetchJSON(`/api/accounts/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        alert(res.error || 'Failed to delete');
      }
      await loadUsers();
    });
  });
  body.querySelectorAll('button[data-action="timeout"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const input = body.querySelector(`.timeout-input[data-id="${id}"]`);
      const val = (input && input.value || '').trim();
      if (!val) { alert('Enter a duration like 30m or 60000'); return; }
      const res = await fetchJSON('/api/timeoutaccount', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration: val, user: id })
      });
      if (!res.ok) {
        alert(res.error || 'Failed to set timeout');
      }
      await loadUsers();
    });
  });

  initTimeoutCountdowns();
}

let countdownTimer = null;
function initTimeoutCountdowns() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  const nodes = Array.from(document.querySelectorAll('.timeout-left'));
  const update = () => {
    const now = Date.now();
    nodes.forEach(el => {
      const iso = el.getAttribute('data-until') || '';
      if (!iso) { el.textContent = 'Current: —'; return; }
      const until = new Date(iso).getTime();
      const diff = until - now;
      el.textContent = `Current: ${diff > 0 ? formatMs(diff) : '—'}`;
    });
  };
  update();
  countdownTimer = setInterval(update, 1000);
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('create-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('create-msg');
      if (msg) msg.textContent = '';
      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value.trim();
      const role = document.getElementById('role').value;
      if (!username || !password || !role) { if (msg) msg.textContent = 'All fields required.'; return; }
      const res = await fetchJSON('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role })
      });
      if (res.ok) {
        if (msg) msg.textContent = 'User created successfully.';
        form.reset();
        await loadUsers();
      } else {
        if (msg) msg.textContent = res.error || 'Failed to create user.';
      }
    });
  }

  loadUsers();
});