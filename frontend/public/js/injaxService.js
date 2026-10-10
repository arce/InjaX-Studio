// frontend/public/js/injaxService.js

const InjaxService = (() => {
    async function generate(templateContent, dataContent, outputExt) {
        // invoke() rejects with a plain string when Rust returns Err(String)
        try {
            return await window.__TAURI__.core.invoke('generate_output', {
                templateContent,
                dataContent,
                outputExt: outputExt || 'txt',
            });
        } catch (e) {
            throw new Error(typeof e === 'string' ? e : (e?.message || String(e)));
        }
    }

    return { generate };
})();
