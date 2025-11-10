document.addEventListener('DOMContentLoaded', () => {
	const disputeForm = document.getElementById('dispute-form');
	const disputeFeedback = document.getElementById('dispute-feedback');
	const disputesList = document.getElementById('disputes-list');
	const deleteAllBtn = document.getElementById('delete-all-disputes');
	const disputeEmbedForm = document.getElementById('dispute-embed-form');
	const disputeEmbedFeedback = document.getElementById('dispute-embed-feedback');
	const enabledToggle = document.getElementById('dispute-enabled');
	const enabledLabel = enabledToggle ? enabledToggle.closest('.switch-group')?.querySelector('.switch-label') : null;

	// Load disputes on page load
	loadDisputes();

	// Poll disputes every 2 seconds
	setInterval(loadDisputes, 2000);

	// Handle enabled/disabled toggle
	if (enabledToggle && enabledLabel) {
		// Auto-save when toggle changes
		enabledToggle.addEventListener('change', async () => {
			const isEnabled = enabledToggle.checked;
			enabledLabel.textContent = isEnabled ? 'Enabled' : 'Disabled';
			enabledLabel.classList.toggle('is-active', isEnabled);
			
			// Save to MongoDB immediately
			try {
				const payload = collectDisputeSettings(enabledToggle, disputeEmbedForm);
				payload.disputesEnabled = isEnabled;
				const res = await fetchJSON('/api/settings/disputes', payload);
				if (res.ok) {
					console.log('Dispute system status updated:', isEnabled ? 'Enabled' : 'Disabled');
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
				const res = await fetch('/api/settings/disputes');
				const data = await res.json().catch(() => ({}));
				if (data.ok && data.settings) {
					const currentState = data.settings.disputesEnabled !== false;
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

	if (disputeForm && disputeFeedback) {
		disputeForm.addEventListener('submit', async (event) => {
			event.preventDefault();
			const user1Id = document.getElementById('dispute-user1').value.trim();
			const user2Id = document.getElementById('dispute-user2').value.trim();
			
			if (!user1Id || !user2Id) {
				showFeedback(disputeFeedback, 'Both user IDs are required', false);
				return;
			}
			
			if (user1Id === user2Id) {
				showFeedback(disputeFeedback, 'Cannot create dispute with same user', false);
				return;
			}

			const res = await fetchJSON('/api/disputes', { user1Id, user2Id });
			if (res.ok) {
				showFeedback(disputeFeedback, 'Dispute created successfully', true);
				disputeForm.reset();
				loadDisputes();
			} else {
				showFeedback(disputeFeedback, res.error || 'Failed to create dispute', false);
			}
		});
	}

	if (deleteAllBtn) {
		deleteAllBtn.addEventListener('click', async () => {
			if (!confirm('Are you sure you want to delete ALL disputes? This cannot be undone.')) {
				return;
			}
			const res = await fetchJSON('/api/disputes', null, 'DELETE');
			if (res.ok) {
				showToast(`Deleted ${res.deletedCount || 0} disputes`, 'success');
				loadDisputes();
			} else {
				showToast(res.error || 'Failed to delete disputes', 'error');
			}
		});
	}

	if (disputeEmbedForm && disputeEmbedFeedback) {
		disputeEmbedForm.addEventListener('submit', async (event) => {
			event.preventDefault();
			const payload = collectDisputeSettings(enabledToggle, disputeEmbedForm);
			setLoading(disputeEmbedForm, true);
			const res = await fetchJSON('/api/settings/disputes', payload);
			setLoading(disputeEmbedForm, false);
			if (res.ok) {
				showFeedback(disputeEmbedFeedback, 'Settings saved successfully', true);
			} else {
				showFeedback(disputeEmbedFeedback, res.error || 'Failed to save', false);
			}
		});
	}

	async function loadDisputes() {
		if (!disputesList) return;
		try {
			const res = await fetch('/api/disputes');
			const data = await res.json().catch(() => ({}));
			if (data.ok && data.disputes) {
				renderDisputes(data.disputes);
			}
		} catch (err) {
			console.warn('Failed to load disputes:', err);
		}
	}

	function renderDisputes(disputes) {
		if (!disputesList) return;
		
		if (disputes.length === 0) {
			disputesList.innerHTML = '<p class="muted" style="text-align: center; padding: 20px;">No active disputes</p>';
			return;
		}

		disputesList.innerHTML = disputes.map(dispute => {
			// Escape HTML to prevent XSS
			const escapeHtml = (text) => {
				const div = document.createElement('div');
				div.textContent = text;
				return div.innerHTML;
			};
			
			return `
			<div class="dispute-item" style="padding: 16px; border: 1px solid var(--border); border-radius: 12px; margin-bottom: 12px; background: rgba(91,140,255,0.05);">
				<div style="display: flex; justify-content: space-between; align-items: start; gap: 16px;">
					<div style="flex: 1;">
						<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 8px;">
							<div>
								<strong style="color: var(--muted); font-size: 12px; text-transform: uppercase;">User 1</strong>
								<p style="margin: 4px 0 0; font-weight: 600;">${escapeHtml(dispute.user1Name || 'Unknown')}</p>
								<p style="margin: 0; font-size: 12px; color: var(--muted);">${escapeHtml(dispute.user1Id)}</p>
							</div>
							<div>
								<strong style="color: var(--muted); font-size: 12px; text-transform: uppercase;">User 2</strong>
								<p style="margin: 4px 0 0; font-weight: 600;">${escapeHtml(dispute.user2Name || 'Unknown')}</p>
								<p style="margin: 0; font-size: 12px; color: var(--muted);">${escapeHtml(dispute.user2Id)}</p>
							</div>
						</div>
						<div style="display: flex; gap: 16px; font-size: 12px; color: var(--muted);">
							<span>Created: ${new Date(dispute.createdAt).toLocaleDateString()}</span>
							<span>Disconnects: ${dispute.disconnectCount || 0}</span>
						</div>
					</div>
					<button class="btn btn-secondary btn-small delete-dispute-btn" data-dispute-id="${escapeHtml(dispute._id)}">Delete</button>
				</div>
			</div>
		`;
		}).join('');
		
		// Attach event listeners to delete buttons using event delegation
		disputesList.querySelectorAll('.delete-dispute-btn').forEach(btn => {
			btn.addEventListener('click', async (e) => {
				const disputeId = e.target.getAttribute('data-dispute-id');
				if (!disputeId) return;
				
				if (!confirm('Delete this dispute?')) return;
				
				// Disable button during deletion
				e.target.disabled = true;
				e.target.textContent = 'Deleting...';
				
				const res = await fetchJSON(`/api/disputes/${disputeId}`, null, 'DELETE');
				if (res.ok) {
					showToast('Dispute deleted', 'success');
					loadDisputes();
				} else {
					showToast(res.error || 'Failed to delete', 'error');
					e.target.disabled = false;
					e.target.textContent = 'Delete';
				}
			});
		});
	}

	async function fetchJSON(url, payload, method = 'POST') {
		try {
			const options = {
				method,
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin' // Include cookies for session authentication
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

	function collectDisputeSettings(enabledToggle, form) {
		if (!form) return {};
		const formData = new FormData(form);
		const colorHex = formData.get('disputeEmbedColor') || '#ff6b6b';
		const colorInt = parseInt(colorHex.replace('#', ''), 16);
		const logChannelInput = form.querySelector('#disputeLogChannelId');

		return {
			disputeLogChannelId: logChannelInput ? formData.get('disputeLogChannelId')?.trim() : undefined,
			disputesEnabled: enabledToggle ? enabledToggle.checked : undefined,
			disputeEmbed: {
				title: formData.get('disputeEmbedTitle') || '',
				description: formData.get('disputeEmbedDescription') || '',
				color: Number.isNaN(colorInt) ? undefined : colorInt,
				fields: []
			}
		};
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

