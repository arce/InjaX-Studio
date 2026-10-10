// frontend/public/js/app.js

let appLayout = null;

const AppState = {
    templates: [],       // [{name, content}, ...]
    activeIndex: -1,     // índice del template activo (-1 = ninguno)
    datasets: [],        // [{name, content}, ...]
    activeDataIndex: -1, // índice del dataset activo (-1 = ninguno)
    output: null,
    isGenerating: false,
    logs: []
};

async function initApp() {
    try {
        // Outer layout: left panel (40%) | main panel (60%)
        appLayout = new w2layout({
            name: 'mainLayout',
            padding: 0,
            panels: [
                { type: 'left', size: '40%', resizable: true, minSize: 280 },
                { type: 'main', minSize: 400 }
            ]
        });
        appLayout.render('#app');

        // Left panel: template editor (top) + message log (bottom)
        appLayout.html('left', `
            <div class="split-col" id="leftCol">
                <div class="split-pane" id="editorPane">
                    <div class="panel-header">
                        <span class="panel-title">InjaX Template</span>
                        <select id="templateSelect" class="file-select"
                            onchange="selectTemplate(parseInt(this.value))"
                            disabled>
                            <option value="-1">No file</option>
                        </select>
                    </div>
                    <div id="editorToolbarBox"></div>
                    <div id="editorFindBar" class="editor-find-bar" style="display:none;">
                        <input id="editorFindInput" type="text" placeholder="Find..." />
                        <span id="editorFindStatus" class="find-status"></span>
                        <button onclick="findNext()">▼</button>
                        <button onclick="findPrev()">▲</button>
                        <button onclick="toggleEditorFind()">✕</button>
                    </div>
                    <textarea id="templateEditor" class="code-editor" spellcheck="false"
                        placeholder="Load a .inja file or type your InjaX template here..."
                        oninput="onTemplateEdit(this.value)"
                        onkeydown="onEditorKeyDown(event)"></textarea>
                </div>
                <div class="split-handle" id="leftHandle"></div>
                <div class="split-pane" id="messagesPane" style="flex:0 0 160px;">
                    <div class="panel-header">
                        <span class="panel-title">Messages</span>
                        <span id="status" class="status-badge">-</span>
                    </div>
                    <div id="messagesArea" class="messages-area"></div>
                </div>
            </div>
        `);

        // Initialize the editor toolbar
        new w2toolbar({
            name: 'editorToolbar',
            box:  '#editorToolbarBox',
            items: [
                {
                    type: 'menu', id: 'file', text: 'File',
                    items: [
                        { id: 'file-open',    text: 'Open...'  },
                        { type: 'break' },
                        { id: 'file-save',    text: 'Save'     },
                        { id: 'file-save-as', text: 'Save As...' },
                        { type: 'break' },
                        { id: 'file-close',   text: 'Close'    },
                        { type: 'break' },
                        { id: 'file-quit',    text: 'Quit'     },
                    ],
                },
                { type: 'break'  },
                {
                    type: 'menu', id: 'edit', text: 'Edit',
                    items: [
                       { id: 'undo',      text: 'Undo',       tooltip: 'Undo (Ctrl+Z)'     },
                       { id: 'redo',      text: 'Redo',       tooltip: 'Redo (Ctrl+Y)'     },
                       { type: 'break'  },
                       { id: 'cut',       text: 'Cut',        tooltip: 'Cut (Ctrl+X)'      },
                       { id: 'copy',      text: 'Copy',       tooltip: 'Copy (Ctrl+C)'     },
                       { id: 'paste',     text: 'Paste',      tooltip: 'Paste (Ctrl+V)'    },
                       { type: 'break'  },
                       { id: 'selectAll', text: 'Select All', tooltip: 'Select All (Ctrl+A)' },
                       { type: 'break'  },
                       { id: 'find',      text: 'Find',       tooltip: 'Find (Ctrl+F)'     },
                    ],
                },			
                { type: 'break'  },
                { type: 'check',  id: 'wordwrap',  text: 'Wrap',       tooltip: 'Toggle word wrap'  },
            ],
            onClick(event) {
                const editor = document.getElementById('templateEditor');
                if (!editor) return;
                switch (event.target) {
                    case 'file:file-open':
                        loadTemplate();
                        break;
                    case 'file:file-save':
                        saveTemplate();
                        break;
                    case 'file:file-save-as':
                        saveTemplateAs();
                        break;
                    case 'file:file-close': {
                        if (AppState.activeIndex < 0) break;
                        if (!editor.value.trim() || confirm('Close the current template?')) {
                            AppState.templates.splice(AppState.activeIndex, 1);
                            const newIdx = AppState.templates.length > 0
                                ? Math.min(AppState.activeIndex, AppState.templates.length - 1)
                                : -1;
                            AppState.activeIndex = -1;
                            rebuildTemplateDropdown();
                            selectTemplate(newIdx);
                            addLog('Template closed');
                        }
                        break;
                    }
                    case 'file:file-quit':
                        if (confirm('Quit InjaX Studio?')) {
                            window.__TAURI__.core.invoke('quit_app').catch(() => window.close());
                        }
                        break;
                    case 'edit:undo':
                        editor.focus();
                        document.execCommand('undo');
                        break;
                    case 'edit:redo':
                        editor.focus();
                        document.execCommand('redo');
                        break;
                    case 'edit:cut':
                        editor.focus();
                        document.execCommand('cut');
                        break;
                    case 'edit:copy':
                        editor.focus();
                        document.execCommand('copy');
                        break;
                    case 'edit:paste':
                        editor.focus();
                        navigator.clipboard.readText().then(text => {
                            insertAtCursor(editor, text);
                            onTemplateEdit(editor.value);
                        });
                        break;
                    case 'edit:selectAll':
                        editor.focus();
                        editor.setSelectionRange(0, editor.value.length);
                        break;
                    case 'edit:find':
                        toggleEditorFind();
                        break;
                    case 'wordwrap': {
                        const item = w2ui['editorToolbar'].get('wordwrap');
                        editor.style.whiteSpace = item.checked ? 'pre-wrap' : 'pre';
                        editor.style.overflowX  = item.checked ? 'hidden'   : 'auto';
                        break;
                    }
                }
            }
        });

        // Main panel: SVG viewer (top 50%) + data table (bottom 50%)
        appLayout.html('main', `
            <div class="split-col" id="rightCol">
                <div class="split-pane" id="svgPane">
                    <div class="panel-header">
                        <span class="panel-title">Output</span>
                        <div style="display:flex;gap:6px;align-items:center;">
                            <span class="file-badge" id="svgName">No output</span>
                            <button id="generateBtn" class="btn-generate" onclick="generateOutput()" disabled>Generate</button>
                            <button id="exportBtn"   class="btn-export"   onclick="exportOutput()"   disabled>Export</button>
                        </div>
                    </div>
                    <div id="svgContainer" class="svg-container">
                        <div class="empty-state"><div class="empty-icon"></div><p>Generate output to view it here</p></div>
                    </div>
                </div>
                <div class="split-handle" id="rightHandle"></div>
                <div class="split-pane" id="dataPane">
                    <div class="panel-header">
                        <span class="panel-title">Data</span>
                        <select id="dataSelect" class="file-select"
                            onchange="selectDataset(parseInt(this.value))"
                            disabled>
                            <option value="-1">No file</option>
                        </select>
                    </div>
                    <div id="dataTableContainer" class="table-container"></div>
                </div>
            </div>
        `);

        // Wire up draggable splitters
        initSplitter('leftHandle',  'editorPane', 'messagesPane');
        initSplitter('rightHandle', 'svgPane',    'dataPane');

        // Show the data grid toolbar immediately (empty state)
        renderJsonTable(null);

        addLog('Application ready');
        updateStatus('Ready');

    } catch (error) {
        console.error('initApp error:', error);
        document.getElementById('app').innerHTML = `
            <div style="padding:40px;text-align:center;color:#e74c3c;">
                <h2>Startup error</h2><p>${error.message}</p>
            </div>`;
    }
}

// ─── Editor find bar ──────────────────────────────────────────────────────────

let _findMatches = [], _findIndex = -1;

function toggleEditorFind() {
    const bar = document.getElementById('editorFindBar');
    if (!bar) return;
    const visible = bar.style.display !== 'none';
    bar.style.display = visible ? 'none' : 'flex';
    if (!visible) {
        document.getElementById('editorFindInput').focus();
        _findMatches = [];
        _findIndex   = -1;
    }
}

function findInEditor(direction) {
    const editor = document.getElementById('templateEditor');
    const input  = document.getElementById('editorFindInput');
    const status = document.getElementById('editorFindStatus');
    if (!editor || !input) return;

    const needle = input.value;
    if (!needle) { if (status) status.textContent = ''; return; }

    const text = editor.value;
    _findMatches = [];
    let pos = 0;
    while (true) {
        const idx = text.toLowerCase().indexOf(needle.toLowerCase(), pos);
        if (idx === -1) break;
        _findMatches.push(idx);
        pos = idx + 1;
    }

    if (_findMatches.length === 0) {
        if (status) status.textContent = 'Not found';
        return;
    }

    if (direction === 'next') {
        _findIndex = (_findIndex + 1) % _findMatches.length;
    } else {
        _findIndex = (_findIndex - 1 + _findMatches.length) % _findMatches.length;
    }

    const start = _findMatches[_findIndex];
    editor.focus();
    editor.setSelectionRange(start, start + needle.length);
    if (status) status.textContent = `${_findIndex + 1} / ${_findMatches.length}`;
}

function findNext() { findInEditor('next'); }
function findPrev() { findInEditor('prev'); }

function onEditorKeyDown(e) {
    if (e.ctrlKey || e.metaKey) {
        if (e.key === 'f') { e.preventDefault(); toggleEditorFind(); }
        if (e.key === 'z') { setTimeout(() => onTemplateEdit(document.getElementById('templateEditor').value), 0); }
    }
    if (e.key === 'Escape') {
        const bar = document.getElementById('editorFindBar');
        if (bar && bar.style.display !== 'none') { toggleEditorFind(); }
    }
    if (e.key === 'Tab') {
        e.preventDefault();
        insertAtCursor(e.target, '  ');
        onTemplateEdit(e.target.value);
    }
}

function insertAtCursor(el, text) {
    const start = el.selectionStart;
    const end   = el.selectionEnd;
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    el.selectionStart = el.selectionEnd = start + text.length;
}

// ─── Draggable splitter ───────────────────────────────────────────────────────

function initSplitter(handleId, topId, bottomId) {
    const handle = document.getElementById(handleId);
    const top    = document.getElementById(topId);
    const bottom = document.getElementById(bottomId);
    if (!handle || !top || !bottom) return;

    let dragging = false, startY, startH;

    handle.addEventListener('mousedown', (e) => {
        dragging = true;
        startY   = e.clientY;
        startH   = top.getBoundingClientRect().height;
        document.body.style.userSelect = 'none';
        document.body.style.cursor     = 'row-resize';
    });

    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const delta  = e.clientY - startY;
        const parent = handle.parentElement;
        const total  = parent.getBoundingClientRect().height - handle.offsetHeight;
        const newH   = Math.max(80, Math.min(total - 80, startH + delta));
        top.style.flex    = `0 0 ${newH}px`;
        bottom.style.flex = '1 1 0';
    });

    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        document.body.style.userSelect = '';
        document.body.style.cursor     = '';
    });
}

// ─── State helpers ────────────────────────────────────────────────────────────

function onTemplateEdit(value) {
    if (AppState.activeIndex >= 0 && AppState.templates[AppState.activeIndex]) {
        AppState.templates[AppState.activeIndex].content = value;
    } else if (value.trim()) {
        AppState.templates.push({ name: 'template.inja', content: value });
        AppState.activeIndex = AppState.templates.length - 1;
        rebuildTemplateDropdown();
        selectTemplate(AppState.activeIndex);
    }
    checkReady();
}

function updateStatus(message, type) {
    const el = document.getElementById('status');
    if (!el) return;
    el.textContent = message;
    el.className = 'status-badge' + (type ? ' ' + type : '');
}

function addLog(message) {
    const ts = new Date().toLocaleTimeString();
    AppState.logs.push({ ts, message });
    const area = document.getElementById('messagesArea');
    if (area) {
        area.innerHTML += `<div class="log-line"><span class="log-ts">${ts}</span>${escLog(message)}</div>`;
        area.scrollTop  = area.scrollHeight;
    }
}

function escLog(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function updateFilePreview(type, name, content) {
    if (type === 'template') {
        const editor = document.getElementById('templateEditor');
        if (editor) editor.value = content;
    }
}

// ─── Multi-file template management ──────────────────────────────────────────


function rebuildTemplateDropdown() {
    const sel = document.getElementById('templateSelect');
    if (!sel) return;
    sel.innerHTML = '';
    if (AppState.templates.length === 0) {
        sel.appendChild(new Option('No file', '-1'));
        sel.disabled = true;
    } else {
        AppState.templates.forEach((t, i) => {
            sel.appendChild(new Option(t.name, String(i)));
        });
        sel.disabled = false;
    }
}

function selectTemplate(index) {
    const editor = document.getElementById('templateEditor');
    // Persist current edits before switching
    if (AppState.activeIndex >= 0 && AppState.templates[AppState.activeIndex] && editor) {
        AppState.templates[AppState.activeIndex].content = editor.value;
    }
    AppState.activeIndex = index;
    if (index >= 0 && AppState.templates[index]) {
        if (editor) editor.value = AppState.templates[index].content;
    } else {
        if (editor) editor.value = '';
    }
    const sel = document.getElementById('templateSelect');
    if (sel) sel.value = String(index);
    checkReady();
}

function checkReady() {
    const tmpl = AppState.activeIndex >= 0 ? AppState.templates[AppState.activeIndex] : null;
    const ds   = AppState.activeDataIndex >= 0 ? AppState.datasets[AppState.activeDataIndex] : null;
    const ready = !!(tmpl?.content?.trim() && ds);
    const btn = document.getElementById('generateBtn');
    if (btn) btn.disabled = !ready;
}

// ─── Multi-file dataset management ───────────────────────────────────────────

function rebuildDataDropdown() {
    const sel = document.getElementById('dataSelect');
    if (!sel) return;
    sel.innerHTML = '';
    if (AppState.datasets.length === 0) {
        sel.appendChild(new Option('No file', '-1'));
        sel.disabled = true;
    } else {
        AppState.datasets.forEach((d, i) => {
            sel.appendChild(new Option(d.name, String(i)));
        });
        sel.disabled = false;
    }
}

function selectDataset(index) {
    // Flush current grid edits before switching
    syncGridToState();
    AppState.activeDataIndex = index;
    if (index >= 0 && AppState.datasets[index]) {
        try {
            renderJsonTable(JSON.parse(AppState.datasets[index].content));
        } catch {
            renderJsonTable(null);
        }
    } else {
        renderJsonTable(null);
    }
    const sel = document.getElementById('dataSelect');
    if (sel) sel.value = String(index);
    checkReady();
}

document.addEventListener('DOMContentLoaded', initApp);

// ─── Native menu events (Tauri) ───────────────────────────────────────────────

window.__TAURI__?.event?.listen('menu-action', (event) => {
    switch (event.payload) {
        case 'template-load': loadTemplate(); break;
        case 'template-save': saveTemplate(); break;
        case 'data-load':     loadData();     break;
        case 'data-save':     saveData();     break;
        case 'view-generate': generateOutput();  break;
        case 'view-save':     exportOutput();    break;
    }
});
