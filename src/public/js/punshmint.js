const state = {
	forceRun: false
};

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

document.addEventListener('DOMContentLoaded', () => {
	const actionSelect = document.getElementById('action');
	const durationRow = document.querySelector('[data-action="timeout"]');
	const forceBtn = document.getElementById('force-action');
	const punishForm = document.getElementById('punish-form');
	const punishFeedback = document.getElementById('punish-feedback');

	const enabledToggle = document.getElementById('punish-enabled');
	const enabledLabel = document.querySelector('.switch-label');
	const settingsForm = document.getElementById('settings-form');
	const settingsFeedback = document.getElementById('settings-feedback');
	const fieldsList = document.getElementById('fields-list');
	const addFieldBtn = document.getElementById('add-field');
	const template = document.getElementById('field-template');

	// Active voice actions rendering
	const tableBody = document.getElementById('voice-actions-body');
	async function loadVoiceActions() {
		if (!tableBody) return;
		try {
			const res = await fetch('/api/voice-actions', { credentials: 'same-origin' });
			const data = await res.json().catch(() => ({}));
			if (!data.ok) return;
			renderVoiceActions(tableBody, data.actions || []);
		} catch {}
	}

	function renderVoiceActions(tbody, actions) {
		tbody.innerHTML = '';
		const now = Date.now();
		actions.forEach(a => {
			const tr = document.createElement('tr');
			const userTd = document.createElement('td'); userTd.style.padding = '6px'; userTd.textContent = a.tag || a.userId;
			const typeTd = document.createElement('td'); typeTd.style.padding = '6px'; typeTd.textContent = a.type === 'mute' ? 'Voice Mute' : 'Voice Deafen';
			const expTd = document.createElement('td'); expTd.style.padding = '6px'; expTd.dataset.expires = String(a.expiresAt || 0);
			tr.appendChild(userTd); tr.appendChild(typeTd); tr.appendChild(expTd);
			tbody.appendChild(tr);
		});
		updateCountdowns(tbody);
	}

	function updateCountdowns(tbody) {
		const rows = tbody ? [...tbody.querySelectorAll('td[data-expires]')] : [];
		const now = Date.now();
		rows.forEach(td => {
			const exp = Number(td.dataset.expires || '0');
			const ms = exp - now;
			td.textContent = ms > 0 ? formatMs(ms) : 'expired';
		});
	}

	function formatMs(ms) {
		const s=Math.floor(ms/1000); const m=Math.floor((s%3600)/60); const h=Math.floor(s/3600); const sec=s%60;
		const parts=[]; if(h) parts.push(h+'h'); if(m) parts.push(m+'m'); parts.push(sec+'s');
		return parts.join(' ');
	}

	setInterval(() => updateCountdowns(tableBody), 1000);
	loadVoiceActions();

	if (actionSelect && durationRow) {
		actionSelect.addEventListener('change', () => toggleDurationRow(actionSelect.value, durationRow));
		toggleDurationRow(actionSelect.value, durationRow);
	}

	if (forceBtn) {
		forceBtn.addEventListener('click', () => {
			state.forceRun = true;
			punishForm?.requestSubmit();
		});
	}

	if (punishForm && punishFeedback) {
		punishForm.addEventListener('submit', async (event) => {
			event.preventDefault();
			const formData = new FormData(punishForm);
			const payload = {
				targetUserId: formData.get('targetUserId'),
				action: formData.get('action'),
				reason: formData.get('reason'),
				duration: formData.get('duration'),
				force: state.forceRun
			};
			state.forceRun = false;
			setLoading(punishForm, true);
			const res = await fetchJSON('/api/punishments', payload);
			setLoading(punishForm, false);
			if (res.ok) {
				showFeedback(punishFeedback, `Action processed${res.warnCount ? ` • warnings: ${res.warnCount}` : ''}`, true);
				punishForm.reset();
				toggleDurationRow('warn', durationRow);
			} else {
				const errorMsg = res.error || 'Failed to perform action';
				showFeedback(punishFeedback, errorMsg, false);
				// Show toast notification for system off errors
				if (errorMsg === 'Punish system off' || errorMsg.toLowerCase().includes('punish system off') || errorMsg.toLowerCase().includes('punishmint system off')) {
					showToast('Punish system off', 'error');
				} else if (errorMsg.toLowerCase().includes('permission') || errorMsg.toLowerCase().includes('role')) {
					showToast(errorMsg, 'error');
				}
			}
		});
	}

	if (enabledToggle && enabledLabel) {
		// Auto-save when toggle changes
		enabledToggle.addEventListener('change', async () => {
			const isEnabled = enabledToggle.checked;
			enabledLabel.textContent = isEnabled ? 'Enabled' : 'Disabled';
			enabledLabel.classList.toggle('is-active', isEnabled);
			
			// Save to MongoDB immediately
			try {
				const payload = collectSettings(enabledToggle, settingsForm, fieldsList);
				payload.enabled = isEnabled;
				const res = await fetchJSON('/api/settings/punishments', payload);
				if (res.ok) {
					console.log('System status updated:', isEnabled ? 'Enabled' : 'Disabled');
				} else {
					// Revert on error
					enabledToggle.checked = !isEnabled;
					enabledLabel.textContent = !isEnabled ? 'Enabled' : 'Disabled';
					enabledLabel.classList.toggle('is-active', !isEnabled);
					showToast('Failed to update system status', 'error');
				}
			} catch (err) {
				console.error('Failed to save toggle state:', err);
				// Revert on error
				enabledToggle.checked = !isEnabled;
				enabledLabel.textContent = !isEnabled ? 'Enabled' : 'Disabled';
				enabledLabel.classList.toggle('is-active', !isEnabled);
				showToast('Failed to update system status', 'error');
			}
		});
		
		// Poll system status every 1 second
		setInterval(async () => {
			try {
				const res = await fetch('/api/settings/punishments');
				const data = await res.json().catch(() => ({}));
				if (data.ok && data.settings) {
					const currentState = data.settings.punishmentsEnabled !== false;
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

	let initialData = {};
	const dataScript = document.getElementById('punshmint-data');
	if (dataScript) {
		try {
			initialData = JSON.parse(dataScript.textContent || '{}');
		} catch (error) {
			console.warn('Failed to parse punishment data', error);
		}
	}

	if (fieldsList && template) {
		populateFields(fieldsList, template, initialData.fields || []);
	}

	if (addFieldBtn && fieldsList && template) {
		addFieldBtn.addEventListener('click', () => addField(fieldsList, template));
	}

	if (settingsForm && settingsFeedback) {
		settingsForm.addEventListener('submit', async (event) => {
			event.preventDefault();
			const payload = collectSettings(enabledToggle, settingsForm, fieldsList);
			setLoading(settingsForm, true);
			const res = await fetchJSON('/api/settings/punishments', payload);
			setLoading(settingsForm, false);
			if (res.ok) {
				showFeedback(settingsFeedback, 'Settings saved successfully.', true);
			} else {
				showFeedback(settingsFeedback, res.error || 'Failed to save settings.', false);
			}
		});
	}
});

function toggleDurationRow(action, row) {
	if (!row) return;
	row.style.display = action === 'timeout' ? 'block' : 'none';
}

async function fetchJSON(url, payload) {
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});
		const data = await res.json().catch(() => ({}));
		return data;
	} catch (error) {
		console.error('fetchJSON error', error);
		return { ok: false, error: 'Network error' };
	}
}

function showFeedback(el, message, success) {
	el.textContent = message;
	el.classList.toggle('is-success', !!success);
	el.classList.toggle('is-error', !success);
}

function setLoading(form, loading) {
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

function populateFields(container, template, fields) {
	container.innerHTML = '';
	fields.forEach((field) => addField(container, template, field));
}

function addField(container, template, data = {}) {
	const node = template.content.firstElementChild.cloneNode(true);
	const nameInput = node.querySelector('[data-field="name"]');
	const valueInput = node.querySelector('[data-field="value"]');
	const inlineInput = node.querySelector('[data-field="inline"]');
	const removeBtn = node.querySelector('[data-action="remove"]');

	nameInput.value = data.name || '';
	valueInput.value = data.value || '';
	inlineInput.checked = !!data.inline;

	removeBtn.addEventListener('click', () => node.remove());
	container.appendChild(node);
}

function collectSettings(enabledToggle, form, fieldsList) {
	const formData = new FormData(form);
	const colorHex = formData.get('embedColor') || '#ff3b3b';
	const colorInt = parseInt(colorHex.replace('#', ''), 16);
	const logChannelInput = form.querySelector('#logChannelId');

	return {
		logChannelId: logChannelInput ? formData.get('logChannelId')?.trim() : undefined,
		enabled: enabledToggle ? enabledToggle.checked : undefined,
		dmEmbed: {
			title: formData.get('embedTitle') || '',
			description: formData.get('embedDescription') || '',
			color: Number.isNaN(colorInt) ? undefined : colorInt,
			fields: [...fieldsList.querySelectorAll('.field-row')].map((row) => ({
				name: row.querySelector('[data-field="name"]').value.trim(),
				value: row.querySelector('[data-field="value"]').value.trim(),
				inline: row.querySelector('[data-field="inline"]').checked
			})).filter(field => field.name && field.value) // Only include fields with both name and value
		}
	};
}

