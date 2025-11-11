document.addEventListener('DOMContentLoaded', () => {
	const dataScript = document.getElementById('autoreply-data');
	let entries = [];
	try {
		entries = JSON.parse(dataScript?.textContent || '{}').replies || [];
	} catch {
		entries = [];
	}

	const tableBody = document.getElementById('autoreply-body');
	const editor = document.getElementById('editor');
	const form = document.getElementById('autoreply-form');
	const newBtn = document.getElementById('new-entry');
	const cancelBtn = document.getElementById('cancel-editor');
	const editorTitle = document.getElementById('editor-title');

	const idInput = document.getElementById('entry-id');
	const triggerInput = document.getElementById('entry-trigger');
	const matchInput = document.getElementById('entry-match');
	const responseInput = document.getElementById('entry-response');

	function render() {
		if (!tableBody) return;
		tableBody.innerHTML = '';
		entries.forEach((entry) => {
			const tr = document.createElement('tr');
			tr.innerHTML = `
				<td style="padding:6px;">${escapeHtml(entry.trigger)}</td>
				<td style="padding:6px; text-transform: capitalize;">${entry.matchType || 'contains'}</td>
				<td style="padding:6px;">${escapeHtml(entry.response)}</td>
				<td style="padding:6px; text-align:right;">
					<button class="btn btn-secondary btn-small" data-action="edit" data-id="${entry._id}">Edit</button>
					<button class="btn btn-secondary btn-small" data-action="delete" data-id="${entry._id}" style="margin-left:8px;">Delete</button>
				</td>
			`;
			tableBody.appendChild(tr);
		});
	}

	function openEditor(entry) {
		if (!editor) return;
		editor.style.display = 'block';
		if (entry) {
			editorTitle.textContent = 'Edit Auto Reply';
			idInput.value = entry._id || '';
			triggerInput.value = entry.trigger || '';
			matchInput.value = entry.matchType || 'contains';
			responseInput.value = entry.response || '';
		} else {
			editorTitle.textContent = 'New Auto Reply';
			idInput.value = '';
			triggerInput.value = '';
			matchInput.value = 'contains';
			responseInput.value = '';
		}
		triggerInput.focus();
	}

	function closeEditor() {
		if (editor) editor.style.display = 'none';
	}

	async function saveEntry(event) {
		event.preventDefault();
		const payload = {
			id: idInput.value || undefined,
			trigger: triggerInput.value.trim(),
			matchType: matchInput.value,
			response: responseInput.value.trim()
		};
		if (!payload.trigger || !payload.response) {
			alert('Trigger and response are required.');
			return;
		}
		disableForm(true);
		try {
			const res = await fetch('/api/autoreply', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			const data = await res.json();
			if (!data.ok) throw new Error(data.error || 'Failed to save');
			entries = data.replies || [];
			render();
			closeEditor();
		} catch (err) {
			console.error(err);
			alert(err.message || 'Failed to save entry');
		} finally {
			disableForm(false);
		}
	}

	async function deleteEntry(id) {
		if (!id) return;
		if (!confirm('Delete this auto reply?')) return;
		try {
			const res = await fetch(`/api/autoreply/${id}`, { method: 'DELETE' });
			const data = await res.json();
			if (!data.ok) throw new Error(data.error || 'Failed to delete');
			entries = entries.filter((e) => e._id !== id);
			render();
		} catch (err) {
			console.error(err);
			alert(err.message || 'Failed to delete entry');
		}
	}

	function disableForm(disabled) {
		if (!form) return;
		const buttons = form.querySelectorAll('button');
		buttons.forEach((btn) => { btn.disabled = disabled; });
	}

	function escapeHtml(str) {
		return String(str)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}

	if (tableBody) {
		tableBody.addEventListener('click', (event) => {
			const target = event.target;
			if (!(target instanceof HTMLElement)) return;
			const action = target.dataset.action;
			const id = target.dataset.id;
			if (action === 'edit') {
				const entry = entries.find((e) => e._id === id);
				if (entry) openEditor(entry);
			}
			if (action === 'delete') {
				deleteEntry(id);
			}
		});
	}

	if (newBtn) {
		newBtn.addEventListener('click', () => openEditor(null));
	}
	if (cancelBtn) {
		cancelBtn.addEventListener('click', () => closeEditor());
	}
	if (form) {
		form.addEventListener('submit', saveEntry);
	}

	render();
});
