document.addEventListener('DOMContentLoaded', () => {
	const verifyChannelsForm = document.getElementById('verify-channels-form');
	const verifyChannelsFeedback = document.getElementById('verify-channels-feedback');
	const verifyRolesForm = document.getElementById('verify-roles-form');
	const verifyRolesFeedback = document.getElementById('verify-roles-feedback');
	const verifyEmbedForm = document.getElementById('verify-embed-form');
	const verifyEmbedFeedback = document.getElementById('verify-embed-feedback');
	const enabledToggle = document.getElementById('verify-enabled');
	const enabledLabel = enabledToggle ? enabledToggle.closest('.switch-group')?.querySelector('.switch-label') : null;

	// Handle enabled/disabled toggle
	if (enabledToggle && enabledLabel) {
		enabledToggle.addEventListener('change', async () => {
			const isEnabled = enabledToggle.checked;
			enabledLabel.textContent = isEnabled ? 'Enabled' : 'Disabled';
			enabledLabel.classList.toggle('is-active', isEnabled);
			
			try {
				const res = await fetchJSON('/api/settings/verify', { verifyEnabled: isEnabled });
				if (res.ok) {
					console.log('Verify system status updated:', isEnabled ? 'Enabled' : 'Disabled');
				} else {
					enabledToggle.checked = !isEnabled;
					enabledLabel.textContent = !isEnabled ? 'Enabled' : 'Disabled';
					enabledLabel.classList.toggle('is-active', !isEnabled);
					showToast('Failed to update system status', 'error');
				}
			} catch (err) {
				console.error('Failed to save toggle state:', err);
				enabledToggle.checked = !isEnabled;
				enabledLabel.textContent = !isEnabled ? 'Enabled' : 'Disabled';
				enabledLabel.classList.toggle('is-active', !isEnabled);
				showToast('Failed to update system status', 'error');
			}
		});
		
		// Poll system status every 1 second
		setInterval(async () => {
			try {
				const res = await fetch('/api/settings/verify');
				const data = await res.json().catch(() => ({}));
				if (data.ok && data.settings) {
					const currentState = data.settings.verifyEnabled !== false;
					if (enabledToggle.checked !== currentState) {
						enabledToggle.checked = currentState;
						enabledLabel.textContent = currentState ? 'Enabled' : 'Disabled';
						enabledLabel.classList.toggle('is-active', currentState);
					}
				}
			} catch (err) {
				console.warn('Failed to poll system status:', err);
			}
		}, 1000);
	}

	if (verifyChannelsForm && verifyChannelsFeedback) {
		verifyChannelsForm.addEventListener('submit', async (event) => {
			event.preventDefault();
			const formData = new FormData(verifyChannelsForm);
			const payload = {
				verifyCategoryId: formData.get('verifyCategoryId')?.trim() || '',
				verifyLogChannelId: formData.get('verifyLogChannelId')?.trim() || '',
				verifyChannelId: formData.get('verifyChannelId')?.trim() || ''
			};
			setLoading(verifyChannelsForm, true);
			const res = await fetchJSON('/api/settings/verify', payload);
			setLoading(verifyChannelsForm, false);
			if (res.ok) {
				showFeedback(verifyChannelsFeedback, 'Channel settings saved successfully', true);
			} else {
				showFeedback(verifyChannelsFeedback, res.error || 'Failed to save', false);
			}
		});
	}

	if (verifyRolesForm && verifyRolesFeedback) {
		verifyRolesForm.addEventListener('submit', async (event) => {
			event.preventDefault();
			const formData = new FormData(verifyRolesForm);
			const payload = {
				verifyAdminRoleIds: formData.get('verifyAdminRoleIds')?.trim() || '',
				verifyBoyRoleId: formData.get('verifyBoyRoleId')?.trim() || '',
				verifyGirlRoleId: formData.get('verifyGirlRoleId')?.trim() || ''
			};
			setLoading(verifyRolesForm, true);
			const res = await fetchJSON('/api/settings/verify', payload);
			setLoading(verifyRolesForm, false);
			if (res.ok) {
				showFeedback(verifyRolesFeedback, 'Role settings saved successfully', true);
			} else {
				showFeedback(verifyRolesFeedback, res.error || 'Failed to save', false);
			}
		});
	}

	if (verifyEmbedForm && verifyEmbedFeedback) {
		verifyEmbedForm.addEventListener('submit', async (event) => {
			event.preventDefault();
			const formData = new FormData(verifyEmbedForm);
			const colorHex = formData.get('verifyEmbedColor') || '#5b8cff';
			const colorInt = parseInt(colorHex.replace('#', ''), 16);
			const payload = {
				verifyEmbed: {
					title: formData.get('verifyEmbedTitle') || '',
					description: formData.get('verifyEmbedDescription') || '',
					color: Number.isNaN(colorInt) ? undefined : colorInt,
					fields: []
				}
			};
			setLoading(verifyEmbedForm, true);
			const res = await fetchJSON('/api/settings/verify', payload);
			setLoading(verifyEmbedForm, false);
			if (res.ok) {
				showFeedback(verifyEmbedFeedback, 'Embed settings saved successfully', true);
			} else {
				showFeedback(verifyEmbedFeedback, res.error || 'Failed to save', false);
			}
		});
	}

	async function fetchJSON(url, payload, method = 'POST') {
		try {
			const options = {
				method,
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin'
			};
			if (payload && method !== 'GET' && method !== 'DELETE') {
				options.body = JSON.stringify(payload);
			}
			const res = await fetch(url, options);
			const data = await res.json().catch(() => ({}));
			return data;
		} catch (error) {
			console.error('fetchJSON error', error);
			return { ok: false, error: 'Network error' };
		}
	}

	function showFeedback(el, message, success) {
		if (!el) return;
		el.textContent = message;
		el.classList.toggle('is-success', !!success);
		el.classList.toggle('is-error', !success);
	}

	function showToast(message, type = 'error') {
		const container = document.getElementById('notifications');
		if (!container) return;
		const toast = document.createElement('div');
		toast.className = `toast toast-${type}`;
		toast.textContent = message;
		container.appendChild(toast);
		setTimeout(() => {
			toast.style.transition = 'opacity .3s ease, transform .3s ease';
			toast.style.opacity = '0';
			toast.style.transform = 'translateY(-6px)';
			setTimeout(() => toast.remove(), 350);
		}, 4000);
	}

	function setLoading(form, loading) {
		if (!form) return;
		const buttons = form.querySelectorAll('button');
		buttons.forEach((btn) => {
			btn.disabled = loading;
			if (loading) {
				btn.dataset.originalText = btn.textContent;
				btn.textContent = 'Processing...';
			} else if (btn.dataset.originalText) {
				btn.textContent = btn.dataset.originalText;
				delete btn.dataset.originalText;
			}
		});
	}
});

