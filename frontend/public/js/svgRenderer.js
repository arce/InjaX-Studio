// frontend/public/js/svgRenderer.js

// Tauri invoke rejects with a plain string, not an Error object — normalize always
function errMsg(e) {
    if (typeof e === 'string') return e;
    return e?.message || String(e) || 'Unknown error';
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Strip <script> tags and inline event handlers from SVG content
function sanitizeSVG(svgContent) {
    let clean = svgContent.replace(/<script[\s\S]*?<\/script>/gi, '');
    clean = clean.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
    clean = clean.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, '');
    return clean;
}

function renderSVG(svgContent) {
    const container = document.getElementById('svgContainer');
    if (!container) return;

    try {
        container.innerHTML = '';
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;';
        wrapper.innerHTML = sanitizeSVG(svgContent);
        container.appendChild(wrapper);
        addZoomControls(container);
        addLog('SVG rendered successfully');
    } catch (error) {
        const msg = errMsg(error);
        console.error('SVG render error:', error);
        container.innerHTML = `
            <div style="text-align:center;color:#e74c3c;">
                <div style="font-size:48px;margin-bottom:10px;">⚠️</div>
                <p>Failed to render SVG</p>
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

async function generateSVG() {
    const tmpl = AppState.activeIndex >= 0 ? AppState.templates[AppState.activeIndex] : null;
    const ds   = AppState.activeDataIndex >= 0 ? AppState.datasets[AppState.activeDataIndex] : null;
    if (!tmpl || !ds) {
        alert('Load a template and data file first');
        return;
    }

    const generateBtn = document.getElementById('generateBtn');
    if (generateBtn) {
        generateBtn.disabled    = true;
        generateBtn.textContent = 'Generating...';
    }

    updateStatus('Generating...', 'busy');
    addLog('Starting SVG generation...');

    try {
        const svgContent = await InjaxService.generate(
            tmpl.content,
            ds.content
        );

        const outputName = `${tmpl.name.replace(/\.(j2|jinja2?)$/, '')}_output.svg`;
        AppState.svg = { name: outputName, content: svgContent };

        renderSVG(svgContent);
        document.getElementById('svgName').textContent = outputName;
        const exportBtn = document.getElementById('exportBtn');
        if (exportBtn) exportBtn.disabled = false;
        updateStatus('SVG ready', 'ok');
        addLog('SVG generated successfully');

    } catch (error) {
        const msg = errMsg(error);
        console.error('SVG generation error:', error);
        updateStatus('Generation failed', 'error');
        addLog(`Error: ${msg}`);

        const container = document.getElementById('svgContainer');
        if (container) {
            container.innerHTML = `
                <div style="text-align:center;color:#e74c3c;padding:20px;">
                    <div style="font-size:48px;margin-bottom:10px;">❌</div>
                    <p>SVG generation failed</p>
                    <pre style="font-size:11px;color:#f48771;margin-top:10px;text-align:left;background:#1a1a1a;padding:10px;border-radius:4px;overflow:auto;max-height:200px;">${escHtml(msg)}</pre>
                    <button onclick="generateSVG()" style="margin-top:15px;padding:8px 20px;background:#3498db;color:white;border:none;border-radius:4px;cursor:pointer;">
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

async function exportSVG() {
    const svgEl = document.querySelector('#svgContainer svg');
    if (!AppState.svg && !svgEl) {
        alert('No SVG to export');
        return;
    }

    try {
        const svgContent = AppState.svg ? AppState.svg.content : svgEl.outerHTML;
        const defaultName = AppState.svg ? AppState.svg.name : 'output.svg';
        const saved = await window.__TAURI__.core.invoke('save_svg', {
            content: svgContent,
            defaultName,
        });
        if (saved) {
            updateStatus('SVG exported', 'ok');
            addLog('SVG exported successfully');
        }
    } catch (error) {
        const msg = errMsg(error);
        console.error('SVG export error:', error);
        addLog(`Export error: ${msg}`);
        alert(`Failed to export SVG: ${msg}`);
    }
}
