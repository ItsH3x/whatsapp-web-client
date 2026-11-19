(function() {
    // 1. Inyectar estilos CSS para scrollbar y badges de atajos
    if (!document.getElementById('wa-alt-badge-styles')) {
        var style = document.createElement('style');
        style.id = 'wa-alt-badge-styles';
        style.textContent = `
            ::-webkit-scrollbar { width: 6px !important; height: 6px !important; }
            ::-webkit-scrollbar-track { background: transparent !important; }
            ::-webkit-scrollbar-thumb { background: rgba(128, 128, 128, 0.25) !important; border-radius: 3px !important; }
            ::-webkit-scrollbar-thumb:hover { background: rgba(128, 128, 128, 0.45) !important; }
            .wa-alt-badge {
                position: absolute !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                width: 20px !important;
                height: 20px !important;
                line-height: 1 !important;
                text-align: center !important;
                font-size: 12px !important;
                font-weight: 600 !important;
                font-family: inherit !important;
                color: var(--wa-dynamic-accent-fg, #111b21) !important;
                background: var(--wa-dynamic-accent, #00a884) !important;
                border: none !important;
                outline: none !important;
                border-radius: 50% !important;
                pointer-events: none !important;
                z-index: 999999 !important;
                box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35) !important;
                box-sizing: border-box !important;
                padding: 0 !important;
                margin: 0 !important;
                animation: wa-badge-pop 0.1s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important;
            }
            @keyframes wa-badge-pop {
                0% { transform: scale(0.3); opacity: 0; }
                100% { transform: scale(1); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }

    // 1b. Deteccion dinamica del color de acento activo de WhatsApp Web y contraste legible
    var DEFAULT_ACCENT_COLOR = '#00a884';
    var ACCENT_CSS_VARS = [
        '--unread-marker-background',
        '--WDS-accent',
        '--wds-accent',
        '--accent-primary',
        '--button-primary-background',
        '--active-tab-marker',
        '--checkbox-background',
        '--switch-button-checked-color',
        '--primary',
        '--brand-primary',
        '--teal',
        '--teal-lighter'
    ];

    function parseCssColor(raw) {
        if (!raw || typeof raw !== 'string') return null;
        var s = raw.trim();
        if (!s || s === 'transparent' || s === 'none' || s === 'inherit' || s === 'initial' || s === 'unset') {
            return null;
        }

        var hexMatch = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
        if (hexMatch) {
            var h = hexMatch[1];
            if (h.length === 3 || h.length === 4) {
                var a3 = (h.length === 4) ? parseInt(h[3] + h[3], 16) / 255 : 1;
                return {
                    r: parseInt(h[0] + h[0], 16),
                    g: parseInt(h[1] + h[1], 16),
                    b: parseInt(h[2] + h[2], 16),
                    a: a3
                };
            }
            var a6 = (h.length === 8) ? parseInt(h.slice(6, 8), 16) / 255 : 1;
            return {
                r: parseInt(h.slice(0, 2), 16),
                g: parseInt(h.slice(2, 4), 16),
                b: parseInt(h.slice(4, 6), 16),
                a: a6
            };
        }

        var rgbMatch = /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(s);
        if (rgbMatch) {
            var alpha = 1;
            if (rgbMatch[4] !== undefined) {
                alpha = rgbMatch[4].indexOf('%') !== -1 ? parseFloat(rgbMatch[4]) / 100 : parseFloat(rgbMatch[4]);
            }
            return {
                r: Math.round(Number(rgbMatch[1])),
                g: Math.round(Number(rgbMatch[2])),
                b: Math.round(Number(rgbMatch[3])),
                a: isNaN(alpha) ? 1 : alpha
            };
        }

        var srgbMatch = /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/i.exec(s);
        if (srgbMatch) {
            var sa = 1;
            if (srgbMatch[4] !== undefined) {
                sa = srgbMatch[4].indexOf('%') !== -1 ? parseFloat(srgbMatch[4]) / 100 : parseFloat(srgbMatch[4]);
            }
            return {
                r: Math.round(Number(srgbMatch[1]) * 255),
                g: Math.round(Number(srgbMatch[2]) * 255),
                b: Math.round(Number(srgbMatch[3]) * 255),
                a: isNaN(sa) ? 1 : sa
            };
        }

        return null;
    }

    function resolveCssColorWithProbe(raw) {
        var parsed = parseCssColor(raw);
        if (parsed) return parsed;
        if (!raw || typeof raw !== 'string' || !document.body) return null;
        var s = raw.trim();
        if (!s || s === 'transparent' || s === 'none') return null;

        try {
            var probe = window.__waAccentColorProbe;
            if (!probe || !probe.isConnected) {
                probe = document.createElement('span');
                probe.style.cssText = 'position:fixed!important;left:-9999px!important;top:-9999px!important;width:0!important;height:0!important;visibility:hidden!important;pointer-events:none!important;';
                document.body.appendChild(probe);
                window.__waAccentColorProbe = probe;
            }
            probe.style.color = '';
            probe.style.color = s;
            if (!probe.style.color) return null;
            return parseCssColor(window.getComputedStyle(probe).color);
        } catch (e) {
            return null;
        }
    }

    function rgbToHslFull(rgb) {
        var rn = Math.max(0, Math.min(255, rgb.r)) / 255;
        var gn = Math.max(0, Math.min(255, rgb.g)) / 255;
        var bn = Math.max(0, Math.min(255, rgb.b)) / 255;
        var max = Math.max(rn, gn, bn);
        var min = Math.min(rn, gn, bn);
        var d = max - min;
        var l = (max + min) / 2;
        var s = 0;
        var h = 0;
        if (d !== 0) {
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === rn) h = ((gn - bn) / d) % 6;
            else if (max === gn) h = (bn - rn) / d + 2;
            else h = (rn - gn) / d + 4;
            h *= 60;
            if (h < 0) h += 360;
        }
        return { h: h, s: s, l: l };
    }

    function hslToRgbObj(h, s, l) {
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
        return { r: Math.round((r1 + m) * 255), g: Math.round((g1 + m) * 255), b: Math.round((b1 + m) * 255), a: 1 };
    }

    // Filtro cromatico HSL sin sesgo de luminancia contra los rojos
    function isChromaticAccent(rgb) {
        if (!rgb || rgb.a < 0.5) return false;
        var chroma = Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b);
        if (chroma < 18) return false;
        var hsl = rgbToHslFull(rgb);
        return hsl.s >= 0.22 && hsl.l >= 0.08 && hsl.l <= 0.88;
    }

    // Eleva colores oscuros (burbujas en modo oscuro) a un acento vivo conservando el matiz
    function normalizeAccentBrightness(rgb) {
        var hsl = rgbToHslFull(rgb);
        if (hsl.l >= 0.38) return rgb;
        return hslToRgbObj(hsl.h, Math.max(hsl.s, 0.72), 0.46);
    }

    function probeAccentGeometric() {
        var i, cs, col;
        var mainEl = document.getElementById('main');
        if (mainEl) {
            var mainRect = mainEl.getBoundingClientRect();
            if (mainRect.width > 0) {
                var midThreshold = mainRect.left + mainRect.width * 0.52;
                var leftMin = mainRect.left + 20;
                var maxBubbleW = mainRect.width * 0.88;
                var nodes = mainEl.querySelectorAll('div, span');
                var checkedMain = 0;
                for (var d = nodes.length - 1; d >= 0 && checkedMain < 600; d--) {
                    var el = nodes[d];
                    if (el.closest('header, footer')) continue;
                    var br = el.getBoundingClientRect();
                    if (br.right <= midThreshold || br.left <= leftMin) continue;
                    if (br.width < 26 || br.width > maxBubbleW || br.height < 14 || br.height > 350) continue;
                    checkedMain++;
                    cs = window.getComputedStyle(el);
                    col = parseCssColor(cs.backgroundColor);
                    if (isChromaticAccent(col)) {
                        try { localStorage.setItem('wa_last_theme_accent', JSON.stringify(col)); } catch (e) {}
                        return col;
                    }
                    if (br.width >= 140 && Math.abs(br.width - br.height) <= 24) {
                        col = parseCssColor(cs.borderTopColor);
                        if (isChromaticAccent(col)) {
                            try { localStorage.setItem('wa_last_theme_accent', JSON.stringify(col)); } catch (e) {}
                            return col;
                        }
                    }
                }
            }
        }
        try {
            var savedTheme = localStorage.getItem('wa_last_theme_accent');
            if (savedTheme) {
                var parsedSaved = JSON.parse(savedTheme);
                if (isChromaticAccent(parsedSaved)) return parsedSaved;
            }
        } catch (e) {}
        if (mainEl) {
            var btns = mainEl.querySelectorAll('footer button, footer [role="button"], footer span[data-icon]');
            for (i = 0; i < btns.length && i < 30; i++) {
                col = parseCssColor(window.getComputedStyle(btns[i]).backgroundColor);
                if (isChromaticAccent(col)) return col;
            }
        }
        var pane = document.getElementById('pane-side');
        if (pane) {
            var smalls = pane.querySelectorAll('span, div');
            var checked = 0;
            for (i = 0; i < smalls.length && checked < 400; i++) {
                var sm = smalls[i];
                var txt = sm.textContent;
                if (!txt || txt.length > 4 || !/^\d+$/.test(txt.trim())) continue;
                checked++;
                var r = sm.getBoundingClientRect();
                if (r.width < 16 || r.width > 42 || r.height < 16 || r.height > 28) continue;
                cs = window.getComputedStyle(sm);
                if (parseFloat(cs.borderTopLeftRadius) < 8) continue;
                col = parseCssColor(cs.backgroundColor);
                if (isChromaticAccent(col)) return col;
            }
        }
        return null;
    }

    function formatRgbCss(rgb) {
        var r = Math.max(0, Math.min(255, Math.round(rgb.r)));
        var g = Math.max(0, Math.min(255, Math.round(rgb.g)));
        var b = Math.max(0, Math.min(255, Math.round(rgb.b)));
        return 'rgb(' + r + ', ' + g + ', ' + b + ')';
    }

    function computeContrastFg(rgb) {
        if (!rgb) return '#ffffff';
        var toLinear = function(c) {
            var s = Math.max(0, Math.min(255, c)) / 255;
            return (s <= 0.03928) ? (s / 12.92) : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        var lum = 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
        return (lum > 0.42) ? '#111b21' : '#ffffff';
    }

    function pickChromaticFromElement(el, props) {
        if (!el) return null;
        var cs = window.getComputedStyle(el);
        for (var i = 0; i < props.length; i++) {
            var parsed = parseCssColor(cs.getPropertyValue(props[i]));
            if (isChromaticAccent(parsed)) {
                return parsed;
            }
        }
        return null;
    }

    function detectWhatsAppAccentColor() {
        var i, j, els, found;

        // 0. Variables CSS inline en #main / #app > div / body / html
        var inlineRoots = [
            document.querySelector('#main > div'),
            document.querySelector('#main'),
            document.querySelector('#app > div'),
            document.body,
            document.documentElement
        ];
        for (i = 0; i < inlineRoots.length; i++) {
            var rootEl = inlineRoots[i];
            if (!rootEl || !rootEl.style || !rootEl.style.length) continue;
            var rootCs = window.getComputedStyle(rootEl);
            for (j = 0; j < rootEl.style.length; j++) {
                var propName = rootEl.style[j];
                if (!propName || propName.indexOf('--') !== 0 || propName.indexOf('--wa-dynamic-') === 0) continue;
                if (/(accent|theme|unread|outgoing|brand|primary)/i.test(propName)) {
                    found = resolveCssColorWithProbe(rootCs.getPropertyValue(propName));
                    if (isChromaticAccent(found)) return found;
                }
            }
        }

        // 1. Sondeo geometrico sin data-testid
        found = probeAccentGeometric();
        if (found) return found;

        // 1b. Elementos renderizados en #pane-side y #main (prioridad sobre variables globales)
        var unreadSelectors = [
            '#pane-side [data-testid="icon-unread-count"]',
            '#pane-side [data-icon="unread-count"]',
            '#pane-side span[aria-label*="no le" i]',
            '#pane-side span[aria-label*="unread" i]'
        ];
        for (i = 0; i < unreadSelectors.length; i++) {
            els = document.querySelectorAll(unreadSelectors[i]);
            for (j = 0; j < els.length; j++) {
                found = pickChromaticFromElement(els[j], ['background-color']);
                if (found) return found;
                if (els[j].parentElement) {
                    found = pickChromaticFromElement(els[j].parentElement, ['background-color']);
                    if (found) return found;
                }
            }
        }

        var mainSendSelectors = [
            '#main [data-testid="compose-btn-send"]',
            '#main button[data-testid="send"]',
            '#main span[data-icon="wds-ic-send-filled"]',
            '#main span[data-icon="send"]',
            '#main [data-testid="ptt-btn"]',
            '#main span[data-icon="ptt"]',
            '#main span[data-icon="mic"]',
            '#main span[data-icon="wds-ic-mic-filled"]',
            '#main .message-out div',
            '#main div[data-id^="true_"] div',
            '#main .message-out [data-testid="msg-container"]'
        ];
        for (i = 0; i < mainSendSelectors.length; i++) {
            els = document.querySelectorAll(mainSendSelectors[i]);
            for (j = 0; j < els.length; j++) {
                found = pickChromaticFromElement(els[j], ['background-color', 'color']);
                if (found) return found;
            }
        }

        var mainCheckSelectors = [
            '#main [data-testid="msg-dblcheck"]',
            '#main span[data-icon="msg-dblcheck"]'
        ];
        for (i = 0; i < mainCheckSelectors.length; i++) {
            els = document.querySelectorAll(mainCheckSelectors[i]);
            for (j = 0; j < els.length; j++) {
                found = pickChromaticFromElement(els[j], ['color']);
                if (found) return found;
            }
        }

        var mainEl = document.querySelector('#main');
        if (mainEl) {
            var mainVars = ['--WDS-accent', '--WDS-systems-accent', '--accent-primary', '--outgoing-background'];
            var mainStyle = window.getComputedStyle(mainEl);
            for (i = 0; i < mainVars.length; i++) {
                var mainVal = mainStyle.getPropertyValue(mainVars[i]);
                var mainParsed = resolveCssColorWithProbe(mainVal);
                if (isChromaticAccent(mainParsed)) {
                    return mainParsed;
                }
            }
        }

        // 2. Variables CSS de tema en raiz, body o contenedores principales de la app (fallback)
        var themeRoots = [
            document.documentElement,
            document.body,
            document.querySelector('.app-wrapper-web'),
            document.querySelector('#app > div')
        ];
        for (i = 0; i < ACCENT_CSS_VARS.length; i++) {
            var varName = ACCENT_CSS_VARS[i];
            for (j = 0; j < themeRoots.length; j++) {
                var rootEl = themeRoots[j];
                if (!rootEl) continue;
                var val = window.getComputedStyle(rootEl).getPropertyValue(varName);
                var parsed = resolveCssColorWithProbe(val);
                if (isChromaticAccent(parsed)) {
                    return parsed;
                }
            }
        }

        // 3. Indicadores de pestana activa en navegacion y botones primarios
        var uiSelectors = [
            '[role="navigation"] [aria-selected="true"]',
            '[role="navigation"] [aria-pressed="true"]',
            '[role="tablist"] [aria-selected="true"]',
            'header [aria-pressed="true"]',
            'button[data-testid="compose-btn-send"]',
            '#main footer button[aria-label*="Enviar" i]',
            '#main footer button[aria-label*="Send" i]',
            '#side button[data-testid*="new-chat"]'
        ];
        for (i = 0; i < uiSelectors.length; i++) {
            els = document.querySelectorAll(uiSelectors[i]);
            for (j = 0; j < els.length; j++) {
                found = pickChromaticFromElement(els[j], ['background-color', 'color', 'border-top-color']);
                if (found) return found;
                var iconChild = els[j].querySelector('svg, span[data-icon]');
                if (iconChild) {
                    found = pickChromaticFromElement(iconChild, ['color', 'fill']);
                    if (found) return found;
                }
            }
        }

        return parseCssColor(DEFAULT_ACCENT_COLOR);
    }

    window.__waRefreshAccentColor = function() {
        var root = document.documentElement;
        if (!root) return DEFAULT_ACCENT_COLOR;

        // Deteccion unificada compartida con sidebar_enhancements.js
        if (typeof window.__waDetectAndApplyAccent === 'function') {
            var shared = window.__waDetectAndApplyAccent();
            if (shared && shared.accent) {
                window.__waAppliedDynamicAccent = shared.accent;
                return shared.accent;
            }
        }

        // Respetar --wa-dynamic-accent si fue definido externamente
        var inlineAccent = root.style.getPropertyValue('--wa-dynamic-accent').trim();
        var computedAccent = window.getComputedStyle(root).getPropertyValue('--wa-dynamic-accent').trim();
        var externalAccent = inlineAccent || (!window.__waAppliedDynamicAccent ? computedAccent : '');

        if (externalAccent && externalAccent !== window.__waAppliedDynamicAccent) {
            var extRgb = resolveCssColorWithProbe(externalAccent);
            if (extRgb && extRgb.a > 0.1) {
                var extFg = root.style.getPropertyValue('--wa-dynamic-accent-fg').trim() || computeContrastFg(extRgb);
                if (!root.style.getPropertyValue('--wa-dynamic-accent-fg').trim()) {
                    root.style.setProperty('--wa-dynamic-accent-fg', extFg);
                }
                return externalAccent;
            }
        }

        var detectedRgb = normalizeAccentBrightness(detectWhatsAppAccentColor() || parseCssColor(DEFAULT_ACCENT_COLOR));
        var accentCss = formatRgbCss(detectedRgb);
        var fgCss = computeContrastFg(detectedRgb);

        if (window.__waAppliedDynamicAccent !== accentCss || root.style.getPropertyValue('--wa-dynamic-accent').trim() !== accentCss) {
            root.style.setProperty('--wa-dynamic-accent', accentCss);
            window.__waAppliedDynamicAccent = accentCss;
        }
        if (root.style.getPropertyValue('--wa-dynamic-accent-fg').trim() !== fgCss) {
            root.style.setProperty('--wa-dynamic-accent-fg', fgCss);
        }
        return accentCss;
    };

    window.__waRefreshAccentColor();

    if (!window.__waThemeAccentObserver && window.MutationObserver && document.documentElement) {
        var themeTimer = null;
        var scheduleThemeRefresh = function() {
            if (window.__waSidebarEnhancementsInitialized || window.__waDetectAndApplyAccent) return;
            if (window.__waAltKeyDown === true) return;
            if (themeTimer) return;
            themeTimer = window.setTimeout(function() {
                themeTimer = null;
                if (window.__waSidebarEnhancementsInitialized || window.__waDetectAndApplyAccent) return;
                if (window.__waAltKeyDown === true) return;
                if (window.__waRefreshAccentColor) {
                    window.__waRefreshAccentColor();
                }
                attachChatContainers();
            }, 350);
        };
        var observedContainers = [];
        var attachChatContainers = function() {
            if (window.__waSidebarEnhancementsInitialized || window.__waDetectAndApplyAccent) return;
            var targets = [document.querySelector('#main'), document.querySelector('#pane-side')];
            for (var k = 0; k < targets.length; k++) {
                var t = targets[k];
                if (t && observedContainers.indexOf(t) === -1) {
                    observedContainers.push(t);
                    window.__waThemeAccentObserver.observe(t, {
                        childList: true,
                        subtree: true,
                        attributes: true,
                        attributeFilter: ['class', 'style', 'data-theme']
                    });
                }
            }
        };
        window.__waThemeAccentObserver = new MutationObserver(function(mutations) {
            if (window.__waSidebarEnhancementsInitialized || window.__waDetectAndApplyAccent) return;
            if (window.__waAltKeyDown === true) return;
            if (document.body && document.body.classList.contains('wa-sidebar-animating')) return;
            for (var i = 0; i < mutations.length; i++) {
                var m = mutations[i];
                if (m.type === 'attributes') {
                    if (m.attributeName === 'style' && m.target === document.documentElement) {
                        var curInline = document.documentElement.style.getPropertyValue('--wa-dynamic-accent').trim();
                        if (curInline === window.__waAppliedDynamicAccent) continue;
                    }
                    if (m.attributeName === 'class' && m.target === document.body) {
                        continue;
                    }
                    scheduleThemeRefresh();
                    break;
                } else if (m.type === 'childList') {
                    scheduleThemeRefresh();
                    break;
                }
            }
        });
        window.__waThemeAccentObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class', 'data-theme', 'style']
        });
        if (document.body) {
            window.__waThemeAccentObserver.observe(document.body, {
                childList: true,
                attributes: true,
                attributeFilter: ['class', 'data-theme', 'style']
            });
        }
        attachChatContainers();
    }

    function normalizeChatTitle(s) {
        return (s || '')
            .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
            .replace(/\s*\((tú|you|tu)\)\s*/gi, '')
            .trim()
            .toLowerCase();
    }

    function isElementVisible(el, minW, minH) {
        if (!el || !el.isConnected) return false;
        var cs = window.getComputedStyle(el);
        if (!cs || cs.display === 'none' || cs.visibility === 'hidden') return false;
        var rect = el.getBoundingClientRect();
        return rect.width >= (minW || 1) && rect.height >= (minH || 1);
    }

    function extractRowTitle(row) {
        if (!row) return '';
        var titleEl = row.querySelector('div[data-testid="cell-frame-title"] span[title]') ||
                      row.querySelector('div[data-testid="cell-frame-title"] span') ||
                      row.querySelector('div[data-testid="cell-frame-title"]') ||
                      row.querySelector('span[title]') ||
                      row.querySelector('span[dir="auto"]');
        var text = titleEl ? (titleEl.getAttribute('title') || titleEl.textContent || titleEl.innerText || '') : '';
        if (!text && row.getAttribute) {
            text = row.getAttribute('data-wa-chat-title') || row.getAttribute('title') || '';
        }
        return text;
    }

    // 2. Funcion para obtener chats validos ignorando completamente la pestana de Archivados
    // y capturando todas las conversaciones visibles (fijadas, propias y normales) en su orden visual exacto.
    window.__waGetValidChats = function(skipViewportFilter) {
        if (window.__waEnsurePaneListeners) {
            window.__waEnsurePaneListeners();
        }
        var pane = document.getElementById('pane-side');
        if (!pane || !isElementVisible(pane, 20, 20)) return [];
        var paneRect = pane.getBoundingClientRect();

        var isCandidateRowSize = function(node) {
            if (!node || !node.isConnected) return false;
            if (node.getAttribute('data-wa-compact-hide') === 'true' ||
                (node.classList && node.classList.contains('wa-archived-row')) ||
                (node.closest && node.closest('[data-wa-compact-hide="true"]'))) {
                return false;
            }
            var cs = window.getComputedStyle(node);
            if (!cs || cs.display === 'none' || cs.visibility === 'hidden') return false;
            var rect = node.getBoundingClientRect();
            return rect.width >= 30 && rect.height >= 40 && rect.height <= 140;
        };

        var rawList = [];

        // Estrategia A: Filas accesibles con role="row" o role="listitem"
        var roleNodes = pane.querySelectorAll('[role="row"], [role="listitem"]');
        for (var r = 0; r < roleNodes.length; r++) {
            var node = roleNodes[r];
            if (isCandidateRowSize(node) && rawList.indexOf(node) === -1) {
                rawList.push(node);
            }
        }

        // Estrategia B: Celdas de la lista virtualizada con transform translateY o translate3d
        var virtualNodes = pane.querySelectorAll('div[style*="translateY"], div[style*="translate3d"]');
        for (var v = 0; v < virtualNodes.length; v++) {
            var vNode = virtualNodes[v];
            var semRow = vNode.querySelector('[role="row"], [role="listitem"]') || vNode;
            if (isCandidateRowSize(semRow) && rawList.indexOf(semRow) === -1 && rawList.indexOf(vNode) === -1) {
                rawList.push(semRow);
            }
        }

        // Estrategia C: Fallback para estructuras con cell-frame-container
        if (!rawList.length) {
            var cellFrames = pane.querySelectorAll('div[data-testid="cell-frame-container"]');
            for (var c = 0; c < cellFrames.length; c++) {
                var cf = cellFrames[c];
                var row = cf.closest('[role="row"], [role="listitem"]') || cf;
                if (isCandidateRowSize(row) && rawList.indexOf(row) === -1) {
                    rawList.push(row);
                }
            }
        }

        // Deduplicacion jerarquica (evitar que un contenedor padre y su hijo figuren a la vez)
        var dedupedList = [];
        for (var i = 0; i < rawList.length; i++) {
            var item = rawList[i];
            var isContained = false;
            for (var j = 0; j < rawList.length; j++) {
                if (i !== j && rawList[j].contains(item)) {
                    isContained = true;
                    break;
                }
            }
            if (!isContained && dedupedList.indexOf(item) === -1) {
                dedupedList.push(item);
            }
        }

        var validChats = [];
        for (var k = 0; k < dedupedList.length; k++) {
            var el = dedupedList[k];

            // Deteccion de chat anclado / fijado (pin):
            // Si contiene el icono de fijado, es obligatoriamente un chat valido y NUNCA debe descartarse como archivado
            var isPinned = el.querySelector('span[data-icon*="pin"], [data-testid*="pin"]') !== null;

            if (!isPinned) {
                // Filtrar si es la fila de Archivados por icono, atributo o texto
                var hasArchiveIcon = el.querySelector('span[data-icon*="archiv"], [data-testid*="archiv"], [aria-label*="archiv" i]') !== null;
                if (hasArchiveIcon) {
                    continue;
                }

                var title = extractRowTitle(el).trim().toLowerCase();
                if (/^(archivados|archived|arquivadas)/i.test(title)) {
                    continue;
                }

                var fullText = (el.textContent || el.innerText || '').trim().toLowerCase();
                if (/^(archivados|archived|arquivadas)(\s*\d+)?$/i.test(fullText)) {
                    continue;
                }

                // Descartar filas informativas de cifrado que pudieran montarse como row/listitem
                var hasAvatarOrTitle = el.querySelector('img, span[title], div[data-testid="cell-frame-title"]') !== null;
                if (!hasAvatarOrTitle &&
                    (el.querySelector('span[data-icon*="lock"], [data-testid*="encrypt"]') !== null ||
                     /(cifrad|extremo a extremo|end-to-end|encrypt|criptograf)/i.test(fullText))) {
                    continue;
                }
            }

            // Verificar que contiene la estructura minima de un chat real (avatar o contenido de texto)
            var hasChatContent = el.querySelector('img') ||
                                 el.querySelector('svg') ||
                                 el.querySelector('span[data-icon]') ||
                                 el.querySelector('span[title]') ||
                                 el.querySelector('span[dir="auto"]') ||
                                 el.querySelector('div[data-testid*="cell-frame"]') ||
                                 el.querySelector('[data-wa-avatar-col="true"]');
            if (!hasChatContent) {
                continue;
            }

            if (!skipViewportFilter && paneRect.height > 0) {
                var elRect = el.getBoundingClientRect();
                var centerY = elRect.top + (elRect.height / 2);
                if (centerY < paneRect.top || centerY > paneRect.bottom) {
                    continue;
                }
            }

            validChats.push(el);
        }

        // Ordenar visualmente de arriba a abajo por coordenada Y para que el primer chat visible sea siempre el indice 0
        validChats.sort(function(a, b) {
            return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
        });

        return validChats;
    };

    // 3. Funcion para mostrar badges sobre la esquina de la foto de perfil sin depender de cell-frame-container
    window.__waShowAltBadges = function() {
        // Reutiliza los badges existentes: solo crea (con animacion) los que faltan,
        // actualiza posicion/etiqueta de los ya visibles y elimina los sobrantes.
        var validChats = window.__waGetValidChats();
        var count = Math.min(validChats.length, 10);
        var keep = [];

        for (var i = 0; i < count; i++) {
            var keyLabel = (i < 9) ? String(i + 1) : '0';
            var chatRow = validChats[i];

            var rowRect = chatRow.getBoundingClientRect();
            if (rowRect.width <= 0 || rowRect.height <= 0) continue;

            var candidate = null;
            var isCompactRow = (rowRect.width <= 85) || document.body.classList.contains('wa-sidebar-compact');

            // 1. Imagen de perfil directa (img o svg image para squircles como DiDi Food) y visible en la columna izquierda
            var imgs = chatRow.querySelectorAll('img:not(.emoji):not([data-plain-text])');
            for (var m = 0; m < imgs.length; m++) {
                if (!isElementVisible(imgs[m], 30, 30)) continue;
                var imgRect = imgs[m].getBoundingClientRect();
                if (imgRect.width <= 70 && (imgRect.left - rowRect.left) < 75) {
                    candidate = imgs[m];
                    break;
                }
            }
            if (!candidate) {
                var svgImg = chatRow.querySelector('svg image');
                if (svgImg) {
                    var svgHost = svgImg.closest('svg');
                    if (svgHost && isElementVisible(svgHost, 30, 30)) {
                        var svgRect = svgHost.getBoundingClientRect();
                        if (svgRect.width <= 70 && (svgRect.left - rowRect.left) < 75) {
                            candidate = svgHost;
                        }
                    }
                }
            }

            // 2. Contenedor de avatar etiquetado en modo compacto (49x49 centrado)
            if (!candidate) {
                var avatarCol = chatRow.querySelector('[data-wa-avatar-col="true"]');
                if (avatarCol && isElementVisible(avatarCol, 30, 30)) {
                    var avRect = avatarCol.getBoundingClientRect();
                    if (avRect.width <= 65 && avRect.height <= 65) {
                        candidate = avatarCol;
                    }
                }
            }

            // 3. Anillo de historia o boton de avatar circular
            if (!candidate) {
                var buttons = chatRow.querySelectorAll('div[role="button"]');
                for (var b = 0; b < buttons.length; b++) {
                    if (!isElementVisible(buttons[b], 35, 35)) continue;
                    var btnRect = buttons[b].getBoundingClientRect();
                    // El avatar siempre esta ubicado en la columna izquierda de la fila
                    if (btnRect.width <= 65 && btnRect.height <= 65 && (btnRect.left - rowRect.left) < 75) {
                        candidate = buttons[b];
                        break;
                    }
                }
            }

            // 4. Icono o SVG de avatar (contactos o chats propios sin foto de perfil personalizada)
            if (!candidate) {
                var icons = chatRow.querySelectorAll('span[data-icon="default-user"], span[data-icon="default-group"], span[data-icon="community-outline"], span[data-icon*="avatar"], span[data-icon*="default-"], span[data-icon*="channel"], span[data-icon*="newsletter"], svg');
                for (var ic = 0; ic < icons.length; ic++) {
                    if (!isElementVisible(icons[ic], 20, 20)) continue;
                    var icRect = icons[ic].getBoundingClientRect();
                    if ((icRect.left - rowRect.left) < 75 && icRect.width <= 65) {
                        var pDiv = icons[ic].closest('div');
                        if (pDiv && pDiv !== chatRow && chatRow.contains(pDiv)) {
                            var pRect = pDiv.getBoundingClientRect();
                            if (pRect.width >= 30 && pRect.width <= 65 && pRect.height >= 30 && pRect.height <= 65) {
                                candidate = pDiv;
                            } else {
                                candidate = icons[ic];
                            }
                        } else {
                            candidate = icons[ic];
                        }
                        break;
                    }
                }
            }

            // 5. Busqueda por dimensiones tipicas de avatar en la columna izquierda
            if (!candidate) {
                var descendants = chatRow.querySelectorAll('div, span');
                for (var d = 0; d < descendants.length; d++) {
                    if (!isElementVisible(descendants[d], 35, 35)) continue;
                    var rect = descendants[d].getBoundingClientRect();
                    if (rect.width <= 65 && rect.height <= 65 && (rect.left - rowRect.left) < 75) {
                        candidate = descendants[d];
                        break;
                    }
                }
            }

            var cx, cy;
            var candRadius = 24.5;
            if (candidate) {
                var candRect = candidate.getBoundingClientRect();
                cx = (candRect.left - rowRect.left) + (candRect.width / 2);
                cy = (candRect.top - rowRect.top) + (candRect.height / 2);
                candRadius = Math.min(candRect.width, candRect.height) / 2;
            } else {
                // Fallback geometrico: en modo compacto se centra en rowRect.width / 2; en modo normal cx = 36.5
                cx = isCompactRow ? (rowRect.width / 2) : 36.5;
                cy = rowRect.height / 2;
            }

            var badgeTop = Math.round(cy - candRadius - 3);
            var badgeLeft = Math.round(cx - candRadius - 3);

            // Clamping estricto dentro de la fila para evitar recorte en modo compacto (70px) o fila 0
            var maxTop = Math.max(2, Math.floor(rowRect.height - 22));
            var maxLeft = Math.max(2, Math.floor(rowRect.width - 22));
            badgeTop = Math.max(2, Math.min(badgeTop, maxTop));
            badgeLeft = Math.max(2, Math.min(badgeLeft, maxLeft));

            if (getComputedStyle(chatRow).position === 'static') {
                chatRow.style.position = 'relative';
            }
            if (chatRow.style.getPropertyValue('overflow') !== 'visible' ||
                chatRow.style.getPropertyPriority('overflow') !== 'important') {
                chatRow.style.setProperty('overflow', 'visible', 'important');
            }

            var badge = null;
            for (var cb = 0; cb < chatRow.children.length; cb++) {
                if (chatRow.children[cb].classList && chatRow.children[cb].classList.contains('wa-alt-badge')) {
                    badge = chatRow.children[cb];
                    break;
                }
            }
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'wa-alt-badge';
                chatRow.appendChild(badge);
            }
            if (badge.textContent !== keyLabel) badge.textContent = keyLabel;
            var topStr = badgeTop + 'px';
            var leftStr = badgeLeft + 'px';
            if (badge.style.top !== topStr) badge.style.top = topStr;
            if (badge.style.left !== leftStr) badge.style.left = leftStr;
            keep.push(badge);
        }

        document.querySelectorAll('.wa-alt-badge').forEach(function(el) {
            if (keep.indexOf(el) === -1) el.remove();
        });
    };

    // 4. Funcion para ocultar badges
    window.__waHideAltBadges = function() {
        document.querySelectorAll('.wa-alt-badge').forEach(function(el) { el.remove(); });
    };

    // 5. Funcion unificada de seleccion y clic simulado 100% compatible con React 18
    window.__waSelectChatElement = function(target, preserveSeenState) {
        if (!target) return;

        var isAlreadySelected = (target.getAttribute && target.getAttribute('aria-selected') === 'true') ||
                                (target.querySelector && target.querySelector('[aria-selected="true"]') !== null);
        if (!preserveSeenState && !window.__waMarkingSeenActive && !isAlreadySelected && window.__waCancelTemporarySeen) {
            window.__waCancelTemporarySeen();
        }

        var isClickableEl = function(el) {
            if (!isElementVisible(el, 1, 1)) return false;
            var cs = window.getComputedStyle(el);
            return cs.pointerEvents !== 'none';
        };

        var isActionButton = function(el) {
            if (!el || !el.tagName) return false;
            var tag = el.tagName.toLowerCase();
            return tag === 'button' || tag === 'a' || el.getAttribute('role') === 'button';
        };

        var clickTarget = null;

        // Prioridad 1 (modo normal): columna de texto del chat cuando es visible
        var normalSelectors = [
            'div[data-testid="cell-frame-title"] span',
            'div[data-testid="cell-frame-title"]',
            'span[title]',
            'span[dir="auto"]',
            '[role="gridcell"]:not(:first-child)'
        ];
        for (var ns = 0; ns < normalSelectors.length; ns++) {
            var nCand = target.querySelector(normalSelectors[ns]);
            if (nCand && isClickableEl(nCand)) {
                clickTarget = nCand;
                break;
            }
        }

        // Prioridad 2 (modo compacto 70px): la columna de texto esta oculta (display: none / 0px),
        // por lo que clicamos el contenedor interno visible del chat (evitando botones de foto/estado)
        if (!clickTarget) {
            var compactSelectors = [
                '[data-wa-avatar-col="true"]',
                '[role="gridcell"]',
                'div[data-testid="cell-frame-container"]',
                'div[tabindex="-1"]',
                'div[tabindex="0"]',
                '[role="row"]',
                '[role="listitem"]'
            ];
            for (var csIdx = 0; csIdx < compactSelectors.length && !clickTarget; csIdx++) {
                var matches = target.querySelectorAll(compactSelectors[csIdx]);
                for (var mi = 0; mi < matches.length; mi++) {
                    if (!isActionButton(matches[mi]) && isClickableEl(matches[mi])) {
                        clickTarget = matches[mi];
                        break;
                    }
                }
            }
        }

        if (!clickTarget) {
            clickTarget = target;
        }

        var rect = clickTarget.getBoundingClientRect();
        var clientX = Math.round(rect.left + (rect.width > 0 ? rect.width / 2 : 10));
        var clientY = Math.round(rect.top + (rect.height > 0 ? rect.height / 2 : 10));

        var commonOpts = {
            bubbles: true,
            cancelable: true,
            view: window,
            composed: true,
            clientX: clientX,
            clientY: clientY,
            screenX: clientX,
            screenY: clientY
        };

        var downOpts = Object.assign({}, commonOpts, { button: 0, buttons: 1 });
        if (window.PointerEvent) {
            clickTarget.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, downOpts, {
                pointerId: 1,
                pointerType: 'mouse',
                isPrimary: true
            })));
        }
        clickTarget.dispatchEvent(new MouseEvent('mousedown', downOpts));

        if (typeof target.focus === 'function') {
            try { target.focus(); } catch (e) {}
        }

        var upOpts = Object.assign({}, commonOpts, { button: 0, buttons: 0 });
        if (window.PointerEvent) {
            clickTarget.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, upOpts, {
                pointerId: 1,
                pointerType: 'mouse',
                isPrimary: true
            })));
        }
        clickTarget.dispatchEvent(new MouseEvent('mouseup', upOpts));
        clickTarget.dispatchEvent(new MouseEvent('click', upOpts));

        if (typeof clickTarget.click === 'function') {
            try { clickTarget.click(); } catch (e) {}
        }

        if (typeof target.scrollIntoView === 'function') {
            target.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        }

        if (!preserveSeenState && !window.__waMarkingSeenActive && typeof window.__waScheduleReadOnlyChatCheck === 'function') {
            window.__waScheduleReadOnlyChatCheck();
        }
    };

    // 6. Obtener el indice del chat seleccionado actualmente
    window.__waGetCurrentChatIndex = function(includeAllMounted) {
        var validChats = (window.__waGetValidChats) ? window.__waGetValidChats(!!includeAllMounted) : [];
        if (!validChats.length) return -1;

        // 1. Prioridad: atributo aria-selected en la fila o sus hijos
        for (var i = 0; i < validChats.length; i++) {
            var row = validChats[i];
            if (row.getAttribute('aria-selected') === 'true' ||
                row.querySelector('[aria-selected="true"]') !== null) {
                return i;
            }
        }

        // 2. Coincidencia por titulo activo en el header de #main (con normalizacion bidi y sufijos Tu/You)
        var mainHeader = document.querySelector('#main header');
        var hasActiveHeaderTitle = false;
        if (mainHeader) {
            var headerSelectors = [
                'div[data-testid="conversation-info-header"] span[title]',
                'div[data-testid="conversation-info-header"] span[dir="auto"]',
                'div[role="button"] span[title]',
                'div[role="button"] span[dir="auto"]',
                'span[title]',
                'span[dir="auto"]'
            ];
            var rawActiveTitle = '';
            for (var hs = 0; hs < headerSelectors.length; hs++) {
                var hEl = mainHeader.querySelector(headerSelectors[hs]);
                if (hEl) {
                    var candidateTitle = (hEl.getAttribute('title') || hEl.textContent || hEl.innerText || '').trim();
                    if (candidateTitle) {
                        rawActiveTitle = candidateTitle;
                        break;
                    }
                }
            }
            var activeTitle = normalizeChatTitle(rawActiveTitle);
            if (activeTitle) {
                hasActiveHeaderTitle = true;
                for (var j = 0; j < validChats.length; j++) {
                    var rawChatTitle = extractRowTitle(validChats[j]);
                    var chatTitle = normalizeChatTitle(rawChatTitle);
                    if (chatTitle && (chatTitle === activeTitle || rawChatTitle.trim().toLowerCase() === rawActiveTitle.toLowerCase())) {
                        return j;
                    }
                }
            }
        }

        // 3. Fallback al indice cacheado solo si no hay titulo activo observable en #main
        if (!hasActiveHeaderTitle &&
            typeof window.__waCurrentChatIndex === 'number' &&
            window.__waCurrentChatIndex >= 0 &&
            window.__waCurrentChatIndex < validChats.length) {
            return window.__waCurrentChatIndex;
        }

        return -1;
    };

    // 7. Navegacion secuencial por chats (+1 abajo, -1 arriba)
    window.__waNavigateChat = function(offset) {
        var validChats = (window.__waGetValidChats) ? window.__waGetValidChats(true) : [];
        if (!validChats.length) return -1;

        var currentIndex = window.__waGetCurrentChatIndex(true);
        var targetIndex = 0;

        if (currentIndex === -1) {
            var visibleChats = window.__waGetValidChats(false);
            if (visibleChats.length) {
                var firstVisibleIdx = validChats.indexOf(visibleChats[0]);
                if (firstVisibleIdx !== -1) {
                    targetIndex = firstVisibleIdx;
                }
            }
        } else {
            targetIndex = currentIndex + offset;
            if (targetIndex < 0) {
                targetIndex = 0;
            } else if (targetIndex >= validChats.length) {
                targetIndex = validChats.length - 1;
            }
        }

        if (targetIndex === currentIndex && currentIndex !== -1) {
            if (window.__waShowAltBadges && window.__waAltKeyDown) {
                window.__waShowAltBadges();
            }
            return targetIndex;
        }

        window.__waCurrentChatIndex = targetIndex;
        window.__waHasRepliedInCurrentChat = false;
        window.__waMarkingSeenActive = false;
        if (window.__waCancelTemporarySeen) {
            window.__waCancelTemporarySeen();
        }

        var target = validChats[targetIndex];
        if (target && window.__waSelectChatElement) {
            window.__waSelectChatElement(target);
        }

        if (window.__waShowAltBadges && window.__waAltKeyDown) {
            window.__waShowAltBadges();
            setTimeout(function() { if (window.__waAltKeyDown && window.__waShowAltBadges) window.__waShowAltBadges(); }, 90);
            setTimeout(function() { if (window.__waAltKeyDown && window.__waShowAltBadges) window.__waShowAltBadges(); }, 240);
        }

        return targetIndex;
    };

    // 7b. Busqueda de chat por nombre con scroll progresivo sobre la lista virtualizada de #pane-side
    window.__waFindChatTimer = null;
    window.__waFindAndOpenChat = function(targetName, onFoundCallback) {
        if (window.__waFindChatTimer) {
            clearTimeout(window.__waFindChatTimer);
            window.__waFindChatTimer = null;
        }

        var wanted = normalizeChatTitle(targetName);
        if (!wanted) return -1;

        var matchRow = function(row) {
            var candidates = row.querySelectorAll('span[title], div[data-testid="cell-frame-title"] span, [role="gridcell"] span[dir="auto"], span[dir="auto"]');
            for (var c = 0; c < candidates.length; c++) {
                var el = candidates[c];
                var attrTitle = el.getAttribute('title');
                if (attrTitle && normalizeChatTitle(attrTitle) === wanted) {
                    return true;
                }
                var txt = (el.textContent || '').trim();
                if (txt && normalizeChatTitle(txt) === wanted) {
                    return true;
                }
            }
            var rowTitle = row.getAttribute('title');
            return rowTitle ? normalizeChatTitle(rowTitle) === wanted : false;
        };

        var tryFindInDom = function() {
            var chats = window.__waGetValidChats ? window.__waGetValidChats(true) : [];
            for (var i = 0; i < chats.length; i++) {
                if (matchRow(chats[i])) {
                    window.__waCurrentChatIndex = i;
                    return chats[i];
                }
            }
            var fallbackRows = document.querySelectorAll('#pane-side [role="row"], #pane-side [role="listitem"]');
            for (var j = 0; j < fallbackRows.length; j++) {
                if (matchRow(fallbackRows[j])) {
                    return fallbackRows[j];
                }
            }
            return null;
        };

        var immediate = tryFindInDom();
        if (immediate) {
            window.__waSelectChatElement(immediate);
            if (typeof onFoundCallback === 'function') {
                onFoundCallback(immediate);
            }
            return 1;
        }

        var pane = document.getElementById('pane-side');
        if (!pane) {
            return -1;
        }
        var scrollBox = pane;
        if (scrollBox.scrollHeight <= scrollBox.clientHeight) {
            var descendants = pane.querySelectorAll('div');
            for (var sc = 0; sc < descendants.length; sc++) {
                if (descendants[sc].scrollHeight > descendants[sc].clientHeight + 20 && descendants[sc].clientHeight > 100) {
                    scrollBox = descendants[sc];
                    break;
                }
            }
        }
        if (scrollBox.scrollHeight <= scrollBox.clientHeight) {
            return -1;
        }

        var originalScrollTop = scrollBox.scrollTop;
        var maxSteps = 25;
        var stepCount = 0;
        var stepSize = Math.max(250, Math.floor(scrollBox.clientHeight * 0.75));
        var maxScroll = Math.max(0, scrollBox.scrollHeight - scrollBox.clientHeight);

        if (originalScrollTop > 0) {
            scrollBox.scrollTop = 0;
        } else {
            scrollBox.scrollTop = Math.min(stepSize, maxScroll);
        }
        stepCount = 1;

        var stepSearch = function() {
            window.__waFindChatTimer = null;
            var hit = tryFindInDom();
            if (hit) {
                window.__waSelectChatElement(hit);
                if (typeof onFoundCallback === 'function') {
                    onFoundCallback(hit);
                }
                return;
            }

            var curMaxScroll = Math.max(0, scrollBox.scrollHeight - scrollBox.clientHeight);
            if (scrollBox.scrollTop >= curMaxScroll - 2 || stepCount >= maxSteps) {
                scrollBox.scrollTop = originalScrollTop;
                return;
            }

            var curStep = Math.max(250, Math.floor(scrollBox.clientHeight * 0.75));
            var nextScroll = Math.min(scrollBox.scrollTop + curStep, curMaxScroll);
            if (nextScroll <= scrollBox.scrollTop) {
                scrollBox.scrollTop = originalScrollTop;
                return;
            }

            scrollBox.scrollTop = nextScroll;
            stepCount++;
            window.__waFindChatTimer = setTimeout(stepSearch, 60);
        };

        window.__waFindChatTimer = setTimeout(stepSearch, 60);
        return 0;
    };

    // 8. Escuchadores directos de teclado y rueda dentro de la ventana web
    if (!window.__waAltListenersAttached) {
        window.__waAltListenersAttached = true;
        window.__waAltKeyDown = false;
        window.__waLastWheelNavTime = 0;

        function handleWheel(e) {
            var isAltGr = (e.getModifierState && e.getModifierState('AltGraph')) || (e.altKey && e.ctrlKey);
            if (isAltGr && window.__waAltKeyDown) {
                window.__waAltKeyDown = false;
                if (window.__waHideAltBadges) {
                    window.__waHideAltBadges();
                }
            }
            var isAlt = !isAltGr && (e.altKey || window.__waAltKeyDown);
            if (isAlt) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                var now = Date.now();
                if (now - window.__waLastWheelNavTime < 100) {
                    return;
                }

                var delta = e.deltaY;
                if (delta === 0 && e.deltaX !== 0) {
                    delta = e.deltaX;
                }

                if (delta < 0) {
                    window.__waLastWheelNavTime = now;
                    window.__waNavigateChat(-1);
                } else if (delta > 0) {
                    window.__waLastWheelNavTime = now;
                    window.__waNavigateChat(1);
                }
            }
        }
        window.__waHandleWheel = handleWheel;

        window.__waEnsurePaneListeners = function() {
            var pane = document.getElementById('pane-side');
            if (!pane) return;
            if (!pane.__waWheelAttached) {
                pane.__waWheelAttached = true;
                pane.addEventListener('wheel', window.__waHandleWheel, { passive: false, capture: true });
            }
            if (!pane.__waScrollBadgeAttached) {
                pane.__waScrollBadgeAttached = true;
                var badgeRaf = false;
                pane.addEventListener('scroll', function() {
                    if (!window.__waAltKeyDown || badgeRaf) return;
                    badgeRaf = true;
                    window.requestAnimationFrame(function() {
                        badgeRaf = false;
                        if (window.__waAltKeyDown && window.__waShowAltBadges) {
                            window.__waShowAltBadges();
                        }
                    });
                }, { passive: true });
            }
            if (!pane.__waBadgeObserver && window.MutationObserver) {
                var isBadgeNode = function(node) {
                    return node && node.nodeType === 1 && node.classList && node.classList.contains('wa-alt-badge');
                };
                var isOnlyBadgeMutation = function(m) {
                    if (m.type === 'attributes') {
                        return isBadgeNode(m.target);
                    }
                    if (m.type === 'characterData') {
                        return isBadgeNode(m.target && m.target.parentNode);
                    }
                    if (m.type === 'childList') {
                        if (isBadgeNode(m.target)) {
                            return true;
                        }
                        for (var a = 0; a < m.addedNodes.length; a++) {
                            if (!isBadgeNode(m.addedNodes[a])) {
                                return false;
                            }
                        }
                        for (var r = 0; r < m.removedNodes.length; r++) {
                            if (!isBadgeNode(m.removedNodes[r])) {
                                return false;
                            }
                        }
                        return true;
                    }
                    return false;
                };
                pane.__waBadgeObserver = new MutationObserver(function(mutations) {
                    if (!window.__waAltKeyDown) return;
                    var hasRelevant = false;
                    for (var i = 0; i < mutations.length; i++) {
                        if (!isOnlyBadgeMutation(mutations[i])) {
                            hasRelevant = true;
                            break;
                        }
                    }
                    if (!hasRelevant || pane.__waBadgeMutRaf) return;
                    pane.__waBadgeMutRaf = true;
                    window.requestAnimationFrame(function() {
                        pane.__waBadgeMutRaf = false;
                        if (window.__waAltKeyDown && window.__waShowAltBadges) {
                            window.__waShowAltBadges();
                        }
                    });
                });
                pane.__waBadgeObserver.observe(pane, {
                    childList: true,
                    subtree: true,
                    attributes: true
                });
            }
        };

        window.addEventListener('keydown', function(e) {
            var isAltGrEvent = e.key === 'AltGraph' ||
                               e.key === 'ISO_Level3_Shift' ||
                               e.code === 'AltRight' ||
                               e.location === 2 ||
                               (e.getModifierState && e.getModifierState('AltGraph'));
            if (isAltGrEvent) {
                if (window.__waAltKeyDown) {
                    window.__waAltKeyDown = false;
                    window.__waHideAltBadges();
                }
                return;
            }
            if (e.key === 'Alt' &&
                e.code !== 'AltRight' &&
                e.location !== 2 &&
                !(e.getModifierState && e.getModifierState('AltGraph'))) {
                // Solo se marca el estado: C++ (eventFilter) es el unico que muestra los badges,
                // evitando una segunda reconstruccion por la misma pulsacion.
                window.__waAltKeyDown = true;
            }
        }, true);

        window.addEventListener('keyup', function(e) {
            if (e.key === 'Alt' || e.key === 'AltGraph' || e.code === 'AltRight') {
                window.__waAltKeyDown = false;
                window.__waHideAltBadges();
            }
        }, true);

        if (!window.__waGlobalScrollBadgeAttached) {
            window.__waGlobalScrollBadgeAttached = true;
            var globalBadgeScrollRaf = false;
            window.addEventListener('scroll', function() {
                if (!window.__waAltKeyDown || globalBadgeScrollRaf) return;
                globalBadgeScrollRaf = true;
                window.requestAnimationFrame(function() {
                    globalBadgeScrollRaf = false;
                    if (window.__waAltKeyDown && window.__waShowAltBadges) {
                        window.__waShowAltBadges();
                    }
                });
            }, { passive: true, capture: true });
        }

        window.addEventListener('wheel', handleWheel, { passive: false, capture: true });
        document.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    }
    if (window.__waEnsurePaneListeners) {
        window.__waEnsurePaneListeners();
    }
})();
