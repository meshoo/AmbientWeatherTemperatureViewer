// Fixed per-sensor series colors, keyed by channel key (never by position or
// enabled order), so a sensor keeps its color when others are toggled.
// Light and dark values are validated as a set; the DB `color` column is not
// used for rendering.
(function () {
    const PALETTE = {
        temp1f: { light: '#2a78d6', dark: '#3987e5' },
        temp2f: { light: '#eb6834', dark: '#d95926' },
        temp3f: { light: '#1baf7a', dark: '#199e70' },
        temp4f: { light: '#eda100', dark: '#c98500' },
        temp5f: { light: '#e87ba4', dark: '#d55181' },
        temp6f: { light: '#008300', dark: '#008300' },
        temp7f: { light: '#4a3aa7', dark: '#9085e9' },
        temp8f: { light: '#e34948', dark: '#e66767' },
    };
    const FALLBACK = '#8a8a86';

    function mode() {
        return 'light';
    }

    function color(key, m = 'light') {
        const entry = PALETTE[key];
        if (!entry) return FALLBACK;
        return entry[m] || entry.light;
    }

    window.SensorPalette = { color, mode };
})();
