
(function(){
  const dataEl = document.getElementById('timeout-data');
  let injected = { remainingMs: 0 };
  try { injected = JSON.parse(dataEl?.textContent || '{}'); } catch {}
  const fallbackMs = Number(injected.remainingMs) || 0;
  const el = document.getElementById('countdown');

  function fmt(ms) {
    const total = Math.max(0, Math.floor(ms/1000));
    const h = Math.floor(total/3600);
    const m = Math.floor((total%3600)/60);
    const s = total%60;
    const parts = [];
    if (h>0) parts.push(h+'h');
    if (m>0 || h>0) parts.push(m+'m');
    parts.push(s+'s');
    return parts.join(' ');
  }

  let end = Date.now() + fallbackMs;

  function tick(){
    const left = end - Date.now();
    el.textContent = left > 0 ? fmt(left) : 'Timeout expired. You can refresh the page.';
    if (left > 0) requestAnimationFrame(tick);
  }

  async function init(){
    try {
      const res = await fetch('/api/userstimoutes');
      const data = await res.json().catch(() => ({ ok:false }));
      if (data && data.ok) {
        if (data.until) {
          end = new Date(data.until).getTime();
        } else {
          end = Date.now() + (Number(data.remainingMs) || 0);
        }
      }
    } catch {}
    tick();
  }

  init();
})();