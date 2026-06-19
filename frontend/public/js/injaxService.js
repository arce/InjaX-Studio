// frontend/public/js/injaxService.js

const InjaxService = (() => {
    async function generate(templateContent, dataContent) {
        // invoke() rejects with a plain string when Rust returns Err(String)
        let svgContent;
        try {
            svgContent = await window.__TAURI__.core.invoke('generate_svg', {
                templateContent,
                dataContent,
            });
        } catch (e) {
            throw new Error(typeof e === 'string' ? e : (e?.message || String(e)));
        }

        if (!svgContent || !svgContent.includes('<svg')) {
            throw new Error('Generated file is not a valid SVG');
        }
        return svgContent;
    }

    return { generate };
})();
