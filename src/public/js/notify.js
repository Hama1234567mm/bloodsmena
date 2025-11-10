document.addEventListener('DOMContentLoaded', () => {
	const container = document.getElementById('notifications');
	if (!container) return;
	const toasts = [...container.querySelectorAll('.toast')];
	toasts.forEach((t, i) => {
		setTimeout(() => {
			t.style.transition = 'opacity .3s ease, transform .3s ease';
			t.style.opacity = '0';
			t.style.transform = 'translateY(-6px)';
			setTimeout(() => t.remove(), 350);
		}, 3500 + i * 250);
	});
});

