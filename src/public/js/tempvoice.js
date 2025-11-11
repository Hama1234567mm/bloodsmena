document.addEventListener('DOMContentLoaded', () => {
	const enabledToggle = document.getElementById('enabled');
	const enabledLabel = enabledToggle ? enabledToggle.closest('.switch-group')?.querySelector('.switch-label') : null;

	const channelsForm = document.getElementById('tv-channels-form');
	const channelsFeedback = document.getElementById('tv-channels-feedback');

	const dmForm = document.getElementById('tv-dm-embed-form');
	const dmFeedback = document.getElementById('tv-dm-embed-feedback');

	const controlForm = document.getElementById('tv-control-embed-form');
	const controlFeedback = document.getElementById('tv-control-embed-feedback');

	// Toggle handling
	if (enabledToggle && enabledLabel) {
		enabledToggle.addEventListener('change', async () => {
			const isEnabled = enabledToggle.checked;
			enabledLabel.textContent = isEnabled ? 'Enabled' : 'Disabled';
			enabledLabel.classList.toggle('is-active', isEnabled);
			const res = await fetchJSON('/api/settings/tempvoice', { tempVoiceEnabled: isEnabled });
			if (!res.ok) {
				enabledToggle.checked = !isEnabled;
				enabledLabel.textContent = !isEnabled ? 'Enabled' : 'Disabled';
				enabledLabel.classList.toggle('is-active', !isEnabled);
				showToast('Failed to update system status', 'error');
			}
		});

		setInterval(async () => {
			try {
				const res = await fetch('/api/settings/tempvoice', { credentials: 'same-origin' });
				const data = await res.json().catch(() => ({}));
				if (data.ok && data.settings) {
					const currentState = data.settings.tempVoiceEnabled === true;
					if (enabledToggle.checked !== currentState) {
						enabledToggle.checked = currentState;
						enabledLabel.textContent = currentState ? 'Enabled' : 'Disabled';
						enabledLabel.classList.toggle('is-active', currentState);
					}
				}
			} catch {}
		}, 1000);
	}

	if (channelsForm && channelsFeedback) {
		channelsForm.addEventListener('submit', async (e) => {
			e.preventDefault();
			const fd = new FormData(channelsForm);
			const payload = {
				tempVoiceHubChannelId: fd.get('tempVoiceHubChannelId')?.trim() || '',
				tempVoiceCategoryId: fd.get('tempVoiceCategoryId')?.trim() || '',
				tempVoiceLogChannelId: fd.get('tempVoiceLogChannelId')?.trim() || '',
				tempVoiceAccessRoleIds: fd.get('tempVoiceAccessRoleIds')?.trim() || '',
				tempVoiceEmojis: fd.get('tempVoiceEmojis')?.trim() || ''
			};
			setLoading(channelsForm, true);
			const res = await fetchJSON('/api/settings/tempvoice', payload);
			setLoading(channelsForm, false);
			showFeedback(channelsFeedback, res.ok ? 'Channel settings saved successfully' : (res.error || 'Failed to save'), !!res.ok);
		});
	}

	if (dmForm && dmFeedback) {
		dmForm.addEventListener('submit', async (e) => {
			e.preventDefault();
			const fd = new FormData(dmForm);
			const payload = {
				tempVoiceDmEmbed: {
					title: fd.get('title') || '',
					description: fd.get('description') || '',
					color: fd.get('color') || '#5b8cff'
				}
			};
			setLoading(dmForm, true);
			const res = await fetchJSON('/api/settings/tempvoice', payload);
			setLoading(dmForm, false);
			showFeedback(dmFeedback, res.ok ? 'DM embed saved' : (res.error || 'Failed to save'), !!res.ok);
		});
	}

	if (controlForm && controlFeedback) {
		controlForm.addEventListener('submit', async (e) => {
			e.preventDefault();
			const fd = new FormData(controlForm);
			const payload = {
				tempVoiceControlEmbed: {
					title: fd.get('title') || '',
					description: fd.get('description') || '',
					color: fd.get('color') || '#5b8cff'
				}
			};
			setLoading(controlForm, true);
			const res = await fetchJSON('/api/settings/tempvoice', payload);
			setLoading(controlForm, false);
			showFeedback(controlFeedback, res.ok ? 'Control embed saved' : (res.error || 'Failed to save'), !!res.ok);
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
