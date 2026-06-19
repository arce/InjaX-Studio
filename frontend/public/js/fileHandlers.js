// frontend/public/js/fileHandlers.js

function pickFile(accept) {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type   = 'file';
        input.accept = accept;
        input.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
        document.body.appendChild(input);

        const cleanup = (file) => {
            try { document.body.removeChild(input); } catch {}
            resolve(file);
        };

        input.addEventListener('change', (e) => cleanup(e.target.files[0] || null));

        // Fallback: if the user closes the dialog without selecting, focus returns to window
        window.addEventListener('focus', function onFocus() {
            window.removeEventListener('focus', onFocus);
            setTimeout(() => {
                if (!input.files || input.files.length === 0) cleanup(null);
            }, 300);
        }, { once: true });

        input.click();
    });
}

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = (e) => resolve(e.target.result);
        reader.onerror = () => reject(new Error('Error reading file'));
        reader.readAsText(file);
    });
}

// ─── Load template ────────────────────────────────────────────────────────────

async function loadTemplate() {
    try {
        const file = await pickFile('.inja,.injax,.txt');
        if (!file) return;

        const content = await readFileAsText(file);
        if (!content?.trim()) throw new Error('File is empty');

        // Persist any edits to the currently active template before switching
        const editor = document.getElementById('templateEditor');
        if (AppState.activeIndex >= 0 && AppState.templates[AppState.activeIndex] && editor) {
            AppState.templates[AppState.activeIndex].content = editor.value;
        }

        AppState.templates.push({ name: file.name, content });
        const newIndex = AppState.templates.length - 1;
        rebuildTemplateDropdown();
        selectTemplate(newIndex);

        updateStatus(`Template: ${file.name}`, 'ok');
        addLog(`Template loaded: ${file.name}`);
        checkReady();
    } catch (error) {
        updateStatus('Error loading template', 'error');
        addLog(`Error: ${error.message}`);
        alert(error.message);
    }
}

// ─── Load JSON data ───────────────────────────────────────────────────────────

async function loadData() {
    try {
        const file = await pickFile('.json');
        if (!file) return;

        const content = await readFileAsText(file);
        let parsed;
        try {
            parsed = JSON.parse(content);
        } catch {
            throw new Error('File is not valid JSON');
        }

        // Flush current grid edits before switching
        syncGridToState();

        AppState.datasets.push({ name: file.name, content });
        const newIndex = AppState.datasets.length - 1;
        rebuildDataDropdown();
        selectDataset(newIndex);

        updateStatus(`Data: ${file.name}`, 'ok');
        addLog(`Data loaded: ${file.name}`);
        checkReady();
    } catch (error) {
        updateStatus('Error loading data', 'error');
        addLog(`Error: ${error.message}`);
        alert(error.message);
    }
}

// ─── Load existing SVG ────────────────────────────────────────────────────────

async function loadExistingSVG() {
    try {
        const file = await pickFile('.svg');
        if (!file) return;

        const content = await readFileAsText(file);
        if (!content.includes('<svg') && !content.includes('<?xml')) {
            throw new Error('File is not a valid SVG');
        }

        AppState.svg = { name: file.name, content };
        renderSVG(content);
        document.getElementById('svgName').textContent = file.name;
        addLog(`SVG loaded: ${file.name}`);
    } catch (error) {
        addLog(`Error: ${error.message}`);
        alert(error.message);
    }
}

// ─── Render JSON table ────────────────────────────────────────────────────────

// Active column list for the editable grid (needed to rebuild JSON on save)
let _gridCols = [];

function destroyDataGrid() {
    if (w2ui['dataGrid']) {
        try { w2ui['dataGrid'].destroy(); } catch {}
    }
}

// Detect the dominant type of a column's values to set the right editable type
function detectColumnType(data, col) {
    let intCount = 0, floatCount = 0, total = 0;
    for (const row of data) {
        const v = row[col];
        if (v === null || v === undefined || v === '') continue;
        total++;
        if (typeof v === 'number') {
            Number.isInteger(v) ? intCount++ : floatCount++;
        } else if (typeof v === 'string') {
            const n = Number(v);
            if (!isNaN(n) && v.trim() !== '') {
                Number.isInteger(n) ? intCount++ : floatCount++;
            }
        }
    }
    if (total === 0) return 'text';
    if ((intCount + floatCount) / total >= 0.8) return floatCount > 0 ? 'float' : 'int';
    return 'text';
}

function exportGridToCSV() {
    const grid = w2ui['dataGrid'];
    if (!grid || _gridCols.length === 0) return;
    const header = _gridCols.join(',');
    const rows = grid.records.map(rec =>
        _gridCols.map(c => {
            const val = String(rec[c] ?? '').replace(/"/g, '""');
            return val.includes(',') || val.includes('"') || val.includes('\n') ? `"${val}"` : val;
        }).join(',')
    );
    const csv = [header, ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    const ds = AppState.activeDataIndex >= 0 ? AppState.datasets[AppState.activeDataIndex] : null;
    a.download = (ds?.name?.replace('.json', '') || 'data') + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addLog('Exported grid to CSV');
}

function renderJsonTable(data) {
    const container = document.getElementById('dataTableContainer');
    if (!container) return;

    destroyDataGrid();
    _gridCols = [];

    // Determine what kind of data we have
    const isArrayOfObjects = Array.isArray(data) && data.length > 0 && typeof data[0] === 'object';
    const isPlainObject    = data !== null && data !== undefined && typeof data === 'object' && !Array.isArray(data);

    if (isArrayOfObjects) {
        _gridCols = Object.keys(data[0]);
    }

    container.innerHTML = '<div id="dataGridBox" style="width:100%;height:100%;"></div>';

    const columns = isArrayOfObjects
        ? _gridCols.map(c => ({
            field:     c,
            text:      c,
            size:      '150px',
            sortable:  true,
            resizable: true,
            editable:  { type: detectColumnType(data, c) },
          }))
        : [];

    const records = isArrayOfObjects
        ? data.map((row, i) => {
            const rec = { recid: i + 1 };
            _gridCols.forEach(c => {
                const v = row[c];
                rec[c] = (v === null || v === undefined) ? ''
                       : typeof v === 'object' ? JSON.stringify(v) : v;
            });
            return rec;
          })
        : [];

    new w2grid({
        name:        'dataGrid',
        box:         '#dataGridBox',
        columns,
        records,
        multiSelect: isArrayOfObjects,
        reorderRows: isArrayOfObjects,

        show: {
            toolbar:        true,
            toolbarAdd:     isArrayOfObjects,
            toolbarDelete:  isArrayOfObjects,
            toolbarSearch:  isArrayOfObjects,
            toolbarColumns: isArrayOfObjects,
            selectColumn:   isArrayOfObjects,
            lineNumbers:    isArrayOfObjects,
            footer:         true,
        },

        toolbar: {
            items: [
                { type: 'button', id: 'openJSON',   text: 'Open', tooltip: 'Load JSON data file' },
                ...(isArrayOfObjects
                    ? [{ type: 'break' }, { type: 'button', id: 'exportCSV', text: 'CSV ↓', tooltip: 'Export to CSV' }]
                    : []),
            ],
            onClick(event) {
                if (event.target === 'openJSON')   loadData();
                if (event.target === 'exportCSV')  exportGridToCSV();
            },
        },

        onAdd(event) {
            const grid = w2ui['dataGrid'];
            const newRec = { recid: (grid.records.length + 1) };
            _gridCols.forEach(c => { newRec[c] = ''; });
            grid.add(newRec);
            syncGridToState();
        },
        onDelete(event)    { event.onComplete = () => syncGridToState(); },
        onReorderRow(event){ event.onComplete = () => syncGridToState(); },
        onSave(event)      { event.onComplete = () => syncGridToState(); },
        onChange(event)    { event.onComplete = () => syncGridToState(); },
    });

    if (isArrayOfObjects) {
        addLog(`Table loaded: ${records.length} row(s) · ${_gridCols.length} column(s)`);
    } else if (isPlainObject) {
        const entries = Object.entries(data);
        let html = '<div class="table-scroll" style="position:absolute;inset:0;z-index:1;background:#fff;">'
                 + '<table class="data-table kv-table">'
                 + '<thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>';
        entries.forEach(([k, v]) => {
            const display = typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
            html += `<tr><td class="key-cell">${escHtml(k)}</td>`
                  + `<td class="${typeof v === 'object' ? 'json-cell' : ''}">${escHtml(display)}</td></tr>`;
        });
        html += `</tbody></table></div>`
              + `<div class="table-footer" style="position:absolute;bottom:0;left:0;right:0;z-index:1;">`
              + `${entries.length} variable(s)</div>`;
        const box = document.getElementById('dataGridBox');
        if (box) box.insertAdjacentHTML('afterend', html);
        addLog(`Object loaded: ${entries.length} variable(s)`);
    }
}

// Rebuild the active dataset's content from the current grid state
function syncGridToState() {
    const grid = w2ui['dataGrid'];
    const ds = AppState.activeDataIndex >= 0 ? AppState.datasets[AppState.activeDataIndex] : null;
    if (!grid || !ds || _gridCols.length === 0) return;
    const updated = grid.records.map(rec => {
        const row = {};
        _gridCols.forEach(c => { row[c] = rec[c]; });
        return row;
    });
    ds.content = JSON.stringify(updated, null, 2);
}

// ─── Save template ────────────────────────────────────────────────────────────

async function saveTemplate() {
    const tmpl = AppState.activeIndex >= 0 ? AppState.templates[AppState.activeIndex] : null;
    if (!tmpl?.content?.trim()) {
        alert('No template to save');
        return;
    }
    try {
        const saved = await window.__TAURI__.core.invoke('save_template', {
            content: tmpl.content,
        });
        if (saved) {
            updateStatus('Template saved', 'ok');
            addLog('Template saved successfully');
        }
    } catch (error) {
        const msg = typeof error === 'string' ? error : error?.message || String(error);
        updateStatus('Error saving template', 'error');
        addLog(`Error: ${msg}`);
        alert(`Failed to save template: ${msg}`);
    }
}

// ─── Save JSON data ───────────────────────────────────────────────────────────

async function saveData() {
    // Flush any pending grid edits before saving
    syncGridToState();
    const ds = AppState.activeDataIndex >= 0 ? AppState.datasets[AppState.activeDataIndex] : null;
    if (!ds?.content) {
        alert('No data to save');
        return;
    }
    try {
        const saved = await window.__TAURI__.core.invoke('save_data', {
            content: ds.content,
        });
        if (saved) {
            updateStatus('Data saved', 'ok');
            addLog('JSON data saved successfully');
        }
    } catch (error) {
        const msg = typeof error === 'string' ? error : error?.message || String(error);
        updateStatus('Error saving data', 'error');
        addLog(`Error: ${msg}`);
        alert(`Failed to save data: ${msg}`);
    }
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function checkReady() {
    const tmpl = AppState.activeIndex >= 0 ? AppState.templates[AppState.activeIndex] : null;
    const ds   = AppState.activeDataIndex >= 0 ? AppState.datasets[AppState.activeDataIndex] : null;
    const ready = !!(tmpl?.content?.trim() && ds);
    const btn = document.getElementById('generateBtn');
    if (btn) btn.disabled = !ready;
}
