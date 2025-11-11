(function(){
    const upEl = document.getElementById('uptime');
    let uptime = 0;
    try {
        const dataEl = document.getElementById('dashboard-data');
        const data = JSON.parse(dataEl ? dataEl.textContent : '{}');
        uptime = Number(data.uptime) || 0;
    } catch (e) {}
    function fmt(ms){
        if(!ms||ms<=0) return '0s';
        const s=Math.floor(ms/1000); const d=Math.floor(s/86400); const h=Math.floor((s%86400)/3600); const m=Math.floor((s%3600)/60); const sec=s%60;
        const parts=[]; if(d) parts.push(d+'d'); if(h) parts.push(h+'h'); if(m) parts.push(m+'m'); parts.push(sec+'s');
        return parts.join(' ');
    }
    if(upEl) upEl.textContent = fmt(uptime);
})();