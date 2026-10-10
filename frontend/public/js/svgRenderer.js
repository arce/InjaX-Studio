// frontend/public/js/svgRenderer.js

function errMsg(e) {
    if (typeof e === 'string') return e;
    return e?.message || String(e) || 'Unknown error';
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sanitizeSVG(svgContent) {
    let clean = svgContent.replace(/<script[\s\S]*?<\/script>/gi, '');
    clean = clean.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
    clean = clean.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, '');
    return clean;
}

function getOutputExt(templateName) {
    const m = templateName.match(/-(\w+)\.inja[x]?$/i);
    return m ? m[1].toLowerCase() : 'txt';
}

function renderOutput(content, ext) {
    const container = document.getElementById('svgContainer');
    if (!container) return;
    container.innerHTML = '';

    try {
        if (ext === 'svg') {
            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;';
            wrapper.innerHTML = sanitizeSVG(content);
            container.appendChild(wrapper);
            addZoomControls(container);
            addLog('SVG rendered successfully');
        } else if (ext === 'html') {
            const iframe = document.createElement('iframe');
            iframe.style.cssText = 'width:100%;height:100%;border:none;background:white;';
            iframe.srcdoc = content;
            container.appendChild(iframe);
            addLog('HTML rendered successfully');
        } else {
            const pre = document.createElement('pre');
            pre.style.cssText = 'margin:0;padding:12px;overflow:auto;width:100%;height:100%;box-sizing:border-box;font-size:12px;line-height:1.5;color:inherit;';
            pre.textContent = content;
            container.appendChild(pre);
            addLog(`${ext.toUpperCase()} rendered successfully`);
        }
    } catch (error) {
        const msg = errMsg(error);
        console.error('Render error:', error);
        container.innerHTML = `
            <div style="text-align:center;color:#e74c3c;">
                <div style="font-size:48px;margin-bottom:10px;">⚠️</div>
                <p>Failed to render output</p>
                <p style="font-size:12px;color:#95a5a6;">${escHtml(msg)}</p>
            </div>
        `;
        addLog(`Render error: ${msg}`);
    }
}

function addZoomControls(container) {
    const existing = container.querySelector('.zoom-controls');
    if (existing) existing.remove();
    const controls = document.createElement('div');
    controls.className = 'zoom-controls';
    controls.innerHTML = `
        <button onclick="zoomSVG(1.2)" title="Zoom in">+</button>
        <button onclick="zoomSVG(0.8)" title="Zoom out">−</button>
        <button onclick="resetZoomSVG()" title="Reset zoom">⟲</button>
    `;
    container.appendChild(controls);
}

let zoomLevel = 1;

function zoomSVG(factor) {
    const svg = document.querySelector('#svgContainer svg');
    if (svg) {
        zoomLevel *= factor;
        svg.style.transform       = `scale(${zoomLevel})`;
        svg.style.transformOrigin = 'center center';
        addLog(`Zoom: ${(zoomLevel * 100).toFixed(0)}%`);
    }
}

function resetZoomSVG() {
    const svg = document.querySelector('#svgContainer svg');
    if (svg) {
        zoomLevel             = 1;
        svg.style.transform   = 'scale(1)';
        addLog('Zoom reset');
    }
}

async function generateOutput() {
    const tmpl = AppState.activeIndex >= 0 ? AppState.templates[AppState.activeIndex] : null;
    const ds   = AppState.activeDataIndex >= 0 ? AppState.datasets[AppState.activeDataIndex] : null;
    if (!tmpl || !ds) {
        alert('Load a template and data file first');
        return;
    }

    const ext = getOutputExt(tmpl.name);

    const generateBtn = document.getElementById('generateBtn');
    if (generateBtn) {
        generateBtn.disabled    = true;
        generateBtn.textContent = 'Generating...';
    }

    updateStatus('Generating...', 'busy');
    addLog('Starting generation...');

    try {
        const content = await InjaxService.generate(tmpl.content, ds.content, ext);

        const stem = ds.name.replace(/\.[^.]+$/, '');
        const outputName = `${stem}.${ext}`;
        AppState.output = { name: outputName, content, ext };

        renderOutput(content, ext);
        document.getElementById('svgName').textContent = outputName;
        const exportBtn = document.getElementById('exportBtn');
        if (exportBtn) exportBtn.disabled = false;
        updateStatus('Ready', 'ok');
        addLog(`${ext.toUpperCase()} generated successfully`);

    } catch (error) {
        const msg = errMsg(error);
        console.error('Generation error:', error);
        updateStatus('Generation failed', 'error');
        addLog(`Error: ${msg}`);

        const container = document.getElementById('svgContainer');
        if (container) {
            container.innerHTML = `
                <div style="text-align:center;color:#e74c3c;padding:20px;">
                    <div style="font-size:48px;margin-bottom:10px;">❌</div>
                    <p>Generation failed</p>
                    <pre style="font-size:11px;color:#f48771;margin-top:10px;text-align:left;background:#1a1a1a;padding:10px;border-radius:4px;overflow:auto;max-height:200px;">${escHtml(msg)}</pre>
                    <button onclick="generateOutput()" style="margin-top:15px;padding:8px 20px;background:#3498db;color:white;border:none;border-radius:4px;cursor:pointer;">
                        Retry
                    </button>
                </div>
            `;
        }
    } finally {
        if (generateBtn) {
            generateBtn.disabled    = false;
            generateBtn.textContent = 'Generate';
        }
    }
}

async function exportOutput() {
    if (!AppState.output) {
        alert('No output to export');
        return;
    }

    try {
        const { name, content, ext } = AppState.output;
        const saved = await window.__TAURI__.core.invoke('save_output', {
            content,
            defaultName: name,
            ext,
        });
        if (saved) {
            updateStatus('Output exported', 'ok');
            addLog('Output exported successfully');
        }
    } catch (error) {
        const msg = errMsg(error);
        console.error('Export error:', error);
        addLog(`Export error: ${msg}`);
        alert(`Failed to export: ${msg}`);
    }
}