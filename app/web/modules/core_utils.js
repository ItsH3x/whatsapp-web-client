(function() {
    'use strict';
    var app = window.__waApp = window.__waApp || {};
    if (app.core) return;

    var STORAGE_KEY_WIDTH = 'wa_sidebar_width';
    var STORAGE_KEY_COMPACT = 'wa_sidebar_compact';
    var STORAGE_KEY_RIGHT_WIDTH = 'wa_right_panel_width';
    var STORAGE_KEY_LAST_THEME_ACCENT = 'wa_last_theme_accent';

    var MIN_WIDTH = 280;
    var DEFAULT_WIDTH = 360;
    var MIN_RIGHT_WIDTH = 220;
    var DEFAULT_RIGHT_WIDTH = 340;
    var MAIN_SCALE_THRESHOLD = 450;
    var MAIN_SCALE_MIN = 0.55;

    var OVERLAY_CHECK_SELECTOR = '[data-animate-modal-popup="true"], [data-animate-modal-backdrop="true"], ' +
                                 '[data-animate-modal-media="true"], [data-animate-picker="true"], ' +
                                 '[data-animate-dropdown-item="true"], [data-testid="media-viewer"], ' +
                                 '[data-testid="popup-contents"], [role="dialog"], [role="menu"], ' +
                                 '#wa-privacy-blur-overlay';

    function readStorage(key) {
        try {
            return localStorage.getItem(key);
        } catch (e) {
            return null;
        }
    }

    function writeStorage(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch (e) {}
    }

    function getMaxWidth() {
        return Math.floor(window.innerWidth * 0.5);
    }

    function getSavedWidth() {
        var saved = readStorage(STORAGE_KEY_WIDTH);
        var parsed = parseInt(saved, 10);
        if (isNaN(parsed) || parsed < MIN_WIDTH) {
            return DEFAULT_WIDTH;
        }
        var max = getMaxWidth();
        if (parsed > max) {
            return max;
        }
        return parsed;
    }

    function saveWidth(width) {
        writeStorage(STORAGE_KEY_WIDTH, String(width));
    }

    function getSavedRightWidth(maxRightWidth) {
        var saved = readStorage(STORAGE_KEY_RIGHT_WIDTH);
        var parsed = parseInt(saved, 10);
        var base = (isNaN(parsed) || parsed < MIN_RIGHT_WIDTH) ? DEFAULT_RIGHT_WIDTH : parsed;
        var maxRight = (typeof maxRightWidth === 'number' && isFinite(maxRightWidth))
            ? maxRightWidth
            : Math.max(MIN_RIGHT_WIDTH, getMaxWidth());
        return Math.max(MIN_RIGHT_WIDTH, Math.min(base, maxRight));
    }

    function saveRightWidth(width) {
        writeStorage(STORAGE_KEY_RIGHT_WIDTH, String(width));
    }

    function getSavedCompact() {
        return readStorage(STORAGE_KEY_COMPACT) === 'true';
    }

    function saveCompact(isCompact) {
        writeStorage(STORAGE_KEY_COMPACT, isCompact ? 'true' : 'false');
    }

    function getSavedThemeAccent() {
        try {
            var raw = readStorage(STORAGE_KEY_LAST_THEME_ACCENT);
            if (raw) {
                var parsed = JSON.parse(raw);
                if (parsed && typeof parsed.r === 'number') return parsed;
            }
        } catch (e) {}
        return null;
    }

    function saveThemeAccent(col) {
        if (!col) return col;
        try {
            writeStorage(STORAGE_KEY_LAST_THEME_ACCENT, JSON.stringify(col));
        } catch (e) {}
        return col;
    }

    function isCompactActive() {
        return !!(document.body && document.body.classList.contains('wa-sidebar-compact'));
    }

    function isElementVisible(el) {
        if (!el || !el.isConnected) return false;
        var rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        var cs = window.getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) <= 0) {
            return false;
        }
        if (cs.pointerEvents === 'none') {
            return false;
        }
        if (el.children.length === 0 && (!el.textContent || !el.textContent.trim())) {
            var bg = cs.backgroundColor;
            if ((!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') && cs.backgroundImage === 'none') {
                return false;
            }
        }
        return true;
    }

    function isPopupCandidatePresent(el) {
        if (!el || !el.isConnected) return false;
        var cs = window.getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden';
    }

    function rectsIntersect(a, b, pad) {
        var p = pad || 0;
        return a.left - p <= b.right &&
               a.right + p >= b.left &&
               a.top - p <= b.bottom &&
               a.bottom + p >= b.top;
    }

    function parseCssColor(str) {
        if (!str || typeof str !== 'string') return null;
        var s = str.trim().toLowerCase();
        if (!s || s === 'transparent' || s === 'none' || s === 'inherit' || s === 'initial' || s === 'unset') {
            return null;
        }
        var rgbMatch = s.match(/^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
        if (rgbMatch) {
            var r = Math.max(0, Math.min(255, Math.round(parseFloat(rgbMatch[1]))));
            var g = Math.max(0, Math.min(255, Math.round(parseFloat(rgbMatch[2]))));
            var b = Math.max(0, Math.min(255, Math.round(parseFloat(rgbMatch[3]))));
            var a = 1;
            if (rgbMatch[4] !== undefined) {
                a = rgbMatch[4].indexOf('%') !== -1 ? parseFloat(rgbMatch[4]) / 100 : parseFloat(rgbMatch[4]);
            }
            return { r: r, g: g, b: b, a: isNaN(a) ? 1 : a };
        }
        var hexMatch = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/);
        if (hexMatch) {
            var hex = hexMatch[1];
            if (hex.length === 3) {
                return {
                    r: parseInt(hex.charAt(0) + hex.charAt(0), 16),
                    g: parseInt(hex.charAt(1) + hex.charAt(1), 16),
                    b: parseInt(hex.charAt(2) + hex.charAt(2), 16),
                    a: 1
                };
            }
            var alpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
            return {
                r: parseInt(hex.slice(0, 2), 16),
                g: parseInt(hex.slice(2, 4), 16),
                b: parseInt(hex.slice(4, 6), 16),
                a: alpha
            };
        }
        var srgbMatch = s.match(/^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/);
        if (srgbMatch) {
            var sa = 1;
            if (srgbMatch[4] !== undefined) {
                sa = srgbMatch[4].indexOf('%') !== -1 ? parseFloat(srgbMatch[4]) / 100 : parseFloat(srgbMatch[4]);
            }
            return {
                r: Math.max(0, Math.min(255, Math.round(parseFloat(srgbMatch[1]) * 255))),
                g: Math.max(0, Math.min(255, Math.round(parseFloat(srgbMatch[2]) * 255))),
                b: Math.max(0, Math.min(255, Math.round(parseFloat(srgbMatch[3]) * 255))),
                a: isNaN(sa) ? 1 : sa
            };
        }
        return null;
    }

    function rgbToHsl(r, g, b) {
        var rn = r / 255;
        var gn = g / 255;
        var bn = b / 255;
        var max = Math.max(rn, gn, bn);
        var min = Math.min(rn, gn, bn);
        var l = (max + min) / 2;
        var s = 0;
        if (max !== min) {
            var d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        }
        return { s: s, l: l };
    }

    function rgbToHue(r, g, b) {
        var rn = r / 255, gn = g / 255, bn = b / 255;
        var max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
        var d = max - min;
        if (d === 0) return 0;
        var h;
        if (max === rn) h = ((gn - bn) / d) % 6;
        else if (max === gn) h = (bn - rn) / d + 2;
        else h = (rn - gn) / d + 4;
        h *= 60;
        return h < 0 ? h + 360 : h;
    }

    function hslToRgb(h, s, l) {
        var c = (1 - Math.abs(2 * l - 1)) * s;
        var x = c * (1 - Math.abs((h / 60) % 2 - 1));
        var m = l - c / 2;
        var r1 = 0, g1 = 0, b1 = 0;
        if (h < 60) { r1 = c; g1 = x; }
        else if (h < 120) { r1 = x; g1 = c; }
        else if (h < 180) { g1 = c; b1 = x; }
        else if (h < 240) { g1 = x; b1 = c; }
        else if (h < 300) { r1 = x; b1 = c; }
        else { r1 = c; b1 = x; }
        return {
            r: Math.round((r1 + m) * 255),
            g: Math.round((g1 + m) * 255),
            b: Math.round((b1 + m) * 255),
            a: 1
        };
    }

    function relativeLuminance(rgba) {
        function toLin(c) {
            var v = c / 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        }
        return 0.2126 * toLin(rgba.r) + 0.7152 * toLin(rgba.g) + 0.0722 * toLin(rgba.b);
    }

    function contrastRatio(c1, c2) {
        var l1 = relativeLuminance(c1);
        var l2 = relativeLuminance(c2);
        var hi = Math.max(l1, l2);
        var lo = Math.min(l1, l2);
        return (hi + 0.05) / (lo + 0.05);
    }

    app.core = {
        STORAGE_KEY_WIDTH: STORAGE_KEY_WIDTH,
        STORAGE_KEY_COMPACT: STORAGE_KEY_COMPACT,
        STORAGE_KEY_RIGHT_WIDTH: STORAGE_KEY_RIGHT_WIDTH,
        STORAGE_KEY_LAST_THEME_ACCENT: STORAGE_KEY_LAST_THEME_ACCENT,
        MIN_WIDTH: MIN_WIDTH,
        DEFAULT_WIDTH: DEFAULT_WIDTH,
        MIN_RIGHT_WIDTH: MIN_RIGHT_WIDTH,
        DEFAULT_RIGHT_WIDTH: DEFAULT_RIGHT_WIDTH,
        MAIN_SCALE_THRESHOLD: MAIN_SCALE_THRESHOLD,
        MAIN_SCALE_MIN: MAIN_SCALE_MIN,
        OVERLAY_CHECK_SELECTOR: OVERLAY_CHECK_SELECTOR,
        readStorage: readStorage,
        writeStorage: writeStorage,
        getMaxWidth: getMaxWidth,
        getSavedWidth: getSavedWidth,
        saveWidth: saveWidth,
        getSavedRightWidth: getSavedRightWidth,
        saveRightWidth: saveRightWidth,
        getSavedCompact: getSavedCompact,
        saveCompact: saveCompact,
        getSavedThemeAccent: getSavedThemeAccent,
        saveThemeAccent: saveThemeAccent,
        isCompactActive: isCompactActive,
        isElementVisible: isElementVisible,
        isPopupCandidatePresent: isPopupCandidatePresent,
        rectsIntersect: rectsIntersect,
        parseCssColor: parseCssColor,
        rgbToHsl: rgbToHsl,
        rgbToHue: rgbToHue,
        hslToRgb: hslToRgb,
        relativeLuminance: relativeLuminance,
        contrastRatio: contrastRatio
    };
})();
