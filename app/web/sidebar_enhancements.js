(function() {
    'use strict';
    if (window.__waSidebarEnhancementsInitialized) return;
    window.__waSidebarEnhancementsInitialized = true;

    var STORAGE_KEY_WIDTH = 'wa_sidebar_width';
    var STORAGE_KEY_COMPACT = 'wa_sidebar_compact';
    var STORAGE_KEY_RIGHT_WIDTH = 'wa_right_panel_width';
    var MIN_WIDTH = 280;
    var DEFAULT_WIDTH = 360;
    var MIN_RIGHT_WIDTH = 220;
    var DEFAULT_RIGHT_WIDTH = 340;

    var isDragging = false;
    var currentSidebarWidth = getSavedWidth();
    var resizerElement = null;
    var rafPending = false;
    var targetClientX = 0;

    var isRightDragging = false;
    var rightResizerElement = null;
    var rightRafPending = false;
    var rightTargetClientX = 0;

    var cachedSideColumn = null;
    var cachedMainColumn = null;
    var cachedFlexContainer = null;

    var MAIN_SCALE_THRESHOLD = 450;
    var MAIN_SCALE_MIN = 0.55;
    var OVERLAY_CHECK_SELECTOR = '[data-animate-modal-popup="true"], [data-animate-modal-backdrop="true"], ' +
                                 '[data-animate-modal-media="true"], [data-animate-picker="true"], ' +
                                 '[data-animate-dropdown-item="true"], [data-testid="media-viewer"], ' +
                                 '[data-testid="popup-contents"], [role="dialog"], [role="menu"], ' +
                                 '#wa-privacy-blur-overlay';

    var compactAnimTimer = null;
    var hoverTooltipEl = null;
    var hoverTooltipActiveRow = null;
    var currentMainScale = 1;
    var mainScaleRafPending = false;
    var overlayCheckRafPending = false;
    var lastPointerX = null;
    var lastPointerY = null;
    var accentSyncTimer = null;
    var lastAppliedAccent = '';
    var lastAppliedAccentFg = '';
    var lastMainThemeAccent = (function() {
        try {
            var raw = localStorage.getItem('wa_last_theme_accent');
            if (raw) {
                var parsed = JSON.parse(raw);
                if (parsed && typeof parsed.r === 'number') return parsed;
            }
        } catch (e) {}
        return null;
    })();
    var accentProbeEl = null;

    var SVG_COLLAPSE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">' +
                       '<path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>' +
                       '</svg>';

    var SVG_EXPAND = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">' +
                     '<path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>' +
                     '</svg>';

    function injectStyles() {
        var existing = document.getElementById('wa-sidebar-enhancements-style');
        if (existing) {
            existing.remove();
        }
        var style = document.createElement('style');
        style.id = 'wa-sidebar-enhancements-style';
        style.textContent = __WA_SIDEBAR_CSS__;
        document.head.appendChild(style);
    }

    function getMaxWidth() {
        return Math.floor(window.innerWidth * 0.5);
    }

    function getSavedWidth() {
        var saved = localStorage.getItem(STORAGE_KEY_WIDTH);
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

    function isCompactActive() {
        return document.body.classList.contains('wa-sidebar-compact');
    }

    function updateButtonAppearance(btn, isCompact) {
        if (!btn) return;
        btn.innerHTML = isCompact ? SVG_EXPAND : SVG_COLLAPSE;
        var label = isCompact ? 'Expandir barra lateral' : 'Minimizar barra lateral';
        btn.setAttribute('title', label);
        btn.setAttribute('aria-label', label);
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

    function isAchromaticColor(rgba) {
        if (!rgba || rgba.a < 0.5) return false;
        var chroma = Math.max(rgba.r, rgba.g, rgba.b) - Math.min(rgba.r, rgba.g, rgba.b);
        var hsl = rgbToHsl(rgba.r, rgba.g, rgba.b);
        return chroma < 18 || hsl.s < 0.14;
    }

    function isUiDarkMode() {
        var bgTargets = [
            document.getElementById('pane-side'),
            document.getElementById('side'),
            document.querySelector('[data-wa-side-column="true"]'),
            document.querySelector('#app > div'),
            document.querySelector('#side header'),
            document.querySelector('[data-wa-nav-rail="true"]')
        ];
        for (var i = 0; i < bgTargets.length; i++) {
            var bgEl = bgTargets[i];
            if (!bgEl) continue;
            var bgCol = parseCssColor(window.getComputedStyle(bgEl).backgroundColor);
            if (bgCol && bgCol.a > 0.5) {
                var bgLum = (0.299 * bgCol.r + 0.587 * bgCol.g + 0.114 * bgCol.b) / 255;
                return bgLum < 0.5;
            }
        }
        return !!(document.body && document.body.classList.contains('dark'));
    }

    function isValidNeutralThemeColor(rgba, mainBg, incomingBg) {
        if (!rgba || rgba.a < 0.85) return false;
        var hsl = rgbToHsl(rgba.r, rgba.g, rgba.b);
        if (hsl.l < 0.04 || hsl.l > 0.96) return false;
        if (mainBg && mainBg.a >= 0.5) {
            var diffMain = Math.abs(rgba.r - mainBg.r) + Math.abs(rgba.g - mainBg.g) + Math.abs(rgba.b - mainBg.b);
            if (diffMain < 15) return false;
        }
        if (incomingBg && incomingBg.a >= 0.5) {
            var diffIn = Math.abs(rgba.r - incomingBg.r) + Math.abs(rgba.g - incomingBg.g) + Math.abs(rgba.b - incomingBg.b);
            if (diffIn < 15) return false;
        }
        return true;
    }

    function isValidAccentColor(rgba) {
        if (!rgba || rgba.a < 0.5) return false;
        var chroma = Math.max(rgba.r, rgba.g, rgba.b) - Math.min(rgba.r, rgba.g, rgba.b);
        if (chroma < 18) return false;
        var hsl = rgbToHsl(rgba.r, rgba.g, rgba.b);
        return hsl.s >= 0.22 && hsl.l >= 0.08 && hsl.l <= 0.88;
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

    function normalizeAccent(rgba) {
        var hsl = rgbToHsl(rgba.r, rgba.g, rgba.b);
        if (isAchromaticColor(rgba)) {
            var neutralH = rgbToHue(rgba.r, rgba.g, rgba.b);
            var neutralS = Math.min(hsl.s, 0.08);
            var darkUi = isUiDarkMode();
            var targetL = hsl.l;
            if (darkUi) {
                if (targetL < 0.50) {
                    targetL = Math.max(0.54, Math.min(0.66, targetL + 0.30));
                } else if (targetL > 0.86) {
                    targetL = 0.86;
                }
            } else {
                if (targetL > 0.48) {
                    targetL = 0.40;
                } else if (targetL < 0.18) {
                    targetL = 0.22;
                }
            }
            return hslToRgb(neutralH, neutralS, targetL);
        }
        if (hsl.l >= 0.38) return { r: rgba.r, g: rgba.g, b: rgba.b, a: 1 };
        var h = rgbToHue(rgba.r, rgba.g, rgba.b);
        return hslToRgb(h, Math.max(hsl.s, 0.72), 0.46);
    }

    function saveMainThemeAccent(col) {
        if (!col) return col;
        lastMainThemeAccent = col;
        try {
            localStorage.setItem('wa_last_theme_accent', JSON.stringify(col));
        } catch (e) {}
        return col;
    }

    function probeMainChatThemeAccent() {
        var mainEl = document.getElementById('main');
        if (!mainEl) return lastMainThemeAccent;
        var d, cs, col;

        var mainRect = mainEl.getBoundingClientRect();
        if (mainRect.width > 0) {
            var midThreshold = mainRect.left + mainRect.width * 0.52;
            var leftMin = mainRect.left + 20;
            var maxBubbleW = mainRect.width * 0.88;

            // 1. Priorizar burbujas reales de mensaje saliente (.message-out o [data-id^="true_"])
            var mainCs = window.getComputedStyle(mainEl);
            var mainBg = parseCssColor(mainCs.backgroundColor);
            if ((!mainBg || mainBg.a < 0.5) && mainEl.firstElementChild) {
                mainBg = parseCssColor(window.getComputedStyle(mainEl.firstElementChild).backgroundColor);
            }
            var incomingBg = parseCssColor((mainCs.getPropertyValue('--incoming-background') || '').trim());
            var outRoots = mainEl.querySelectorAll('[data-id^="true_"], .message-out');
            var colorCounts = {};
            var colorSamples = {};
            var colorDistinctNodes = {};
            var bestKey = null;
            var bestScore = 0;

            var neutralCounts = {};
            var neutralSamples = {};
            var neutralDistinctNodes = {};
            var bestNeutralKey = null;
            var bestNeutralScore = 0;

            function recordCandidateColor(c, weight, elRef) {
                var key = Math.round(c.r / 4) + ',' + Math.round(c.g / 4) + ',' + Math.round(c.b / 4);
                colorCounts[key] = (colorCounts[key] || 0) + weight;
                if (!colorSamples[key]) colorSamples[key] = c;
                if (!colorDistinctNodes[key]) colorDistinctNodes[key] = [];
                if (elRef && colorDistinctNodes[key].indexOf(elRef) === -1) {
                    colorDistinctNodes[key].push(elRef);
                }
                if (colorCounts[key] > bestScore) {
                    bestScore = colorCounts[key];
                    bestKey = key;
                }
            }

            function recordNeutralColor(c, weight, elRef) {
                var key = Math.round(c.r / 4) + ',' + Math.round(c.g / 4) + ',' + Math.round(c.b / 4);
                neutralCounts[key] = (neutralCounts[key] || 0) + weight;
                if (!neutralSamples[key]) neutralSamples[key] = c;
                if (!neutralDistinctNodes[key]) neutralDistinctNodes[key] = [];
                if (elRef && neutralDistinctNodes[key].indexOf(elRef) === -1) {
                    neutralDistinctNodes[key].push(elRef);
                }
                if (neutralCounts[key] > bestNeutralScore) {
                    bestNeutralScore = neutralCounts[key];
                    bestNeutralKey = key;
                }
            }

            if (outRoots.length > 0) {
                for (var or = outRoots.length - 1; or >= 0 && or >= outRoots.length - 12; or--) {
                    var rootEl = outRoots[or];
                    var subNodes = rootEl.querySelectorAll('div, span');
                    for (var s = 0; s < subNodes.length && s < 60; s++) {
                        var sub = subNodes[s];
                        if (sub.querySelector('img, video, canvas, svg') && sub.getBoundingClientRect().width < 44) continue;
                        var sr = sub.getBoundingClientRect();
                        if (sr.right <= midThreshold || sr.left <= leftMin) continue;
                        if (sr.width < 32 || sr.width > maxBubbleW || sr.height < 18 || sr.height > 360) continue;
                        cs = window.getComputedStyle(sub);
                        col = parseCssColor(cs.backgroundColor);
                        var areaWeight = Math.min(4, Math.max(1, Math.round((sr.width * sr.height) / 1500)));
                        if (isValidAccentColor(col)) {
                            recordCandidateColor(col, areaWeight, rootEl);
                        } else if (isValidNeutralThemeColor(col, mainBg, incomingBg)) {
                            recordNeutralColor(col, areaWeight, rootEl);
                        } else if (sr.width >= 140 && Math.abs(sr.width - sr.height) <= 24) {
                            col = parseCssColor(cs.borderTopColor);
                            if (isValidAccentColor(col)) {
                                recordCandidateColor(col, 3, rootEl);
                            } else if (isValidNeutralThemeColor(col, mainBg, incomingBg)) {
                                recordNeutralColor(col, 3, rootEl);
                            }
                        }
                    }
                }
                if (bestKey && colorSamples[bestKey] && (!bestNeutralKey || bestScore >= bestNeutralScore * 0.5)) {
                    return saveMainThemeAccent(colorSamples[bestKey]);
                }
                if (bestNeutralKey && neutralSamples[bestNeutralKey]) {
                    return saveMainThemeAccent(neutralSamples[bestNeutralKey]);
                }
            }

            // 2. Fallback: evaluar color modal/mayoritario en contenedores de burbuja de la mitad derecha
            var nodes = mainEl.querySelectorAll('div, span');
            var checked = 0;
            for (d = nodes.length - 1; d >= 0 && checked < 450; d--) {
                var el = nodes[d];
                if (el.closest('header, footer, [role="dialog"], [role="menu"], [data-animate-picker]')) continue;
                if (el.getAttribute('role') === 'button' && el.getBoundingClientRect().height < 30) continue;
                var r = el.getBoundingClientRect();
                if (r.right <= midThreshold || r.left <= leftMin) continue;
                if (r.width < 34 || r.width > maxBubbleW || r.height < 20 || r.height > 350) continue;
                checked++;
                cs = window.getComputedStyle(el);
                col = parseCssColor(cs.backgroundColor);
                var bubbleGroup = el.closest('[role="row"], [data-id]') || el;
                var stepWeight = Math.min(3, Math.max(1, Math.round((r.width * r.height) / 1800)));
                var leftDist = r.left - mainRect.left;
                var rightDist = mainRect.right - r.right;
                var isRightAnchoredBubble = (leftDist > rightDist + 20 && rightDist >= 16 && rightDist <= 140);
                if (isValidAccentColor(col)) {
                    recordCandidateColor(col, stepWeight, bubbleGroup);
                } else if (isRightAnchoredBubble && isValidNeutralThemeColor(col, mainBg, incomingBg)) {
                    recordNeutralColor(col, stepWeight, bubbleGroup);
                } else if (r.width >= 140 && Math.abs(r.width - r.height) <= 24) {
                    col = parseCssColor(cs.borderTopColor);
                    if (isValidAccentColor(col)) {
                        recordCandidateColor(col, 2, bubbleGroup);
                    } else if (isRightAnchoredBubble && isValidNeutralThemeColor(col, mainBg, incomingBg)) {
                        recordNeutralColor(col, 2, bubbleGroup);
                    }
                }
            }
            var distinctCount = (bestKey && colorDistinctNodes[bestKey]) ? colorDistinctNodes[bestKey].length : 0;
            var neutralDistinctCount = (bestNeutralKey && neutralDistinctNodes[bestNeutralKey]) ? neutralDistinctNodes[bestNeutralKey].length : 0;
            if (bestKey && bestScore >= 3 && distinctCount >= 2 && colorSamples[bestKey] &&
                (!bestNeutralKey || bestScore >= bestNeutralScore * 0.5)) {
                return saveMainThemeAccent(colorSamples[bestKey]);
            }
            if (bestNeutralKey && bestNeutralScore >= 3 && neutralDistinctCount >= 1 && neutralSamples[bestNeutralKey]) {
                return saveMainThemeAccent(neutralSamples[bestNeutralKey]);
            }
        }

        return lastMainThemeAccent;
    }

    function probeAccentFromDom() {
        var probe = ensureAccentProbe();
        var mainCol = probeMainChatThemeAccent(probe);
        if (mainCol) return mainCol;

        var cs, col, i;
        var mainEl = document.getElementById('main');
        if (mainEl) {
            var btns = mainEl.querySelectorAll('footer button, footer [role="button"], footer span[data-icon]');
            for (i = 0; i < btns.length && i < 30; i++) {
                cs = window.getComputedStyle(btns[i]);
                col = parseCssColor(cs.backgroundColor);
                if (isValidAccentColor(col)) return col;
            }
        }
        var pane = document.getElementById('pane-side');
        if (pane) {
            var labeled = pane.querySelectorAll('span[aria-label*="no le" i], span[aria-label*="unread" i]');
            for (i = 0; i < labeled.length && i < 8; i++) {
                var cands = [labeled[i], labeled[i].parentElement];
                for (var c = 0; c < cands.length; c++) {
                    if (!cands[c]) continue;
                    col = parseCssColor(window.getComputedStyle(cands[c]).backgroundColor);
                    if (isValidAccentColor(col)) return col;
                }
            }
            var smalls = pane.querySelectorAll('span, div');
            var checked = 0;
            for (i = 0; i < smalls.length && checked < 400; i++) {
                var sm = smalls[i];
                var txt = sm.textContent;
                if (!txt || txt.length > 4 || !/^\d+$/.test(txt.trim())) continue;
                checked++;
                var sr = sm.getBoundingClientRect();
                if (sr.width < 16 || sr.width > 42 || sr.height < 16 || sr.height > 28) continue;
                cs = window.getComputedStyle(sm);
                if (parseFloat(cs.borderTopLeftRadius) < 8) continue;
                col = parseCssColor(cs.backgroundColor);
                if (isValidAccentColor(col)) return col;
            }
        }
        return null;
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

    function ensureLegibleAccentFg(accentCol, nativeFgStr) {
        var darkFg = { r: 17, g: 27, b: 33, a: 1 };
        var lightFg = { r: 255, g: 255, b: 255, a: 1 };
        var nativeParsed = parseCssColor(nativeFgStr) || (isUiDarkMode() ? darkFg : lightFg);
        var nativeCr = contrastRatio(accentCol, nativeParsed);
        var darkCr = contrastRatio(accentCol, darkFg);
        var lightCr = contrastRatio(accentCol, lightFg);
        var bestFgStr = darkCr >= lightCr ? '#111b21' : '#ffffff';
        var bestCr = Math.max(darkCr, lightCr);
        var minRequiredCr = isAchromaticColor(accentCol) ? 4.5 : 2.6;
        if (nativeCr < minRequiredCr && bestCr > nativeCr + 0.5) {
            return { fg: bestFgStr, overridden: true };
        }
        return { fg: nativeFgStr, overridden: false };
    }

    function resolveNativeBadgeFg() {
        var fgOverrideActive = document.documentElement && document.documentElement.getAttribute('data-wa-accent-fg-override') === 'true';
        if (!fgOverrideActive) {
            var scopes = [
                document.querySelector('[data-wa-nav-rail="true"]') || document.querySelector('#app > div > header') || document.querySelector('#app header'),
                document.getElementById('pane-side') || document.getElementById('side')
            ];
            var badgeSelector = 'span[aria-label*="no le" i], span[aria-label*="unread" i], [aria-label*="no le" i] span, [aria-label*="unread" i] span';
            for (var s = 0; s < scopes.length; s++) {
                var root = scopes[s];
                if (!root) continue;
                var badges = root.querySelectorAll(badgeSelector);
                for (var i = 0; i < badges.length; i++) {
                    var b = badges[i];
                    if (!b || (b.classList && b.classList.contains('wa-alt-badge'))) continue;
                    var leaf = b;
                    if (leaf.children.length > 0) {
                        var innerSpans = b.querySelectorAll('span, div');
                        for (var j = 0; j < innerSpans.length; j++) {
                            var sp = innerSpans[j];
                            if (sp.children.length === 0 && /^\d+\+?$/.test((sp.textContent || '').trim())) {
                                leaf = sp;
                                break;
                            }
                        }
                    }
                    if (leaf.children.length !== 0 || !/^\d+\+?$/.test((leaf.textContent || '').trim())) continue;
                    var br = leaf.getBoundingClientRect();
                    if (br.width <= 0 || br.height <= 0 || br.width > 96 || br.height > 40) continue;

                    // Exigir un fondo cromatico real en la pildora (descarta contadores grises de chats silenciados)
                    var hasChromaticPillBg = false;
                    var pillNode = leaf;
                    for (var depth = 0; depth < 3 && pillNode && pillNode !== root; depth++) {
                        var pr = pillNode.getBoundingClientRect();
                        if (pr.width > 96 || pr.height > 40) break;
                        var pBg = parseCssColor(window.getComputedStyle(pillNode).backgroundColor);
                        if (pBg && pBg.a > 0.5) {
                            hasChromaticPillBg = isValidAccentColor(pBg);
                            break;
                        }
                        pillNode = pillNode.parentElement;
                    }
                    if (!hasChromaticPillBg) continue;

                    var cs = window.getComputedStyle(leaf);
                    var col = parseCssColor(cs.color);
                    if (col && col.a > 0.5) {
                        return 'rgb(' + col.r + ', ' + col.g + ', ' + col.b + ')';
                    }
                }
            }
            var varTargets = [
                document.getElementById('pane-side'),
                document.getElementById('side'),
                document.querySelector('#app > div')
            ];
            for (var vt = 0; vt < varTargets.length; vt++) {
                var t = varTargets[vt];
                if (!t) continue;
                var raw = (window.getComputedStyle(t).getPropertyValue('--unread-marker-text') || '').trim();
                if (raw) {
                    var parsed = parseCssColor(raw);
                    if (parsed && parsed.a > 0.5) {
                        return 'rgb(' + parsed.r + ', ' + parsed.g + ', ' + parsed.b + ')';
                    }
                }
            }
        }
        return isUiDarkMode() ? '#111b21' : '#ffffff';
    }

    function ensureAccentProbe() {
        if (!document.body) return null;
        if (accentProbeEl && accentProbeEl.isConnected) return accentProbeEl;
        accentProbeEl = document.getElementById('wa-accent-probe');
        if (!accentProbeEl) {
            accentProbeEl = document.createElement('span');
            accentProbeEl.id = 'wa-accent-probe';
            accentProbeEl.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:0;height:0;pointer-events:none;visibility:hidden;';
            document.body.appendChild(accentProbeEl);
        }
        return accentProbeEl;
    }

    function resolveCssVarColor(rawVal, styleObj, probe) {
        if (!rawVal) return null;
        var current = rawVal.trim();
        for (var depth = 0; depth < 5; depth++) {
            var varMatch = current.match(/^var\(\s*(--[a-zA-Z0-9_-]+)(?:\s*,\s*([^)]+))?\s*\)$/);
            if (!varMatch) break;
            var nextVal = styleObj ? styleObj.getPropertyValue(varMatch[1]).trim() : '';
            if (nextVal) {
                current = nextVal;
            } else if (varMatch[2]) {
                current = varMatch[2].trim();
            } else {
                return null;
            }
        }
        var direct = parseCssColor(current);
        if (direct) return direct;
        if (probe) {
            probe.style.color = '';
            probe.style.color = current;
            if (probe.style.color) {
                return parseCssColor(window.getComputedStyle(probe).color);
            }
        }
        return null;
    }

    function detectDynamicAccent() {
        // 1. Sondeo directo de elementos reales en #main (burbujas/pildoras del tema activo) y #pane-side
        var domCol = probeAccentFromDom();
        if (domCol) return domCol;

        var probe = ensureAccentProbe();

        // 2. Scan inline CSS custom properties on #main / #app > div / body / html
        var inlineRoots = [
            document.querySelector('#main > div'),
            document.querySelector('#main'),
            document.querySelector('#app > div'),
            document.body,
            document.documentElement
        ];
        for (var ir = 0; ir < inlineRoots.length; ir++) {
            var iEl = inlineRoots[ir];
            if (!iEl || !iEl.style || !iEl.style.length) continue;
            var iCs = window.getComputedStyle(iEl);
            for (var sp = 0; sp < iEl.style.length; sp++) {
                var propName = iEl.style[sp];
                if (!propName || propName.indexOf('--') !== 0) continue;
                if (propName.indexOf('--wa-dynamic-') === 0) continue;
                if (/(accent|theme|unread|outgoing|brand|primary)/i.test(propName)) {
                    var iVal = iCs.getPropertyValue(propName);
                    var iCol = resolveCssVarColor(iVal, iCs, probe);
                    if (isValidAccentColor(iCol)) {
                        return iCol;
                    }
                }
            }
        }

        // 3. Probe rendered elements (unread badges, send/ptt button, outgoing bubbles, active nav)
        var elementProbes = [
            { sel: '#pane-side [data-testid="icon-unread-count"], #pane-side [data-icon="unread-count"]', props: ['backgroundColor'], checkParent: true },
            { sel: '#pane-side span[aria-label*="no le" i], #pane-side span[aria-label*="unread" i]', props: ['backgroundColor'], checkParent: true },
            { sel: '#main [data-testid="compose-btn-send"], #main button[data-testid="send"], #main [data-icon="send"], #main [data-icon="wds-ic-send-filled"]', props: ['backgroundColor', 'color'], checkParent: true },
            { sel: '#main [data-testid="ptt-btn"], #main [data-icon="ptt"], #main [data-icon="mic"], #main [data-icon="wds-ic-mic-filled"]', props: ['backgroundColor', 'color'], checkParent: true },
            { sel: '#main .message-out div, #main div[data-id^="true_"] div, #main .message-out [data-testid="msg-container"]', props: ['backgroundColor'], checkParent: false },
            { sel: '[data-wa-nav-rail="true"] [aria-pressed="true"], [data-wa-nav-rail="true"] [aria-selected="true"]', props: ['color', 'backgroundColor'], checkParent: false },
            { sel: '#side [role="tablist"] [aria-selected="true"], #side [role="tab"][aria-selected="true"]', props: ['backgroundColor', 'color'], checkParent: false }
        ];
        for (var e = 0; e < elementProbes.length; e++) {
            var spec = elementProbes[e];
            var nodes = document.querySelectorAll(spec.sel);
            for (var n = 0; n < nodes.length && n < 5; n++) {
                var el = nodes[n];
                var targetList = spec.checkParent && el.parentElement ? [el, el.parentElement] : [el];
                for (var t = 0; t < targetList.length; t++) {
                    var cs = window.getComputedStyle(targetList[t]);
                    for (var p = 0; p < spec.props.length; p++) {
                        var parsed = parseCssColor(cs[spec.props[p]]);
                        if (isValidAccentColor(parsed)) {
                            return parsed;
                        }
                    }
                }
            }
        }

        // 2. Check #main theme vars first, then global root candidates
        var rootCandidates = [];
        var mainEl = document.querySelector('#main');
        if (mainEl) rootCandidates.push(mainEl);
        var appChild = document.querySelector('#app > div');
        if (appChild) rootCandidates.push(appChild);
        if (document.body) rootCandidates.push(document.body);
        if (document.documentElement) rootCandidates.push(document.documentElement);

        var rootStyles = [];
        for (var r = 0; r < rootCandidates.length; r++) {
            rootStyles.push(window.getComputedStyle(rootCandidates[r]));
        }

        var primaryVars = [
            '--WDS-accent',
            '--WDS-systems-accent',
            '--WDS-persistent-activity-indicator',
            '--WDS-content-action-default',
            '--accent-primary',
            '--unread-marker-background',
            '--button-primary-background'
        ];
        for (var i = 0; i < primaryVars.length; i++) {
            for (var s = 0; s < rootStyles.length; s++) {
                var val = rootStyles[s].getPropertyValue(primaryVars[i]);
                var col = resolveCssVarColor(val, rootStyles[s], probe);
                if (isValidAccentColor(col)) {
                    return col;
                }
            }
        }

        var fallbackVars = [
            '--teal',
            '--teal-light',
            '--active-tab-marker',
            '--ptt-green',
            '--switch-button-checked-color'
        ];
        for (var f = 0; f < fallbackVars.length; f++) {
            for (var rs = 0; rs < rootStyles.length; rs++) {
                var fVal = rootStyles[rs].getPropertyValue(fallbackVars[f]);
                var fCol = resolveCssVarColor(fVal, rootStyles[rs], probe);
                if (isValidAccentColor(fCol)) {
                    return fCol;
                }
            }
        }

        return { r: 0, g: 168, b: 132, a: 1 };
    }

    function isWhatsAppGreenColor(rgba, minAlpha) {
        var alphaThreshold = (typeof minAlpha === 'number') ? minAlpha : 0.25;
        if (!rgba || rgba.a < alphaThreshold) return false;
        if (rgba.g <= rgba.r + 6 || rgba.g < rgba.b) return false;
        var h = rgbToHue(rgba.r, rgba.g, rgba.b);
        var hsl = rgbToHsl(rgba.r, rgba.g, rgba.b);
        return h >= 88 && h <= 178 && hsl.s >= 0.18;
    }

    function deriveAccentPalette(col) {
        var hsl = rgbToHsl(col.r, col.g, col.b);
        var h = rgbToHue(col.r, col.g, col.b);
        var lightRgb, darkRgb, borderRgb;
        if (isAchromaticColor(col)) {
            var ns = Math.min(hsl.s, 0.08);
            lightRgb = hslToRgb(h, ns, 0.88);
            darkRgb = hslToRgb(h, ns, 0.18);
            borderRgb = hslToRgb(h, ns, 0.36);
        } else {
            var s = Math.max(0.45, Math.min(0.85, hsl.s || 0.65));
            lightRgb = hslToRgb(h, Math.min(0.90, s * 1.05), 0.88);
            darkRgb = hslToRgb(h, Math.min(0.75, s * 0.90), 0.17);
            borderRgb = hslToRgb(h, Math.min(0.80, s), 0.32);
        }
        return {
            light: 'rgb(' + lightRgb.r + ', ' + lightRgb.g + ', ' + lightRgb.b + ')',
            lightRgbStr: lightRgb.r + ', ' + lightRgb.g + ', ' + lightRgb.b,
            dark: 'rgb(' + darkRgb.r + ', ' + darkRgb.g + ', ' + darkRgb.b + ')',
            darkRgbStr: darkRgb.r + ', ' + darkRgb.g + ', ' + darkRgb.b,
            border: 'rgb(' + borderRgb.r + ', ' + borderRgb.g + ', ' + borderRgb.b + ')',
            borderRgbStr: borderRgb.r + ', ' + borderRgb.g + ', ' + borderRgb.b
        };
    }

    var discoveredWdsVarRuleText = '';
    var wdsCandidateVarNames = null;

    var wdsCandidateSheetCount = -1;

    function collectWdsCandidateVarNames() {
        var sheetCount = document.styleSheets ? document.styleSheets.length : 0;
        if (wdsCandidateVarNames && wdsCandidateVarNames.length > 50 && sheetCount === wdsCandidateSheetCount) {
            return wdsCandidateVarNames;
        }
        var seen = {};
        var names = [
            '--WDS-accent', '--WDS-accent-RGB', '--WDS-systems-accent', '--WDS-systems-accent-RGB',
            '--WDS-persistent-activity-indicator', '--WDS-persistent-activity-indicator-RGB',
            '--unread-marker-background', '--unread-marker-background-rgb',
            '--button-primary-background', '--button-primary-background-rgb',
            '--active-tab-marker', '--active-tab-marker-rgb',
            '--teal', '--teal-rgb', '--teal-light', '--teal-light-rgb',
            '--ptt-green', '--ptt-green-rgb', '--highlight', '--highlight-rgb',
            '--mention-at-text', '--incoming-background-highlight', '--outgoing-background-highlight',
            '--checkbox-background', '--progress-primary', '--spinner-highlight', '--typing', '--typing-rgb'
        ];
        for (var n = 0; n < names.length; n++) {
            seen[names[n]] = true;
        }
        try {
            var sheets = document.styleSheets;
            for (var s = 0; s < sheets.length; s++) {
                var rules;
                try {
                    rules = sheets[s].cssRules;
                } catch (e) {
                    continue;
                }
                if (!rules) continue;
                for (var r = 0; r < rules.length; r++) {
                    var rule = rules[r];
                    var st = rule && rule.style;
                    if (!st || !st.length) continue;
                    var sel = rule.selectorText || '';
                    var isThemeSelector = (
                        sel.indexOf(':root') !== -1 ||
                        sel.indexOf('body') !== -1 ||
                        sel.indexOf('dark') !== -1 ||
                        sel.indexOf('theme') !== -1 ||
                        sel.indexOf('#app') !== -1
                    );
                    if (!isThemeSelector) {
                        if (st.length < 5) continue;
                        var customPropCount = 0;
                        for (var c = 0; c < st.length; c++) {
                            var cp = st[c];
                            if (cp && cp.indexOf('--') === 0 && cp.indexOf('--wa-') !== 0) {
                                customPropCount++;
                                if (customPropCount >= 5) break;
                            }
                        }
                        if (customPropCount < 5) continue;
                    }
                    for (var p = 0; p < st.length; p++) {
                        var prop = st[p];
                        if (prop && prop.indexOf('--') === 0 && prop.indexOf('--wa-') !== 0 && !seen[prop]) {
                            seen[prop] = true;
                            names.push(prop);
                        }
                    }
                }
            }
        } catch (err) {
            // Ignorar hojas inaccesibles
        }
        wdsCandidateVarNames = names;
        wdsCandidateSheetCount = sheetCount;
        return names;
    }

    function syncDynamicWdsCssVars() {
        var styleEl = document.getElementById('wa-dynamic-wds-overrides');
        if (styleEl) {
            styleEl.disabled = true;
        }
        var varNames = collectWdsCandidateVarNames();
        var probeTarget = document.getElementById('side') || document.querySelector('#app > div') || document.body || document.documentElement;
        var targets = probeTarget ? [probeTarget] : [];
        var declarations = [];
        var mapped = {};

        for (var t = 0; t < targets.length; t++) {
            var el = targets[t];
            if (!el) continue;
            var cs = window.getComputedStyle(el);
            for (var i = 0; i < varNames.length; i++) {
                var name = varNames[i];
                if (mapped[name]) continue;
                var val = (cs.getPropertyValue(name) || '').trim();
                if (!val) continue;

                var tripletMatch = val.match(/^\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*$/);
                if (tripletMatch) {
                    var tr = {
                        r: parseInt(tripletMatch[1], 10),
                        g: parseInt(tripletMatch[2], 10),
                        b: parseInt(tripletMatch[3], 10),
                        a: 1
                    };
                    if (isWhatsAppGreenColor(tr, 0.08)) {
                        var trHsl = rgbToHsl(tr.r, tr.g, tr.b);
                        var rgbTarget = '--wa-dynamic-accent-rgb';
                        if (trHsl.l >= 0.72) {
                            rgbTarget = '--wa-dynamic-accent-light-rgb';
                        } else if (trHsl.l <= 0.26) {
                            rgbTarget = '--wa-dynamic-accent-dark-rgb';
                        }
                        declarations.push(name + ': var(' + rgbTarget + ') !important;');
                        mapped[name] = true;
                    }
                    continue;
                }

                var col = parseCssColor(val);
                if (col && isWhatsAppGreenColor(col, 0.08)) {
                    var cHsl = rgbToHsl(col.r, col.g, col.b);
                    if (col.a < 0.98) {
                        var aStr = (Math.round(col.a * 1000) / 1000).toString();
                        var alphaRgbVar = cHsl.l >= 0.72 ? '--wa-dynamic-accent-light-rgb' : (cHsl.l <= 0.26 ? '--wa-dynamic-accent-dark-rgb' : '--wa-dynamic-accent-rgb');
                        declarations.push(name + ': rgba(var(' + alphaRgbVar + '), ' + aStr + ') !important;');
                    } else if (cHsl.l >= 0.72) {
                        declarations.push(name + ': var(--wa-dynamic-accent-light) !important;');
                    } else if (cHsl.l <= 0.26) {
                        declarations.push(name + ': var(--wa-dynamic-accent-dark) !important;');
                    } else {
                        declarations.push(name + ': var(--wa-dynamic-accent) !important;');
                    }
                    mapped[name] = true;
                }
            }
        }

        if (styleEl) {
            styleEl.disabled = false;
        }
        if (declarations.length === 0) return;

        var ruleText = ':root, body, #app, #app > div {\n    ' + declarations.join('\n    ') + '\n}';
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'wa-dynamic-wds-overrides';
            (document.head || document.documentElement).appendChild(styleEl);
        }
        if (ruleText !== discoveredWdsVarRuleText) {
            discoveredWdsVarRuleText = ruleText;
            styleEl.textContent = ruleText;
        }
    }

    function tagSingleWhatsAppGreenElement(el) {
        if (!el || el.nodeType !== 1) return;
        if (el.classList && el.classList.contains('wa-alt-badge')) return;
        var tag = el.tagName ? el.tagName.toLowerCase() : '';
        var isIconOrSvg = (tag === 'svg' || el.hasAttribute('data-icon'));
        var cs = window.getComputedStyle(el);

        if (isIconOrSvg) {
            if (!el.hasAttribute('data-wa-accent-icon')) {
                var iconFg = parseCssColor(cs.color);
                var iconFill = parseCssColor(cs.fill);
                if (isWhatsAppGreenColor(iconFg, 0.12) || isWhatsAppGreenColor(iconFill, 0.12)) {
                    el.setAttribute('data-wa-accent-icon', 'true');
                } else if (tag !== 'svg') {
                    var childPath = el.querySelector('svg, path');
                    if (childPath) {
                        var cpCs = window.getComputedStyle(childPath);
                        if (isWhatsAppGreenColor(parseCssColor(cpCs.fill), 0.12) || isWhatsAppGreenColor(parseCssColor(cpCs.color), 0.12)) {
                            el.setAttribute('data-wa-accent-icon', 'true');
                        } else if (isWhatsAppGreenColor(parseCssColor(cpCs.stroke), 0.12)) {
                            el.setAttribute('data-wa-accent-stroke', 'true');
                        }
                    }
                }
            }
            if (!el.hasAttribute('data-wa-accent-stroke')) {
                var iconStroke = parseCssColor(cs.stroke);
                if (isWhatsAppGreenColor(iconStroke, 0.12)) {
                    el.setAttribute('data-wa-accent-stroke', 'true');
                }
            }
            return;
        }

        if (!el.hasAttribute('data-wa-accent-bg') && !el.hasAttribute('data-wa-accent-bg-light') && !el.hasAttribute('data-wa-accent-pill')) {
            var bg = parseCssColor(cs.backgroundColor);
            if (isWhatsAppGreenColor(bg, 0.12)) {
                var hsl = rgbToHsl(bg.r, bg.g, bg.b);
                if (hsl.l < 0.28 || el.getAttribute('role') === 'tab' || el.closest('[role="tablist"]')) {
                    el.setAttribute('data-wa-accent-pill', 'true');
                } else if (hsl.l >= 0.72) {
                    el.setAttribute('data-wa-accent-bg-light', 'true');
                } else {
                    el.setAttribute('data-wa-accent-bg', 'true');
                }
            }
        }
        if (!el.hasAttribute('data-wa-accent-border')) {
            var bc = parseCssColor(cs.borderTopColor || cs.borderColor);
            if (isWhatsAppGreenColor(bc, 0.12)) {
                el.setAttribute('data-wa-accent-border', 'true');
            }
        }
        if (!el.hasAttribute('data-wa-accent-fg') && !el.hasAttribute('data-wa-accent-fg-light') &&
            !el.hasAttribute('data-wa-accent-fg-dark') && !el.hasAttribute('data-wa-accent-bg') &&
            (el.children.length === 0 || el.getAttribute('role') === 'tab' || el.closest('[role="tablist"]')) &&
            (el.textContent || '').trim().length > 0) {
            var fg = parseCssColor(cs.color);
            if (isWhatsAppGreenColor(fg, 0.12)) {
                var fgHsl = rgbToHsl(fg.r, fg.g, fg.b);
                if (fgHsl.l >= 0.68 || el.hasAttribute('data-wa-accent-pill') || el.closest('[data-wa-accent-pill="true"]')) {
                    el.setAttribute('data-wa-accent-fg-light', 'true');
                } else if (fgHsl.l <= 0.34) {
                    el.setAttribute('data-wa-accent-fg-dark', 'true');
                } else {
                    el.setAttribute('data-wa-accent-fg', 'true');
                }
            }
        }
    }

    function tagWhatsAppGreenSubtree(rootNode, maxLimit) {
        if (!rootNode || rootNode.nodeType !== 1) return;
        if (document.body && document.body.classList.contains('wa-sidebar-animating')) return;
        var oldPills = rootNode.querySelectorAll ? rootNode.querySelectorAll('[data-wa-accent-pill="true"]') : [];
        for (var op = 0; op < oldPills.length; op++) {
            var pill = oldPills[op];
            if (pill.getAttribute('aria-selected') === 'false' || pill.getAttribute('aria-pressed') === 'false') {
                pill.removeAttribute('data-wa-accent-pill');
                pill.removeAttribute('data-wa-accent-fg-light');
                pill.removeAttribute('data-wa-accent-border');
            }
        }
        tagSingleWhatsAppGreenElement(rootNode);
        if (!rootNode.querySelectorAll) return;
        var limit = maxLimit || 2800;
        var nodes = rootNode.querySelectorAll('span, div, button, [role="button"], [role="tab"], svg, [data-icon]');
        for (var i = 0; i < nodes.length && i < limit; i++) {
            tagSingleWhatsAppGreenElement(nodes[i]);
        }
    }

    var lastAccentContextSig = '';
    var lastWdsThemeSig = '';

    function getThemeStateSignature() {
        var html = document.documentElement;
        var body = document.body;
        var appRoot = document.querySelector('#app > div');
        var htmlDark = html ? ((html.getAttribute('data-theme') || '') + '|' + (html.classList.contains('dark') ? '1' : '0')) : '';
        var bodyDark = body ? ((body.getAttribute('data-theme') || '') + '|' + (body.classList.contains('dark') ? '1' : '0')) : '';
        var appCls = appRoot ? (appRoot.className || '') : '';
        return htmlDark + '||' + bodyDark + '||' + appCls;
    }

    function getActiveChatSignature() {
        var mainEl = document.getElementById('main');
        if (!mainEl) return 'no-main';
        var titleEl = mainEl.querySelector('header span[title], header [dir="auto"]');
        var titleTxt = titleEl ? (titleEl.getAttribute('title') || titleEl.textContent || '').trim().slice(0, 80) : '';
        var firstChild = mainEl.firstElementChild;
        var mainCls = (mainEl.className || '') + '|' + (firstChild ? (firstChild.className || '') : '');
        var mainInline = (mainEl.getAttribute('style') || '') + '|' + (firstChild ? (firstChild.getAttribute('style') || '') : '');
        var msgOut = mainEl.querySelector('.message-out, [data-id^="true_"]');
        var msgOutSig = msgOut ? ('1:' + (msgOut.className || '')) : '0';
        return titleTxt + '||' + mainCls + '||' + mainInline + '||' + msgOutSig;
    }

    function tagWhatsAppGreenAccents() {
        if (discoveredWdsVarRuleText) return;
        if (document.body && document.body.classList.contains('wa-sidebar-animating')) return;
        var roots = [
            document.querySelector('[data-wa-nav-rail="true"]') || document.querySelector('#app header'),
            document.getElementById('side') || document.querySelector('[data-wa-side-column="true"]')
        ];
        for (var r = 0; r < roots.length; r++) {
            if (roots[r]) {
                tagWhatsAppGreenSubtree(roots[r], 400);
            }
        }
    }

    function syncThemePalette(forceWhenAlt, forceProbe) {
        if (!forceWhenAlt && window.__waAltKeyDown === true) return;
        if (document.body && document.body.classList.contains('wa-sidebar-animating')) return;

        var themeSig = getThemeStateSignature();
        var themeChanged = (themeSig !== lastWdsThemeSig);
        var existingWdsStyle = document.getElementById('wa-dynamic-wds-overrides');
        if (!themeChanged && !discoveredWdsVarRuleText && existingWdsStyle && existingWdsStyle.textContent) {
            discoveredWdsVarRuleText = existingWdsStyle.textContent;
        }
        if (themeChanged || (!discoveredWdsVarRuleText && document.querySelector('#app > div'))) {
            if (themeChanged) {
                discoveredWdsVarRuleText = '';
                lastWdsThemeSig = themeSig;
            }
            if (document.querySelector('#app > div')) {
                syncDynamicWdsCssVars();
            }
        }

        var ctxSig = themeSig + '###' + getActiveChatSignature();
        if (!forceProbe && !themeChanged && lastAppliedAccent && ctxSig === lastAccentContextSig) {
            return;
        }
        lastAccentContextSig = ctxSig;

        var col = normalizeAccent(detectDynamicAccent());
        var cssAccent = 'rgb(' + col.r + ', ' + col.g + ', ' + col.b + ')';
        var cssAccentRgb = col.r + ', ' + col.g + ', ' + col.b;
        var cssTint = 'rgba(' + col.r + ', ' + col.g + ', ' + col.b + ', 0.22)';
        var palette = deriveAccentPalette(col);
        var fgCheck = ensureLegibleAccentFg(col, resolveNativeBadgeFg());
        var cssFg = fgCheck.fg;
        if (fgCheck.overridden) {
            document.documentElement.setAttribute('data-wa-accent-fg-override', 'true');
        } else {
            document.documentElement.removeAttribute('data-wa-accent-fg-override');
        }
        if (cssAccent !== lastAppliedAccent) {
            lastAppliedAccent = cssAccent;
            window.__waAppliedDynamicAccent = cssAccent;
            document.documentElement.style.setProperty('--wa-dynamic-accent', cssAccent);
            document.documentElement.style.setProperty('--wa-dynamic-accent-rgb', cssAccentRgb);
            document.documentElement.style.setProperty('--wa-dynamic-accent-tint', cssTint);
            document.documentElement.style.setProperty('--wa-dynamic-accent-light', palette.light);
            document.documentElement.style.setProperty('--wa-dynamic-accent-light-rgb', palette.lightRgbStr);
            document.documentElement.style.setProperty('--wa-dynamic-accent-dark', palette.dark);
            document.documentElement.style.setProperty('--wa-dynamic-accent-dark-rgb', palette.darkRgbStr);
            document.documentElement.style.setProperty('--wa-dynamic-accent-border', palette.border);
            document.documentElement.style.setProperty('--wa-dynamic-accent-border-rgb', palette.borderRgbStr);
        }
        if (cssFg !== lastAppliedAccentFg) {
            lastAppliedAccentFg = cssFg;
            document.documentElement.style.setProperty('--wa-dynamic-accent-fg', cssFg);
        }
    }

    function syncDynamicAccent() {
        syncThemePalette(false, true);
        if (!discoveredWdsVarRuleText) {
            tagWhatsAppGreenAccents();
        }
    }

    window.__waDetectAndApplyAccent = function() {
        syncThemePalette(false, true);
        if (!discoveredWdsVarRuleText) {
            tagWhatsAppGreenAccents();
        }
        return {
            accent: lastAppliedAccent,
            fg: lastAppliedAccentFg
        };
    };

    var paletteSyncTimer = null;

    function scheduleAccentSync(immediate) {
        if (document.body && document.body.classList.contains('wa-sidebar-animating')) return;
        if (immediate) {
            if (paletteSyncTimer) {
                clearTimeout(paletteSyncTimer);
                paletteSyncTimer = null;
            }
            syncThemePalette(false, true);
            return;
        }
        if (!paletteSyncTimer && window.__waAltKeyDown !== true) {
            paletteSyncTimer = setTimeout(function() {
                paletteSyncTimer = null;
                if (window.__waAltKeyDown !== true) {
                    syncThemePalette(false, false);
                }
            }, 300);
        }
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

    function rectsIntersect(a, b, pad) {
        var p = pad || 0;
        return a.left - p <= b.right &&
               a.right + p >= b.left &&
               a.top - p <= b.bottom &&
               a.bottom + p >= b.top;
    }

    function isLayoutColumnOrAncestor(el, sideEl, mainEl) {
        if (!el) return true;
        if (el === document.documentElement || el === document.body || el.id === 'app' || el.id === 'wa-compact-hover-tooltip') {
            return true;
        }
        if ((el.classList && el.classList.contains('app-wrapper-web')) || el.hasAttribute('data-wa-flex-container')) {
            return true;
        }
        if ((sideEl && el.contains(sideEl)) || (mainEl && el.contains(mainEl))) {
            return true;
        }
        return !!(el.closest('#side, [data-wa-side-column="true"], #main, [data-wa-main-column="true"], [data-wa-tab-shell="true"], [data-wa-tab-side-column="true"], [data-wa-left-drawer="true"], [data-wa-right-column="true"], [data-wa-nav-rail="true"]'));
    }

    function isPointCoveredByOverlay(resizerEl, testX, testY) {
        if (typeof document.elementsFromPoint !== 'function') return false;
        var x = Math.max(1, Math.min(window.innerWidth - 2, Math.round(testX)));
        var y = Math.max(1, Math.min(window.innerHeight - 2, Math.round(testY)));
        var stack = document.elementsFromPoint(x, y);
        if (!stack || !stack.length) return false;

        var resizerIdx = stack.indexOf(resizerEl);
        var sideEl = document.getElementById('side');
        var mainEl = document.getElementById('main');

        for (var i = 0; i < stack.length; i++) {
            var el = stack[i];
            if (el === resizerEl || el === resizerElement || el === rightResizerElement) continue;
            if (el === document.documentElement || el === document.body || el.id === 'app' || el.id === 'wa-compact-hover-tooltip') {
                continue;
            }
            if ((el.classList && el.classList.contains('app-wrapper-web')) || el.hasAttribute('data-wa-flex-container')) {
                continue;
            }
            var explicitOverlay = el.matches(OVERLAY_CHECK_SELECTOR) ? el : el.closest(OVERLAY_CHECK_SELECTOR);
            if (explicitOverlay && !explicitOverlay.closest('[data-wa-right-column="true"], [data-wa-left-drawer="true"], [data-wa-tab-shell="true"], [data-wa-tab-side-column="true"]') && isElementVisible(explicitOverlay)) {
                return true;
            }
            if (resizerIdx > 0 && i < resizerIdx && isElementVisible(el)) {
                return true;
            }
            if (!isLayoutColumnOrAncestor(el, sideEl, mainEl) && isElementVisible(el)) {
                return true;
            }
        }
        return false;
    }

    function isOpaqueColor(bg) {
        var c = parseCssColor(bg);
        return !!(c && c.a > 0.5);
    }

    var pickerOpeningUntil = 0;

    function isPopupCandidatePresent(el) {
        if (!el || !el.isConnected) return false;
        var cs = window.getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden';
    }

    function parseTransformOriginX(cs, boxW) {
        if (!cs || !cs.transformOrigin) return boxW / 2;
        var parts = cs.transformOrigin.trim().split(/\s+/);
        if (!parts.length) return boxW / 2;
        var token = parts[0];
        var val = parseFloat(token);
        if (!isFinite(val)) return boxW / 2;
        if (token.indexOf('%') !== -1) {
            return (val / 100) * boxW;
        }
        return val;
    }

    function computeUnscaledHorizontalBounds(host, rect, prevDx) {
        var boxW = host.offsetWidth || Math.round(rect.width);
        if (boxW <= 0) return null;
        var cs = window.getComputedStyle(host);
        var tr = cs.transform;
        var scaleX = 1;
        var tx = 0;
        var hasMatrix = false;

        if (tr && tr !== 'none') {
            if (typeof window.DOMMatrixReadOnly === 'function') {
                try {
                    var dm = new window.DOMMatrixReadOnly(tr);
                    scaleX = isFinite(dm.a) ? dm.a : (isFinite(dm.m11) ? dm.m11 : 1);
                    tx = isFinite(dm.m41) ? dm.m41 : 0;
                    hasMatrix = true;
                } catch (err) {
                    hasMatrix = false;
                }
            }
            if (!hasMatrix) {
                var m2d = tr.match(/matrix\(\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)/);
                if (m2d) {
                    var parsed2dScale = parseFloat(m2d[1]);
                    var parsed2dTx = parseFloat(m2d[5]);
                    scaleX = isFinite(parsed2dScale) ? parsed2dScale : 1;
                    tx = isFinite(parsed2dTx) ? parsed2dTx : 0;
                    hasMatrix = true;
                } else {
                    var m3d = tr.match(/matrix3d\(([^)]+)\)/);
                    if (m3d) {
                        var parts = m3d[1].split(',');
                        if (parts.length >= 16) {
                            var parsed3dScale = parseFloat(parts[0]);
                            var parsed3dTx = parseFloat(parts[12]);
                            scaleX = isFinite(parsed3dScale) ? parsed3dScale : 1;
                            tx = isFinite(parsed3dTx) ? parsed3dTx : 0;
                            hasMatrix = true;
                        }
                    }
                }
            }
        }

        if (cs.scale && cs.scale !== 'none') {
            var scaleParts = cs.scale.trim().split(/\s+/);
            var cssScaleX = parseFloat(scaleParts[0]);
            if (isFinite(cssScaleX)) {
                scaleX *= cssScaleX;
            }
        }

        var unscaledLeft;
        var isScaled = Math.abs(scaleX - 1) > 1e-4;
        if ((cs.position === 'fixed' || cs.position === 'absolute') && hasMatrix && !isScaled && host.offsetParent === document.body) {
            unscaledLeft = (host.offsetLeft || 0) + tx;
        } else if (isScaled) {
            if (scaleX >= 0) {
                var originX = parseTransformOriginX(cs, boxW);
                unscaledLeft = (rect.left - prevDx) - originX * (1 - scaleX);
            } else if (rect.width > 0) {
                var center = (rect.left - prevDx) + rect.width / 2;
                unscaledLeft = center - boxW / 2;
            } else {
                unscaledLeft = rect.left - prevDx;
            }
        } else {
            unscaledLeft = rect.left - prevDx;
        }

        return {
            naturalLeft: unscaledLeft,
            naturalRight: unscaledLeft + boxW,
            width: boxW,
            scaleX: scaleX,
            transitionProperty: cs.transitionProperty || ''
        };
    }

    function isFloatingPickerHost(host) {
        if (!host || host.nodeType !== 1 || !host.isConnected) return false;
        return host.matches('[data-animate-picker], [data-animate-modal-popup], [role="dialog"], [role="menu"], [role="listbox"]') ||
            !!host.querySelector('[role="tablist"], [data-animate-picker], input[type="search"], input[placeholder]');
    }

    function isFloatingHostEligible(host, mainRect) {
        if (!host || !host.isConnected) return false;
        var hRect = host.getBoundingClientRect();
        var hW = host.offsetWidth || hRect.width;
        var hH = host.offsetHeight || hRect.height;
        if (hW < 160 || hH < 110) return false;
        if (mainRect && hH >= mainRect.height * 0.82 && hW >= mainRect.width * 0.88) return false;
        return isFloatingPickerHost(host);
    }

    function clampFloatingPickerViewport(host) {
        if (!host || !host.isConnected || host.__waPickerClamping) return;
        host.__waPickerClamping = true;
        try {
            var rect = host.getBoundingClientRect();
            var offW = host.offsetWidth || Math.round(rect.width);
            var offH = host.offsetHeight || Math.round(rect.height);
            if (offW <= 0 || offH <= 0) return;

            var vw = window.innerWidth;
            var margin = 10;
            var maxAllowedW = vw - 16;
            var isClamped = host.getAttribute('data-wa-picker-clamped') === 'true';
            var hasInlineTranslate = !!host.style.getPropertyValue('translate');
            var prevDx = (isClamped && !hasInlineTranslate)
                ? 0
                : (parseFloat(host.getAttribute('data-wa-picker-dx') || '0') || 0);

            if (offW > maxAllowedW || rect.width > maxAllowedW) {
                host.style.setProperty('max-width', 'calc(100vw - 16px)', 'important');
                host.style.setProperty('box-sizing', 'border-box', 'important');
                host.style.setProperty('overflow-x', 'clip', 'important');
                var innerWide = host.querySelectorAll(':scope > div, :scope > span, [data-animate-picker]');
                for (var iw = 0; iw < innerWide.length; iw++) {
                    innerWide[iw].style.setProperty('max-width', '100%', 'important');
                    innerWide[iw].style.setProperty('box-sizing', 'border-box', 'important');
                }
                rect = host.getBoundingClientRect();
                offW = host.offsetWidth || Math.round(rect.width);
            }

            var bounds = computeUnscaledHorizontalBounds(host, rect, prevDx);
            if (!bounds) return;

            var naturalLeft = bounds.naturalLeft;
            var naturalRight = bounds.naturalRight;
            var targetDx = 0;

            if (naturalLeft < 8) {
                targetDx = Math.round(margin - naturalLeft);
            } else if (naturalRight > vw - 8) {
                targetDx = Math.round((vw - margin) - naturalRight);
            }

            if (targetDx !== 0 || isClamped) {
                var tp = bounds.transitionProperty;
                if (tp && (tp.indexOf('all') !== -1 || tp.indexOf('translate') !== -1)) {
                    host.style.setProperty('transition-property', 'opacity, transform', 'important');
                }
            }

            var isAnimatingScale = Math.abs(bounds.scaleX - 1) > 0.001;
            var dxThreshold = isAnimatingScale ? 3 : 1;
            if (isClamped && hasInlineTranslate && Math.abs(targetDx - prevDx) <= dxThreshold) {
                return;
            }

            if (targetDx !== 0) {
                host.style.setProperty('translate', targetDx + 'px 0px', 'important');
                host.setAttribute('data-wa-picker-dx', String(targetDx));
                host.setAttribute('data-wa-picker-clamped', 'true');
            } else if (isClamped) {
                host.style.removeProperty('translate');
                host.removeAttribute('data-wa-picker-dx');
                host.removeAttribute('data-wa-picker-clamped');
            }
        } finally {
            if (host.__waPickerStyleObs) {
                try {
                    host.__waPickerStyleObs.takeRecords();
                } catch (err) {}
            }
            host.__waPickerClamping = false;
        }
    }

    function attachPopupHostStyleObserver(host) {
        if (!host || host.nodeType !== 1 || host.__waPickerStyleObsAttached) return;
        host.__waPickerStyleObsAttached = true;
        var cleanup = function() {
            if (host.__waPickerStyleObsTimer) {
                clearTimeout(host.__waPickerStyleObsTimer);
                host.__waPickerStyleObsTimer = 0;
            }
            if (host.__waPickerStyleObs) {
                try {
                    host.__waPickerStyleObs.disconnect();
                } catch (err) {}
                host.__waPickerStyleObs = null;
            }
            host.__waPickerStyleObsAttached = false;
        };
        var styleObs = new MutationObserver(function() {
            if (!host.isConnected) {
                cleanup();
                return;
            }
            if (host.__waPickerClamping) return;
            var mainEl = document.getElementById('main');
            var mainRect = mainEl ? mainEl.getBoundingClientRect() : null;
            if (!isFloatingHostEligible(host, mainRect)) return;
            clampFloatingPickerViewport(host);
        });
        host.__waPickerStyleObs = styleObs;
        styleObs.observe(host, { attributes: true, attributeFilter: ['style', 'class'], childList: true });
        host.__waPickerStyleObsTimer = setTimeout(cleanup, 420);
    }

    function resolveFloatingPopupHost(el, mainEl, mainRect) {
        var host = el;
        var initialRect = host.getBoundingClientRect();
        var initialW = host.offsetWidth || initialRect.width;
        var initialH = host.offsetHeight || initialRect.height;
        var initialCs = window.getComputedStyle(host);
        if ((initialCs.position === 'fixed' || initialCs.position === 'absolute') && initialH >= 110 && initialW >= 160) {
            return host;
        }
        for (var up = 0; up < 6 && host.parentElement && host.parentElement !== document.body && host.parentElement !== mainEl; up++) {
            var p = host.parentElement;
            if (p.id === 'app' || p.classList.contains('app-wrapper-web') || p.getAttribute('data-wa-flex-container') === 'true') break;
            var pR = p.getBoundingClientRect();
            var pW = p.offsetWidth || pR.width;
            var pH = p.offsetHeight || pR.height;
            if (mainRect && pH >= mainRect.height * 0.82 && pW >= mainRect.width * 0.88) break;
            if (p.querySelector('[role="application"]')) break;
            var pCs = window.getComputedStyle(p);
            if (p.tagName === 'SPAN' && pCs.position === 'static' && host.tagName === 'DIV') break;
            host = p;
            if ((pCs.position === 'fixed' || pCs.position === 'absolute') && pH >= 110 && pW >= 160) break;
        }
        return host;
    }

    function syncFloatingPickerBounds() {
        var mainEl = document.getElementById('main');
        var mainRect = mainEl ? mainEl.getBoundingClientRect() : null;
        var isPickerOpening = performance.now() < pickerOpeningUntil;
        var selector = '[data-animate-picker], [data-animate-modal-popup], [data-animate-dropdown-item], ' +
            '[role="dialog"], [role="menu"], [role="listbox"], #main [role="tablist"], #app > div > span [role="tablist"], #app > div > div [role="tablist"]';
        if (isPickerOpening) {
            selector += ', #app > div > span > div, #app > div > div > span > div';
        }
        var candidates = document.querySelectorAll(selector);
        var processedHosts = [];
        for (var i = 0; i < candidates.length; i++) {
            var el = candidates[i];
            if (!isPopupCandidatePresent(el)) continue;
            if (el.closest('#side, header, [data-wa-nav-rail="true"], [data-wa-side-column="true"], [data-wa-tab-side-column="true"], [data-wa-left-drawer="true"], [data-wa-right-column="true"]')) {
                continue;
            }
            var host = resolveFloatingPopupHost(el, mainEl, mainRect);
            if (!host || processedHosts.indexOf(host) !== -1) continue;
            processedHosts.push(host);
            if (isFloatingHostEligible(host, mainRect)) {
                attachPopupHostStyleObserver(host);
                clampFloatingPickerViewport(host);
            } else if (isPickerOpening) {
                var hRect = host.getBoundingClientRect();
                var hW = host.offsetWidth || hRect.width;
                var hH = host.offsetHeight || hRect.height;
                var notFullScreen = !(mainRect && hH >= mainRect.height * 0.82 && hW >= mainRect.width * 0.88);
                if (notFullScreen && !host.querySelector('[role="application"]')) {
                    attachPopupHostStyleObserver(host);
                }
            }
        }
    }

    function hasActiveFloatingPickerOrModal() {
        var blurOv = document.getElementById('wa-privacy-blur-overlay');
        if (blurOv && isElementVisible(blurOv)) return true;

        var mainEl = document.getElementById('main');
        var mainRect = mainEl ? mainEl.getBoundingClientRect() : null;
        var footerExpanded = false;
        if (mainEl) {
            var footerEl = mainEl.querySelector('footer');
            if (footerEl) {
                var fRect = footerEl.getBoundingClientRect();
                if (fRect.height >= 165) {
                    footerExpanded = true;
                }
            }
        }

        var candidates = document.querySelectorAll(
            '[data-animate-picker], [data-animate-modal-popup], [data-animate-dropdown-item], ' +
            '[role="dialog"], [role="menu"], [role="listbox"], #main [role="tablist"], #app > div > span [role="tablist"], #app > div > div [role="tablist"]'
        );
        for (var i = 0; i < candidates.length; i++) {
            var el = candidates[i];
            if (!isElementVisible(el)) continue;
            if (el.closest('#side, header, [data-wa-nav-rail="true"], [data-wa-side-column="true"], [data-wa-tab-shell="true"], [data-wa-tab-side-column="true"], [data-wa-left-drawer="true"], [data-wa-right-column="true"]')) {
                continue;
            }
            var host = resolveFloatingPopupHost(el, mainEl, mainRect);
            var hRect = host.getBoundingClientRect();
            if (hRect.width >= 160 && hRect.height >= 110) {
                return true;
            }
        }
        return footerExpanded;
    }

    var FLOATING_PANEL_SELECTOR = '[role="dialog"], [role="menu"], [role="listbox"], [data-animate-picker], [data-animate-dropdown-item], [data-animate-modal-popup]';
    var OVERLAY_EXCLUDE_SELECTOR = '[data-wa-right-column="true"], [data-wa-left-drawer="true"], [data-wa-tab-shell="true"], [data-wa-tab-side-column="true"]';

    function collectOverlayStateSnapshot() {
        var snap = {
            forceCovered: false,
            hasAnyCandidate: false,
            overlayRects: [],
            floatingRects: [],
            expandedFooterRect: null,
            mainPickerRects: []
        };

        var globalOverlays = document.querySelectorAll(OVERLAY_CHECK_SELECTOR);
        for (var i = 0; i < globalOverlays.length; i++) {
            var ov = globalOverlays[i];
            if (!isElementVisible(ov)) continue;
            if (ov.id === 'wa-privacy-blur-overlay') {
                snap.forceCovered = true;
                return snap;
            }
            if (ov.closest(OVERLAY_EXCLUDE_SELECTOR)) continue;
            var ovRect = ov.getBoundingClientRect();
            if (ovRect.width >= window.innerWidth * 0.40 && ovRect.height >= window.innerHeight * 0.40) {
                snap.forceCovered = true;
                return snap;
            }
            snap.overlayRects.push(ovRect);
            snap.hasAnyCandidate = true;
        }

        var floatingNodes = document.querySelectorAll(FLOATING_PANEL_SELECTOR);
        for (var f = 0; f < floatingNodes.length; f++) {
            var fn = floatingNodes[f];
            if (fn.closest('header, ' + OVERLAY_EXCLUDE_SELECTOR)) continue;
            if (!isElementVisible(fn)) continue;
            snap.floatingRects.push(fn.getBoundingClientRect());
            snap.hasAnyCandidate = true;
        }

        var mainEl = document.getElementById('main');
        if (mainEl) {
            var footerEl = mainEl.querySelector('footer');
            if (footerEl) {
                var fRect = footerEl.getBoundingClientRect();
                if (fRect.height >= 150) {
                    snap.expandedFooterRect = fRect;
                    snap.hasAnyCandidate = true;
                }
            }
            var pickers = mainEl.querySelectorAll('[data-animate-picker], [role="tablist"], [role="dialog"], [role="menu"], [role="listbox"]');
            if (pickers.length > 0) {
                var mainRect = mainEl.getBoundingClientRect();
                for (var p = 0; p < pickers.length; p++) {
                    var pk = pickers[p];
                    if (pk.closest('header')) continue;
                    if (!isElementVisible(pk)) continue;
                    var host = pk;
                    for (var up = 0; up < 5 && host.parentElement && host.parentElement !== mainEl; up++) {
                        var parentCand = host.parentElement;
                        var pRect = parentCand.getBoundingClientRect();
                        if (pRect.height >= mainRect.height * 0.78) break;
                        if (parentCand.querySelector('[role="application"]')) break;
                        host = parentCand;
                        if (pRect.height >= 120 && pRect.width >= 160) break;
                    }
                    if (!isElementVisible(host)) continue;
                    var pr = host.getBoundingClientRect();
                    if (pr.height >= 110 && pr.height < mainRect.height * 0.80) {
                        snap.mainPickerRects.push(pr);
                        snap.hasAnyCandidate = true;
                    }
                }
            }
        }

        return snap;
    }

    function isFloatingPanelOverResizer(rRect, overlaySnap) {
        var snap = overlaySnap || collectOverlayStateSnapshot();
        if (snap.forceCovered) return true;
        if (!snap.hasAnyCandidate) return false;

        if (snap.expandedFooterRect && rectsIntersect(snap.expandedFooterRect, rRect, 24)) {
            return true;
        }
        for (var mp = 0; mp < snap.mainPickerRects.length; mp++) {
            if (rectsIntersect(snap.mainPickerRects[mp], rRect, 24)) {
                return true;
            }
        }
        for (var fr = 0; fr < snap.floatingRects.length; fr++) {
            if (rectsIntersect(snap.floatingRects[fr], rRect, 14)) {
                return true;
            }
        }
        return false;
    }

    function isResizerCovered(resizerEl, clientX, clientY, hasFloatingOverlay, overlaySnap) {
        if (!resizerEl || !resizerEl.isConnected || resizerEl.style.display === 'none') return false;
        if (hasFloatingOverlay) return true;

        var snap = overlaySnap || collectOverlayStateSnapshot();
        if (snap.forceCovered) return true;

        var rRect = resizerEl.getBoundingClientRect();
        if (rRect.width <= 0 || rRect.height <= 0) return false;

        if (snap.hasAnyCandidate) {
            for (var i = 0; i < snap.overlayRects.length; i++) {
                if (rectsIntersect(snap.overlayRects[i], rRect, 18)) {
                    return true;
                }
            }
            if (isFloatingPanelOverResizer(rRect, snap)) {
                return true;
            }
        }

        // Sin overlays detectados: a lo sumo 1 hit-test puntual si el puntero real esta en +-20px del resizer
        if (typeof clientX === 'number' && typeof clientY === 'number' &&
            clientX >= rRect.left - 20 && clientX <= rRect.right + 20 &&
            clientY >= rRect.top - 20 && clientY <= rRect.bottom + 20) {
            var midX = Math.round(rRect.left + rRect.width / 2);
            var probeY = Math.round(Math.max(rRect.top + 2, Math.min(rRect.bottom - 2, clientY)));
            if (isPointCoveredByOverlay(resizerEl, midX, probeY)) {
                return true;
            }
        }
        return false;
    }

    function applyResizerDisabledState(resizerEl, disabled) {
        if (!resizerEl) return;
        if (disabled) {
            if (!resizerEl.classList.contains('wa-resizer-disabled')) {
                resizerEl.classList.add('wa-resizer-disabled');
            }
            resizerEl.style.setProperty('pointer-events', 'none', 'important');
            resizerEl.style.setProperty('visibility', 'hidden', 'important');
        } else {
            if (resizerEl.classList.contains('wa-resizer-disabled')) {
                resizerEl.classList.remove('wa-resizer-disabled');
            }
            resizerEl.style.removeProperty('pointer-events');
            resizerEl.style.removeProperty('visibility');
        }
    }

    function syncResizerOverlayState(clientX, clientY) {
        syncFloatingPickerBounds();
        var hasFloatingOverlay = hasActiveFloatingPickerOrModal();
        var overlaySnap = hasFloatingOverlay ? null : collectOverlayStateSnapshot();
        if (resizerElement && !isDragging) {
            var compactHidesLeft = false;
            if (isCompactActive()) {
                var hasTabOrDrawer = !!(document.body && document.body.classList.contains('wa-tab-shell-active'));
                if (!hasTabOrDrawer) {
                    var tabColsCheck = document.querySelectorAll('[data-wa-tab-side-column="true"], [data-wa-left-drawer="true"]');
                    for (var tcc = 0; tcc < tabColsCheck.length; tcc++) {
                        var tccR = tabColsCheck[tcc].getBoundingClientRect();
                        if (tccR.width > 0 && tccR.height > 0) {
                            hasTabOrDrawer = true;
                            break;
                        }
                    }
                }
                compactHidesLeft = !hasTabOrDrawer;
            }
            var leftCovered = (compactHidesLeft || hasFloatingOverlay) ? true : isResizerCovered(resizerElement, clientX, clientY, false, overlaySnap);
            applyResizerDisabledState(resizerElement, leftCovered);
        }
        if (rightResizerElement && !isRightDragging) {
            var rightCovered = hasFloatingOverlay ? true : isResizerCovered(rightResizerElement, clientX, clientY, false, overlaySnap);
            applyResizerDisabledState(rightResizerElement, rightCovered);
        }
    }

    function scheduleResizerOverlayCheck() {
        if (overlayCheckRafPending) return;
        overlayCheckRafPending = true;
        window.requestAnimationFrame(function() {
            overlayCheckRafPending = false;
            syncResizerOverlayState(lastPointerX, lastPointerY);
        });
    }

    function ensureHoverTooltip() {
        if (!document.body) return null;
        if (hoverTooltipEl && hoverTooltipEl.isConnected) return hoverTooltipEl;
        hoverTooltipEl = document.getElementById('wa-compact-hover-tooltip');
        if (!hoverTooltipEl) {
            hoverTooltipEl = document.createElement('div');
            hoverTooltipEl.id = 'wa-compact-hover-tooltip';
            hoverTooltipEl.setAttribute('role', 'tooltip');
            document.body.appendChild(hoverTooltipEl);
        }
        return hoverTooltipEl;
    }

    function hideHoverTooltip() {
        hoverTooltipActiveRow = null;
        if (hoverTooltipEl) {
            hoverTooltipEl.classList.remove('is-visible');
        }
    }

    function computeRowChatName(row) {
        if (!row) return '';
        var titled = row.querySelector('span[title][dir="auto"], span[title]');
        if (titled) {
            var tv = (titled.getAttribute('title') || '').trim();
            if (!tv) tv = (titled.getAttribute('data-wa-orig-title') || '').trim();
            if (!tv) tv = (titled.textContent || '').trim();
            if (tv) return tv;
        }
        var origTitled = row.querySelector('[data-wa-orig-title]');
        if (origTitled) {
            var ov = (origTitled.getAttribute('data-wa-orig-title') || '').trim();
            if (ov) return ov;
        }
        var dirAuto = row.querySelector('[dir="auto"]');
        if (dirAuto) {
            var dv = (dirAuto.textContent || '').trim();
            if (dv) return dv;
        }
        var textCol = row.querySelector('[data-wa-text-col="true"]') || row;
        var lines = (textCol.textContent || '').split(/\n+/);
        for (var li = 0; li < lines.length; li++) {
            var lv = lines[li].trim();
            if (lv) return lv;
        }
        return '';
    }

    function extractRowChatName(row) {
        if (!row) return '';
        var cached = row.getAttribute('data-wa-chat-title');
        if (cached) return cached;
        var name = computeRowChatName(row);
        if (name) {
            row.setAttribute('data-wa-chat-title', name);
        }
        return name;
    }

    function suppressNativeTitles(row) {
        if (row.hasAttribute('title')) {
            row.setAttribute('data-wa-orig-title', row.getAttribute('title'));
            row.removeAttribute('title');
        }
        var titled = row.querySelectorAll('[title]');
        for (var ti = 0; ti < titled.length; ti++) {
            var tEl = titled[ti];
            if (tEl.closest('.wa-alt-badge')) continue;
            tEl.setAttribute('data-wa-orig-title', tEl.getAttribute('title'));
            tEl.removeAttribute('title');
        }
    }

    function restoreNativeTitles() {
        var saved = document.querySelectorAll('[data-wa-orig-title]');
        for (var ri = 0; ri < saved.length; ri++) {
            var rEl = saved[ri];
            if (!rEl.hasAttribute('title')) {
                rEl.setAttribute('title', rEl.getAttribute('data-wa-orig-title'));
            }
            rEl.removeAttribute('data-wa-orig-title');
        }
    }

    function positionHoverTooltip(clientX, clientY) {
        if (!hoverTooltipEl) return;
        var margin = 8;
        var offset = 14;
        var rect = hoverTooltipEl.getBoundingClientRect();
        var w = rect.width || hoverTooltipEl.offsetWidth || 120;
        var h = rect.height || hoverTooltipEl.offsetHeight || 30;
        var x = clientX + offset;
        var y = clientY + offset;
        if (x + w > window.innerWidth - margin) {
            x = Math.max(margin, clientX - w - offset);
        }
        if (y + h > window.innerHeight - margin) {
            y = Math.max(margin, clientY - h - offset);
        }
        x = Math.max(margin, Math.min(x, window.innerWidth - w - margin));
        y = Math.max(margin, Math.min(y, window.innerHeight - h - margin));
        hoverTooltipEl.style.setProperty('left', Math.round(x) + 'px', 'important');
        hoverTooltipEl.style.setProperty('top', Math.round(y) + 'px', 'important');
    }

    function handleCompactTooltipPointerMove(e) {
        if (!isCompactActive() || isDragging || isRightDragging) {
            hideHoverTooltip();
            return;
        }
        var target = e.target;
        if (!target || !target.closest) {
            hideHoverTooltip();
            return;
        }
        var pane = document.getElementById('pane-side');
        if (!pane || !pane.contains(target)) {
            hideHoverTooltip();
            return;
        }
        var row = target.closest('[role="row"], [role="listitem"], div[data-testid="cell-frame-container"]');
        if (!row) {
            var virt = target.closest('div[style*="translateY"], div[style*="translate3d"]');
            if (virt && pane.contains(virt) && virt !== pane && virt.querySelector('img, span[data-icon], svg')) {
                row = virt;
            }
        }
        if (!row || !pane.contains(row) || row.getAttribute('data-wa-compact-hide') === 'true') {
            hideHoverTooltip();
            return;
        }
        var name = extractRowChatName(row);
        if (!name) {
            hideHoverTooltip();
            return;
        }
        var tip = ensureHoverTooltip();
        if (!tip) return;
        if (hoverTooltipActiveRow !== row || tip.textContent !== name) {
            hoverTooltipActiveRow = row;
            tip.textContent = name;
        }
        tip.classList.add('is-visible');
        positionHoverTooltip(e.clientX, e.clientY);
    }

    function updateMainAdaptiveScale() {
        if (document.body && document.body.classList.contains('wa-sidebar-animating')) return;
        var mainEl = document.getElementById('main');
        if (!mainEl) {
            currentMainScale = 1;
            return;
        }
        var containers = resolveLayoutContainers();
        var mainCol = (containers && containers.mainColumn) ? containers.mainColumn : mainEl.parentElement;
        var slotEl = (mainCol && mainCol !== mainEl) ? mainCol : mainEl;
        var slotRect = slotEl.getBoundingClientRect();
        var expectedW = slotRect.width;
        if (currentMainScale === 1 && mainEl !== slotEl) {
            var mainW = mainEl.getBoundingClientRect().width;
            if (mainW > 0 && mainW < expectedW) {
                expectedW = mainW;
            }
        }
        var expectedH = slotRect.height;
        if (expectedW <= 0) return;

        var scale = 1;
        if (expectedW < MAIN_SCALE_THRESHOLD) {
            var raw = Math.max(MAIN_SCALE_MIN, Math.min(1, expectedW / MAIN_SCALE_THRESHOLD));
            scale = Math.round(raw * 1000) / 1000;
            if (scale >= 0.99) scale = 1;
        }

        if (scale === 1) {
            if (currentMainScale !== 1 || mainEl.classList.contains('wa-main-scaled')) {
                currentMainScale = 1;
                document.documentElement.style.removeProperty('--wa-main-scale');
                mainEl.classList.remove('wa-main-scaled');
                mainEl.style.removeProperty('zoom');
                if (mainEl !== mainCol) {
                    mainEl.style.setProperty('width', '100%', 'important');
                    mainEl.style.setProperty('height', '100%', 'important');
                } else {
                    mainEl.style.removeProperty('width');
                    mainEl.style.removeProperty('height');
                }
            }
            return;
        }

        currentMainScale = scale;
        document.documentElement.style.setProperty('--wa-main-scale', String(scale));
        mainEl.classList.add('wa-main-scaled');
        mainEl.style.setProperty('zoom', String(scale), 'important');

        if (mainEl !== mainCol) {
            mainEl.style.setProperty('width', '100%', 'important');
            mainEl.style.setProperty('height', '100%', 'important');
            var mRect = mainEl.getBoundingClientRect();
            if (mRect.width > 0 && mRect.width < expectedW - 2) {
                mainEl.style.setProperty('width', Math.ceil(expectedW / scale) + 'px', 'important');
            }
            if (expectedH > 0 && mRect.height > 0 && mRect.height < expectedH - 2) {
                mainEl.style.setProperty('height', Math.ceil(expectedH / scale) + 'px', 'important');
            }
        }
    }

    var PANEL_ADAPTIVE_SELECTOR = '[data-wa-tab-side-column="true"], [data-wa-left-drawer="true"]:not([data-wa-tab-shell="true"]), [data-wa-right-column="true"]';
    var PANEL_VISUAL_SCALE_MIN = 0.75;

    function hasHorizontalScrollAncestor(el, stopAt) {
        var cur = el;
        while (cur && cur !== stopAt && cur !== document.body) {
            var ovX = window.getComputedStyle(cur).overflowX;
            if (ovX === 'auto' || ovX === 'scroll') return true;
            cur = cur.parentElement;
        }
        return false;
    }

    function parseFixedPixelGridTracks(templateStr) {
        if (!templateStr || templateStr === 'none') return null;
        var parts = templateStr.trim().split(/\s+/);
        if (parts.length < 2) return null;
        var tracks = [];
        var minW = Infinity;
        var maxW = 0;
        var total = 0;
        for (var i = 0; i < parts.length; i++) {
            var m = /^(\d+(?:\.\d+)?)px$/.exec(parts[i]);
            if (!m) return null;
            var val = parseFloat(m[1]);
            if (!(val > 0)) return null;
            tracks.push(val);
            if (val < minW) minW = val;
            if (val > maxW) maxW = val;
            total += val;
        }
        if (maxW - minW > 2.5) return null;
        return {
            count: tracks.length,
            trackW: Math.round(maxW * 10) / 10,
            sumW: total
        };
    }

    function updatePanelAdaptiveContent() {
        if (document.body && document.body.classList.contains('wa-sidebar-animating')) return;
        var panels = document.querySelectorAll(PANEL_ADAPTIVE_SELECTOR);
        if (!panels || panels.length === 0) return;

        for (var pi = 0; pi < panels.length; pi++) {
            var panel = panels[pi];
            var pRect = panel.getBoundingClientRect();
            if (pRect.width < 40 || pRect.height < 40) continue;

            // 1. Reflujo adaptable de grillas con columnas de ancho fijo (mantiene tamano nativo y legibilidad)
            var candidates = panel.querySelectorAll('div, ul, ol, section');
            var limit = Math.min(candidates.length, 450);
            for (var ci = 0; ci < limit; ci++) {
                var el = candidates[ci];
                var isManagedGrid = el.hasAttribute('data-wa-p10-grid');
                var cs = window.getComputedStyle(el);
                if (cs.display !== 'grid' && cs.display !== 'inline-grid') {
                    if (isManagedGrid) {
                        el.style.removeProperty('grid-template-columns');
                        el.removeAttribute('data-wa-p10-grid');
                        el.removeAttribute('data-wa-p10-grid-native');
                    }
                    continue;
                }
                if (hasHorizontalScrollAncestor(el, panel)) continue;

                var gap = parseFloat(cs.columnGap) || 0;
                var padL = parseFloat(cs.paddingLeft) || 0;
                var padR = parseFloat(cs.paddingRight) || 0;
                var availW = Math.floor(el.clientWidth - padL - padR);
                if (availW <= 0) continue;

                var nativeMeta = null;
                var savedAttr = el.getAttribute('data-wa-p10-grid-native');
                if (savedAttr) {
                    var metaParts = savedAttr.split(',');
                    if (metaParts.length === 3) {
                        nativeMeta = {
                            count: parseInt(metaParts[0], 10),
                            trackW: parseFloat(metaParts[1]),
                            totalW: parseFloat(metaParts[2])
                        };
                    }
                } else {
                    var parsed = parseFixedPixelGridTracks(cs.gridTemplateColumns);
                    if (parsed) {
                        var totalW = parsed.sumW + gap * (parsed.count - 1);
                        if (el.scrollWidth > el.clientWidth + 2 || totalW > availW + 2) {
                            nativeMeta = {
                                count: parsed.count,
                                trackW: parsed.trackW,
                                totalW: Math.round(totalW * 10) / 10
                            };
                            el.setAttribute('data-wa-p10-grid-native', nativeMeta.count + ',' + nativeMeta.trackW + ',' + nativeMeta.totalW);
                        }
                    }
                }

                if (!nativeMeta || !(nativeMeta.count >= 2) || !(nativeMeta.trackW > 0)) continue;

                if (availW >= nativeMeta.totalW - 2) {
                    if (isManagedGrid) {
                        el.style.removeProperty('grid-template-columns');
                        el.removeAttribute('data-wa-p10-grid');
                    }
                    continue;
                }

                var fitCols = Math.floor((availW + gap) / (nativeMeta.trackW + gap));
                if (fitCols >= nativeMeta.count) {
                    if (isManagedGrid) {
                        el.style.removeProperty('grid-template-columns');
                        el.removeAttribute('data-wa-p10-grid');
                    }
                } else if (fitCols >= 1) {
                    var nextCols = (fitCols === 1 && nativeMeta.trackW > availW)
                        ? 'minmax(0, 1fr)'
                        : ('repeat(' + fitCols + ', ' + nativeMeta.trackW + 'px)');
                    if (el.style.getPropertyValue('grid-template-columns') !== nextCols || !isManagedGrid) {
                        el.style.setProperty('grid-template-columns', nextCols, 'important');
                        el.setAttribute('data-wa-p10-grid', 'true');
                    }
                } else {
                    if (el.style.getPropertyValue('grid-template-columns') !== 'minmax(0, 1fr)' || !isManagedGrid) {
                        el.style.setProperty('grid-template-columns', 'minmax(0, 1fr)', 'important');
                        el.setAttribute('data-wa-p10-grid', 'true');
                    }
                }
            }

            // 2. Fallback acotado solo para bloques visuales no textuales fuera de grillas y carruseles
            var scaledEls = panel.querySelectorAll('[data-wa-p10-scaled="true"]');
            for (var si = 0; si < scaledEls.length; si++) {
                var sEl = scaledEls[si];
                var natW = parseFloat(sEl.getAttribute('data-wa-p10-nat-w') || '0');
                var sParent = sEl.parentElement;
                var pAvail = sParent ? sParent.clientWidth : Math.floor(pRect.width);
                if (!(natW > 0) || pAvail >= natW - 2 || hasHorizontalScrollAncestor(sEl, panel)) {
                    sEl.style.removeProperty('zoom');
                    sEl.removeAttribute('data-wa-p10-scaled');
                    sEl.removeAttribute('data-wa-p10-nat-w');
                } else {
                    var updatedScale = Math.max(PANEL_VISUAL_SCALE_MIN, Math.min(1, Math.round((pAvail / natW) * 1000) / 1000));
                    if (updatedScale >= 0.98) {
                        sEl.style.removeProperty('zoom');
                        sEl.removeAttribute('data-wa-p10-scaled');
                        sEl.removeAttribute('data-wa-p10-nat-w');
                    } else {
                        sEl.style.setProperty('zoom', String(updatedScale), 'important');
                    }
                }
            }

            var mediaNodes = panel.querySelectorAll('img, canvas, video, svg');
            var mediaLimit = Math.min(mediaNodes.length, 120);
            for (var mi = 0; mi < mediaLimit; mi++) {
                var mEl = mediaNodes[mi];
                if (mEl.hasAttribute('data-wa-p10-scaled')) continue;
                if (mEl.closest('[data-wa-p10-grid="true"], [data-wa-p10-scaled="true"]')) continue;
                if (hasHorizontalScrollAncestor(mEl, panel)) continue;
                var mRect2 = mEl.getBoundingClientRect();
                if (mRect2.width < 64 || mRect2.height < 40) continue;
                if (mRect2.right <= pRect.right + 4) continue;
                var mParent = mEl.parentElement;
                var mAvail = mParent && mParent.clientWidth > 0 ? mParent.clientWidth : Math.floor(pRect.width - 16);
                if (mAvail <= 0 || mRect2.width <= mAvail + 4) continue;
                var mScale = Math.max(PANEL_VISUAL_SCALE_MIN, Math.min(1, Math.round((mAvail / mRect2.width) * 1000) / 1000));
                if (mScale < 0.98) {
                    mEl.setAttribute('data-wa-p10-nat-w', String(Math.ceil(mRect2.width)));
                    mEl.setAttribute('data-wa-p10-scaled', 'true');
                    mEl.style.setProperty('zoom', String(mScale), 'important');
                }
            }
        }
    }

    function scheduleMainScaleUpdate() {
        if (document.body && document.body.classList.contains('wa-sidebar-animating')) return;
        if (mainScaleRafPending) return;
        mainScaleRafPending = true;
        window.requestAnimationFrame(function() {
            mainScaleRafPending = false;
            if (document.body && document.body.classList.contains('wa-sidebar-animating')) return;
            updateMainAdaptiveScale();
            updatePanelAdaptiveContent();
        });
    }

    var mainScaleResizeObserver = null;
    var mainScaleObservedTargets = [];

    function disconnectMainResizeObserver() {
        if (mainScaleResizeObserver) {
            mainScaleResizeObserver.disconnect();
        }
        mainScaleObservedTargets = [];
    }

    function ensureMainResizeObserver() {
        if (!window.ResizeObserver) return;
        if (document.hidden) return;
        if (document.body && document.body.classList.contains('wa-sidebar-animating')) return;
        var containers = resolveLayoutContainers();
        var targets = [];
        if (containers && containers.mainColumn) targets.push(containers.mainColumn);
        if (containers && containers.flexContainer) targets.push(containers.flexContainer);
        var mainEl = document.getElementById('main');
        if (mainEl && targets.indexOf(mainEl) === -1) targets.push(mainEl);

        var adaptivePanels = document.querySelectorAll(PANEL_ADAPTIVE_SELECTOR);
        for (var ap = 0; ap < adaptivePanels.length; ap++) {
            var apEl = adaptivePanels[ap];
            if (apEl && targets.indexOf(apEl) === -1) targets.push(apEl);
        }

        if (!mainScaleResizeObserver) {
            mainScaleResizeObserver = new ResizeObserver(function() {
                if (document.hidden) return;
                if (document.body && document.body.classList.contains('wa-sidebar-animating')) return;
                scheduleMainScaleUpdate();
            });
        }

        var nextObserved = [];
        for (var p = 0; p < mainScaleObservedTargets.length; p++) {
            var prev = mainScaleObservedTargets[p];
            if (!prev || !prev.isConnected || targets.indexOf(prev) === -1) {
                try {
                    if (prev) mainScaleResizeObserver.unobserve(prev);
                } catch (e) {}
            } else {
                nextObserved.push(prev);
            }
        }

        for (var i = 0; i < targets.length; i++) {
            var t = targets[i];
            if (!t || nextObserved.indexOf(t) !== -1) continue;
            mainScaleResizeObserver.observe(t);
            nextObserved.push(t);
        }

        mainScaleObservedTargets = nextObserved;
        if (adaptivePanels.length > 0) {
            scheduleMainScaleUpdate();
        }
    }

    function resetHorizontalScrollLock(container) {
        if (document.documentElement && document.documentElement.scrollLeft !== 0) {
            document.documentElement.scrollLeft = 0;
        }
        if (document.body && document.body.scrollLeft !== 0) {
            document.body.scrollLeft = 0;
        }
        var appEl = document.getElementById('app');
        if (appEl && appEl.scrollLeft !== 0) {
            appEl.scrollLeft = 0;
        }
        var wrapperEl = document.querySelector('.app-wrapper-web');
        if (wrapperEl && wrapperEl.scrollLeft !== 0) {
            wrapperEl.scrollLeft = 0;
        }
        if (container && container.scrollLeft !== 0) {
            container.scrollLeft = 0;
        }
    }

    function splitMultiColumnWrapper(wrapper) {
        if (!wrapper || wrapper.children.length === 0) return null;
        var host = wrapper;
        for (var depth = 0; depth <= 16; depth++) {
            var cs = window.getComputedStyle(host);
            var isRowFlex = (cs.display.indexOf('flex') !== -1 && (cs.flexDirection === 'row' || cs.flexDirection === '')) ||
                            cs.display.indexOf('grid') !== -1;
            var visibleCols = [];
            for (var c = 0; c < host.children.length; c++) {
                var ch = host.children[c];
                if (ch.matches('[role="alert"], [role="status"], [data-testid*="toast"], [data-animate-toast]')) continue;
                var chCs = window.getComputedStyle(ch);
                if (chCs.display === 'none' || chCs.visibility === 'hidden' || chCs.position === 'fixed') continue;
                var chR = ch.getBoundingClientRect();
                var hasContent = ch.children.length > 0 || (ch.textContent || '').trim().length > 0 || (chR.width >= 120 && chR.height >= 180);
                if (!hasContent) continue;
                visibleCols.push(ch);
            }
            if (visibleCols.length >= 3) {
                var firstR = visibleCols[0].getBoundingClientRect();
                if (firstR.width <= 84 &&
                    !visibleCols[0].querySelector('header, h1, h2, input, [role="textbox"], [role="listitem"], [role="row"], button, [role="button"]')) {
                    visibleCols.shift();
                }
            }
            if (visibleCols.length >= 2) {
                var r0 = visibleCols[0].getBoundingClientRect();
                var r1 = visibleCols[1].getBoundingClientRect();
                var tallEnough = (r0.height >= 180 && r1.height >= 180) || (r0.height === 0 && r1.height === 0 && isRowFlex);
                var sideBySide = tallEnough && (
                    (isRowFlex && (r0.width === 0 || (r0.width >= 30 && r1.width >= 30 && Math.abs(r0.top - r1.top) < 120))) ||
                    (r0.width >= 30 && r1.width >= 30 && r1.left >= r0.left + 20 && Math.abs(r0.top - r1.top) < 120)
                );
                if (sideBySide) {
                    return {
                        wrapper: wrapper,
                        innerHost: host,
                        leftCol: visibleCols[0],
                        rightCol: visibleCols[1]
                    };
                }
            }
            if (visibleCols.length === 1) {
                host = visibleCols[0];
            } else {
                break;
            }
        }
        return null;
    }

    function applyTabShellLayout(outerChild, targetNode, splitInfo, navRailRightPx, tabSidebarW) {
        if (!splitInfo || !splitInfo.leftCol || !splitInfo.rightCol) return;

        var curr = splitInfo.innerHost;
        while (curr && curr !== outerChild.parentElement) {
            curr.removeAttribute('data-wa-left-drawer');
            curr.removeAttribute('data-wa-right-column');
            curr.removeAttribute('data-wa-aux-empty');
            curr.removeAttribute('data-wa-side-column');
            curr.removeAttribute('data-wa-tab-spacer');
            clearAuxInlineStyles(curr);
            curr.setAttribute('data-wa-tab-shell', 'true');
            curr.style.setProperty('padding-left', '0px', 'important');
            curr.style.setProperty('padding-inline-start', '0px', 'important');
            curr.style.setProperty('margin-left', '0px', 'important');
            curr.style.setProperty('margin-inline-start', '0px', 'important');

            var cCs = window.getComputedStyle(curr);
            var isAbs = (cCs.position === 'absolute' || cCs.position === 'fixed');
            if (isAbs) {
                var currLeftPx = 0;
                if (curr === outerChild || curr === targetNode) {
                    if (cCs.position === 'fixed') {
                        currLeftPx = navRailRightPx;
                    } else {
                        var op = curr.offsetParent;
                        var opLeft = (op && op !== document.body && op !== document.documentElement)
                            ? Math.round(op.getBoundingClientRect().left)
                            : 0;
                        currLeftPx = Math.max(0, navRailRightPx - opLeft);
                    }
                    var nativeZ = parseInt(cCs.zIndex, 10);
                    if (isNaN(nativeZ) || nativeZ < 200) {
                        curr.style.setProperty('z-index', '200', 'important');
                    } else if (nativeZ >= 500) {
                        curr.style.setProperty('z-index', '400', 'important');
                    }
                }
                curr.style.setProperty('left', currLeftPx + 'px', 'important');
                curr.style.setProperty('inset-inline-start', currLeftPx + 'px', 'important');
                curr.style.setProperty('right', '0px', 'important');
                curr.style.setProperty('inset-inline-end', '0px', 'important');
                curr.style.setProperty('top', '0px', 'important');
                curr.style.setProperty('bottom', '0px', 'important');
                curr.style.setProperty('width', 'auto', 'important');
                curr.style.setProperty('min-width', '0px', 'important');
                curr.style.setProperty('max-width', 'none', 'important');
            } else if (curr === outerChild) {
                curr.style.setProperty('flex', '1 1 0%', 'important');
                curr.style.setProperty('flex-grow', '1', 'important');
                curr.style.setProperty('flex-shrink', '1', 'important');
                curr.style.setProperty('width', 'auto', 'important');
                curr.style.setProperty('min-width', '0px', 'important');
                curr.style.setProperty('max-width', 'none', 'important');
            } else {
                curr.style.setProperty('flex', '1 1 0%', 'important');
                curr.style.setProperty('width', '100%', 'important');
                curr.style.setProperty('min-width', '0px', 'important');
                curr.style.setProperty('max-width', 'none', 'important');
            }
            if (curr === splitInfo.innerHost) {
                curr.style.setProperty('display', 'flex', 'important');
                curr.style.setProperty('flex-direction', 'row', 'important');
                curr.style.setProperty('justify-content', 'flex-start', 'important');
                curr.style.setProperty('gap', '0px', 'important');
                curr.style.setProperty('column-gap', '0px', 'important');
            }
            if (curr === outerChild) break;
            curr = curr.parentElement;
        }

        // Si outerChild tiene un contenedor padre de absOverlay que quedo con width: 0px, limpiarlo y darle tab-shell
        if (outerChild && !outerChild.hasAttribute('data-wa-tab-shell')) {
            outerChild.removeAttribute('data-wa-left-drawer');
            outerChild.removeAttribute('data-wa-right-column');
            outerChild.removeAttribute('data-wa-aux-empty');
            clearAuxInlineStyles(outerChild);
            outerChild.setAttribute('data-wa-tab-shell', 'true');
            outerChild.style.setProperty('padding-left', '0px', 'important');
            outerChild.style.setProperty('padding-inline-start', '0px', 'important');
            outerChild.style.setProperty('margin-left', '0px', 'important');
            outerChild.style.setProperty('margin-inline-start', '0px', 'important');
            var ocCs = window.getComputedStyle(outerChild);
            if (ocCs.position === 'absolute' || ocCs.position === 'fixed') {
                var ocLeftPx = navRailRightPx;
                if (ocCs.position === 'absolute') {
                    var ocOp = outerChild.offsetParent;
                    var ocOpLeft = (ocOp && ocOp !== document.body && ocOp !== document.documentElement)
                        ? Math.round(ocOp.getBoundingClientRect().left)
                        : 0;
                    ocLeftPx = Math.max(0, navRailRightPx - ocOpLeft);
                }
                outerChild.style.setProperty('left', ocLeftPx + 'px', 'important');
                outerChild.style.setProperty('inset-inline-start', ocLeftPx + 'px', 'important');
                outerChild.style.setProperty('right', '0px', 'important');
                outerChild.style.setProperty('inset-inline-end', '0px', 'important');
                outerChild.style.setProperty('top', '0px', 'important');
                outerChild.style.setProperty('bottom', '0px', 'important');
                outerChild.style.setProperty('width', 'auto', 'important');
                outerChild.style.setProperty('min-width', '0px', 'important');
                outerChild.style.setProperty('max-width', 'none', 'important');
                var ocNativeZ = parseInt(ocCs.zIndex, 10);
                if (isNaN(ocNativeZ) || ocNativeZ < 200) {
                    outerChild.style.setProperty('z-index', '200', 'important');
                } else if (ocNativeZ >= 500) {
                    outerChild.style.setProperty('z-index', '400', 'important');
                }
            } else {
                outerChild.style.setProperty('flex', '1 1 0%', 'important');
                outerChild.style.setProperty('width', 'auto', 'important');
                outerChild.style.setProperty('min-width', '0px', 'important');
                outerChild.style.setProperty('max-width', 'none', 'important');
            }
        }

        // Colapsar cualquier espaciador de 64px previo a leftCol dentro de innerHost (y cadena hasta outerChild)
        var walkNode = splitInfo.leftCol;
        while (walkNode && walkNode !== outerChild && walkNode.parentElement) {
            var wParent = walkNode.parentElement;
            for (var sp = 0; sp < wParent.children.length; sp++) {
                var sib = wParent.children[sp];
                if (sib === walkNode) break;
                if (sib === splitInfo.rightCol) continue;
                if (sib.matches('[role="alert"], [role="status"], [data-testid*="toast"], [data-animate-toast]')) continue;
                var sibHasRealUi = !!sib.querySelector('header, h1, h2, input, [role="textbox"], [role="listitem"], [role="row"], button, [role="button"]');
                if (!sibHasRealUi) {
                    sib.setAttribute('data-wa-tab-spacer', 'true');
                }
            }
            walkNode = wParent;
        }

        var leftCol = splitInfo.leftCol;
        leftCol.removeAttribute('data-wa-left-drawer');
        leftCol.removeAttribute('data-wa-main-column');
        leftCol.removeAttribute('data-wa-aux-empty');
        leftCol.removeAttribute('data-wa-tab-shell');
        leftCol.removeAttribute('data-wa-tab-spacer');
        clearAuxInlineStyles(leftCol);
        leftCol.setAttribute('data-wa-tab-side-column', 'true');
        if (!isCompactActive()) {
            leftCol.setAttribute('data-wa-side-column', 'true');
        } else {
            leftCol.removeAttribute('data-wa-side-column');
        }
        leftCol.style.setProperty('flex', '0 0 ' + tabSidebarW + 'px', 'important');
        leftCol.style.setProperty('flex-basis', tabSidebarW + 'px', 'important');
        leftCol.style.setProperty('flex-grow', '0', 'important');
        leftCol.style.setProperty('flex-shrink', '0', 'important');
        leftCol.style.setProperty('width', tabSidebarW + 'px', 'important');
        leftCol.style.setProperty('min-width', tabSidebarW + 'px', 'important');
        leftCol.style.setProperty('max-width', tabSidebarW + 'px', 'important');
        leftCol.style.setProperty('margin-left', '0px', 'important');
        leftCol.style.setProperty('margin-inline-start', '0px', 'important');
        leftCol.style.setProperty('left', '0px', 'important');
        leftCol.style.setProperty('inset-inline-start', '0px', 'important');
        leftCol.style.setProperty('transform', 'none', 'important');
        leftCol.style.setProperty('border-right', '1px solid var(--border-list, rgba(134, 150, 160, 0.22))', 'important');
        leftCol.style.setProperty('overflow', 'hidden', 'important');
        leftCol.style.setProperty('box-sizing', 'border-box', 'important');

        var rightCol = splitInfo.rightCol;
        rightCol.removeAttribute('data-wa-tab-shell');
        rightCol.removeAttribute('data-wa-tab-side-column');
        rightCol.removeAttribute('data-wa-tab-spacer');
        applyMainColumnFlexStyles(rightCol);

        // Compensacion de seguridad pixel-exacta: si aun queda un desplazamiento interno
        // entre outerChild y leftCol, ajustar left del host absoluto para arrancar a 0px del rail
        if (navRailRightPx > 0 && outerChild) {
            var leftAfter = Math.round(leftCol.getBoundingClientRect().left);
            var extraShift = leftAfter - navRailRightPx;
            if (extraShift > 1 && extraShift <= 160) {
                var hostTarget = (targetNode && (window.getComputedStyle(targetNode).position === 'absolute' || window.getComputedStyle(targetNode).position === 'fixed'))
                    ? targetNode
                    : outerChild;
                var hCs = window.getComputedStyle(hostTarget);
                if (hCs.position === 'absolute' || hCs.position === 'fixed') {
                    var curLeftVal = parseFloat(hCs.left) || 0;
                    var fixedLeft = Math.round(curLeftVal - extraShift);
                    hostTarget.style.setProperty('left', fixedLeft + 'px', 'important');
                    hostTarget.style.setProperty('inset-inline-start', fixedLeft + 'px', 'important');
                }
            }
        }
    }

    window.__waInspectLayout = function() {
        var containers = resolveLayoutContainers();
        var fc = (containers && containers.flexContainer) || cachedFlexContainer || document.querySelector('[data-wa-flex-container="true"]');
        var side = document.getElementById('side');
        var mainEl = document.getElementById('main');
        var childrenReport = [];
        if (fc) {
            for (var i = 0; i < fc.children.length; i++) {
                var ch = fc.children[i];
                var r = ch.getBoundingClientRect();
                var cs = window.getComputedStyle(ch);
                var split = splitMultiColumnWrapper(ch);
                childrenReport.push({
                    index: i,
                    tag: ch.tagName ? ch.tagName.toLowerCase() : '',
                    rect: {
                        left: Math.round(r.left),
                        top: Math.round(r.top),
                        width: Math.round(r.width),
                        height: Math.round(r.height)
                    },
                    position: cs.position,
                    display: cs.display,
                    flexDirection: cs.flexDirection,
                    containsSide: !!(side && ch.contains(side)),
                    containsMain: !!(mainEl && ch.contains(mainEl)),
                    attrs: {
                        navRail: ch.getAttribute('data-wa-nav-rail') || '',
                        sideCol: ch.getAttribute('data-wa-side-column') || '',
                        tabShell: ch.getAttribute('data-wa-tab-shell') || '',
                        tabSideCol: ch.getAttribute('data-wa-tab-side-column') || '',
                        leftDrawer: ch.getAttribute('data-wa-left-drawer') || '',
                        mainCol: ch.getAttribute('data-wa-main-column') || '',
                        rightCol: ch.getAttribute('data-wa-right-column') || '',
                        auxEmpty: ch.getAttribute('data-wa-aux-empty') || ''
                    },
                    hasMultiColSplit: !!split
                });
            }
        }
        return {
            sideMounted: !!side,
            mainMounted: !!mainEl,
            compact: isCompactActive(),
            sidebarWidthVar: document.documentElement.style.getPropertyValue('--wa-sidebar-width'),
            tabSidebarWidthVar: document.documentElement.style.getPropertyValue('--wa-tab-sidebar-width'),
            flexChildren: childrenReport
        };
    };

    function applyMainColumnFlexStyles(el) {
        if (!el) return;
        el.removeAttribute('data-wa-side-column');
        el.removeAttribute('data-wa-left-drawer');
        el.removeAttribute('data-wa-right-column');
        el.removeAttribute('data-wa-aux-empty');
        clearAuxInlineStyles(el);
        el.setAttribute('data-wa-main-column', 'true');
        el.style.setProperty('flex', '1 1 0%', 'important');
        el.style.setProperty('flex-grow', '1', 'important');
        el.style.setProperty('flex-shrink', '1', 'important');
        el.style.setProperty('min-width', '0', 'important');
        el.style.setProperty('width', 'auto', 'important');
        el.style.setProperty('max-width', 'none', 'important');
    }

    function applyWrapperPassThroughStyles(el) {
        if (!el) return;
        el.removeAttribute('data-wa-side-column');
        el.removeAttribute('data-wa-left-drawer');
        el.removeAttribute('data-wa-right-column');
        el.removeAttribute('data-wa-aux-empty');
        clearAuxInlineStyles(el);
        el.setAttribute('data-wa-main-column', 'true');
        el.style.setProperty('flex', '1 1 0%', 'important');
        el.style.setProperty('flex-grow', '1', 'important');
        el.style.setProperty('flex-shrink', '1', 'important');
        el.style.setProperty('min-width', '0', 'important');
        el.style.setProperty('width', 'auto', 'important');
        el.style.setProperty('max-width', 'none', 'important');
        el.style.setProperty('display', 'flex', 'important');
        el.style.setProperty('flex-direction', 'row', 'important');
    }

    function resolveLayoutContainers() {
        var side = document.querySelector('#side');
        var mainEl = document.querySelector('#main');

        if (!side) {
            if (cachedFlexContainer && cachedFlexContainer.isConnected) {
                resetHorizontalScrollLock(cachedFlexContainer);
                var navRail = cachedFlexContainer.querySelector(':scope > [data-wa-nav-rail="true"], :scope > header');
                var fallbackSideCol = null;
                var fallbackMainCol = null;

                // Auditar los hijos visibles de cachedFlexContainer despues del rail de navegacion
                var flexChildren = cachedFlexContainer.children;
                var contentSiblings = [];
                for (var fc = 0; fc < flexChildren.length; fc++) {
                    var fChild = flexChildren[fc];
                    if (fChild === navRail || fChild.tagName === 'HEADER' || fChild.getAttribute('data-wa-nav-rail') === 'true') continue;
                    var fRect = fChild.getBoundingClientRect();
                    if (fRect.width > 0 && fRect.width <= 96 && !fChild.querySelector('section, [role="region"], [role="heading"], h1, h2, input, [role="textbox"], [role="row"], [role="listitem"]')) {
                        continue;
                    }
                    if (!fChild.querySelector('header, section, [data-animate-drawer-left="true"], [data-animate-drawer-right="true"]') &&
                        (fChild.matches('[role="alert"], [role="status"], [data-testid*="toast"], [data-animate-toast]') ||
                         fChild.querySelector('[role="alert"], [role="status"], [data-testid*="toast"], [data-animate-toast]') !== null)) {
                        continue;
                    }
                    var hasChildContent = fChild.children.length > 0 &&
                        (fChild.querySelector('header, section, [role="region"], [role="heading"], [data-animate-drawer-left="true"], [data-animate-drawer-right="true"], button, [role="button"], svg') !== null ||
                         (fChild.innerText || '').trim().length > 0);
                    if (!hasChildContent) continue;
                    contentSiblings.push(fChild);
                }

                if (contentSiblings.length >= 1) {
                    var firstCand = contentSiblings[0];
                    // Caso Layout A: firstCand es un wrapper unico que contiene adentro 2+ columnas (lista izquierda + panel central/derecho)
                    var splitInfo = splitMultiColumnWrapper(firstCand);
                    if (splitInfo) {
                        applyWrapperPassThroughStyles(splitInfo.wrapper);
                        splitInfo.wrapper.setAttribute('data-wa-tab-shell', 'true');
                        if (splitInfo.innerHost !== splitInfo.wrapper) {
                            applyWrapperPassThroughStyles(splitInfo.innerHost);
                            splitInfo.innerHost.setAttribute('data-wa-tab-shell', 'true');
                        }
                        fallbackSideCol = splitInfo.leftCol;
                        fallbackSideCol.removeAttribute('data-wa-main-column');
                        fallbackSideCol.removeAttribute('data-wa-aux-empty');
                        fallbackSideCol.setAttribute('data-wa-tab-side-column', 'true');
                        if (!isCompactActive()) {
                            fallbackSideCol.setAttribute('data-wa-side-column', 'true');
                        } else {
                            fallbackSideCol.removeAttribute('data-wa-side-column');
                        }

                        fallbackMainCol = splitInfo.rightCol;
                        applyMainColumnFlexStyles(fallbackMainCol);
                    } else {
                        // Caso Layout B: firstCand es exclusivamente la columna lateral izquierda
                        fallbackSideCol = firstCand;
                        if (fallbackSideCol.hasAttribute('data-wa-main-column')) {
                            fallbackSideCol.removeAttribute('data-wa-main-column');
                        }
                        fallbackSideCol.setAttribute('data-wa-tab-side-column', 'true');
                        if (!isCompactActive()) {
                            fallbackSideCol.setAttribute('data-wa-side-column', 'true');
                        } else {
                            fallbackSideCol.removeAttribute('data-wa-side-column');
                        }

                        // Buscar el siguiente hermano que sea el panel central/derecho (no un sub-drawer izquierdo ni drawer derecho)
                        for (var csIdx = 1; csIdx < contentSiblings.length; csIdx++) {
                            var candMain = contentSiblings[csIdx];
                            var isExplicitLeftDrawer = candMain.querySelector('[data-animate-drawer-left="true"]') !== null &&
                                                       candMain.querySelector('[data-animate-drawer-right="true"]') === null &&
                                                       candMain.children.length === 1;
                            if (!isExplicitLeftDrawer) {
                                fallbackMainCol = candMain;
                                applyMainColumnFlexStyles(fallbackMainCol);
                                break;
                            }
                        }
                    }
                }

                if (fallbackSideCol) {
                    cachedSideColumn = fallbackSideCol;
                }
                if (fallbackMainCol) {
                    cachedMainColumn = fallbackMainCol;
                }
                return {
                    side: fallbackSideCol,
                    sideColumn: fallbackSideCol,
                    mainColumn: fallbackMainCol,
                    flexContainer: cachedFlexContainer
                };
            }
            return null;
        }

        // Si #side volvio a montarse, limpiar atributos residuales de wrappers de otras pestanas
        // sin tocar las columnas activas de un Tab Shell
        if (cachedFlexContainer && cachedFlexContainer.isConnected) {
            var oldSideCols = cachedFlexContainer.querySelectorAll('[data-wa-side-column="true"]');
            for (var os = 0; os < oldSideCols.length; os++) {
                if (oldSideCols[os] !== side && !oldSideCols[os].contains(side)) {
                    if (oldSideCols[os].hasAttribute('data-wa-tab-side-column') ||
                        oldSideCols[os].closest('[data-wa-tab-shell="true"]')) {
                        continue;
                    }
                    oldSideCols[os].removeAttribute('data-wa-side-column');
                    clearAuxInlineStyles(oldSideCols[os]);
                }
            }
            var oldMainCols = cachedFlexContainer.querySelectorAll('[data-wa-main-column="true"]');
            for (var om = 0; om < oldMainCols.length; om++) {
                if (!mainEl || (oldMainCols[om] !== mainEl && !oldMainCols[om].contains(mainEl))) {
                    if (oldMainCols[om].closest('[data-wa-tab-shell="true"]')) {
                        continue;
                    }
                    if (!mainEl && oldMainCols[om] === cachedMainColumn) {
                        continue;
                    }
                    oldMainCols[om].removeAttribute('data-wa-main-column');
                    clearAuxInlineStyles(oldMainCols[om]);
                }
            }
        }

        var isCacheValid = cachedSideColumn && cachedSideColumn.isConnected &&
                           cachedFlexContainer && cachedFlexContainer.isConnected &&
                           cachedSideColumn.parentElement === cachedFlexContainer &&
                           (!mainEl || (cachedMainColumn && cachedMainColumn.isConnected && cachedMainColumn.contains(mainEl)));

        if (isCacheValid) {
            resetHorizontalScrollLock(cachedFlexContainer);
            return {
                side: side,
                sideColumn: cachedSideColumn,
                mainColumn: cachedMainColumn,
                flexContainer: cachedFlexContainer
            };
        }

        var sideCol = side;
        var mainCol = null;
        var container = null;

        var curr = side;
        while (curr && curr !== document.body && curr !== document.documentElement) {
            var p = curr.parentElement;
            if (!p) break;

            var isMainWrapper = p.classList.contains('two') || 
                                p.classList.contains('three') || 
                                p.classList.contains('app-wrapper-web') ||
                                p.id === 'app' ||
                                (p.parentElement && p.parentElement.id === 'app');

            var pStyle = window.getComputedStyle(p);
            var isFlexRow = pStyle.display.indexOf('flex') !== -1 && 
                            (pStyle.flexDirection === 'row' || pStyle.flexDirection === '');
            var isGrid = pStyle.display.indexOf('grid') !== -1;

            if (isFlexRow || isGrid || isMainWrapper) {
                var mainEl = document.querySelector('#main');
                if (mainEl && p.contains(mainEl) && curr !== mainEl) {
                    container = p;
                    sideCol = curr;

                    var m = mainEl;
                    while (m && m.parentElement !== container) {
                        m = m.parentElement;
                    }
                    mainCol = m;
                    break;
                } else if (!mainEl && curr.nextElementSibling) {
                    container = p;
                    sideCol = curr;
                    mainCol = curr.nextElementSibling;
                    break;
                }
            }
            curr = p;
        }

        if (sideCol) {
            cachedSideColumn = sideCol;
            sideCol.setAttribute('data-wa-side-column', 'true');
        }
        if (mainCol) {
            cachedMainColumn = mainCol;
            mainCol.setAttribute('data-wa-main-column', 'true');
        }
        if (container) {
            cachedFlexContainer = container;
            container.setAttribute('data-wa-flex-container', 'true');
            resetHorizontalScrollLock(container);
        }

        return {
            side: side,
            sideColumn: sideCol,
            mainColumn: mainCol,
            flexContainer: container
        };
    }

    function getMaxRightWidth() {
        var sideWidth = 70;
        if (!isCompactActive()) {
            var containers = resolveLayoutContainers();
            var sideCol = (containers && containers.sideColumn) ? containers.sideColumn : document.querySelector('#side');
            var rectW = sideCol ? Math.round(sideCol.getBoundingClientRect().width) : 0;
            sideWidth = rectW > 0 ? rectW : getSavedWidth();
        }
        return Math.max(MIN_RIGHT_WIDTH, Math.min(Math.floor(window.innerWidth * 0.5), window.innerWidth - sideWidth - 260));
    }

    function getSavedRightWidth() {
        var saved = localStorage.getItem(STORAGE_KEY_RIGHT_WIDTH);
        var parsed = parseInt(saved, 10);
        var base = (isNaN(parsed) || parsed < MIN_RIGHT_WIDTH) ? DEFAULT_RIGHT_WIDTH : parsed;
        var maxRight = getMaxRightWidth();
        return Math.max(MIN_RIGHT_WIDTH, Math.min(base, maxRight));
    }

    function applyRightColumnInlineWidth(rightCol, widthPx) {
        if (!rightCol) return;
        rightCol.style.setProperty('flex', '0 0 ' + widthPx + 'px', 'important');
        rightCol.style.setProperty('flex-basis', widthPx + 'px', 'important');
        rightCol.style.setProperty('flex-grow', '0', 'important');
        rightCol.style.setProperty('flex-shrink', '0', 'important');
        rightCol.style.setProperty('width', widthPx + 'px', 'important');
        rightCol.style.setProperty('min-width', widthPx + 'px', 'important');
        rightCol.style.setProperty('max-width', widthPx + 'px', 'important');
        rightCol.style.setProperty('overflow-x', 'hidden', 'important');
        rightCol.style.setProperty('border-left', '1px solid rgba(134, 150, 160, 0.22)', 'important');
    }

    function setRightPanelWidth(width, persist) {
        var maxRight = getMaxRightWidth();
        var numericWidth = (typeof width === 'number' && !isNaN(width)) ? width : DEFAULT_RIGHT_WIDTH;
        var clamped = Math.max(MIN_RIGHT_WIDTH, Math.min(Math.round(numericWidth), maxRight));

        document.documentElement.style.setProperty('--wa-right-panel-width', clamped + 'px');

        var rightCol = document.querySelector('[data-wa-right-column="true"]');
        if (rightCol) {
            applyRightColumnInlineWidth(rightCol, clamped);
        }

        if (persist) {
            localStorage.setItem(STORAGE_KEY_RIGHT_WIDTH, clamped.toString());
        }

        updateRightResizerPosition();
        scheduleMainScaleUpdate();
    }

    function clearAuxInlineStyles(el) {
        if (!el) return;
        el.style.removeProperty('position');
        el.style.removeProperty('left');
        el.style.removeProperty('inset-inline-start');
        el.style.removeProperty('right');
        el.style.removeProperty('inset-inline-end');
        el.style.removeProperty('top');
        el.style.removeProperty('bottom');
        el.style.removeProperty('z-index');
        el.style.removeProperty('display');
        el.style.removeProperty('flex-direction');
        el.style.removeProperty('justify-content');
        el.style.removeProperty('gap');
        el.style.removeProperty('column-gap');
        el.style.removeProperty('flex');
        el.style.removeProperty('flex-basis');
        el.style.removeProperty('flex-grow');
        el.style.removeProperty('flex-shrink');
        el.style.removeProperty('width');
        el.style.removeProperty('min-width');
        el.style.removeProperty('max-width');
        el.style.removeProperty('padding-left');
        el.style.removeProperty('padding-inline-start');
        el.style.removeProperty('margin-left');
        el.style.removeProperty('margin-inline-start');
        el.style.removeProperty('transform');
        el.style.removeProperty('overflow');
        el.style.removeProperty('overflow-x');
        el.style.removeProperty('border');
        el.style.removeProperty('border-left');
        el.style.removeProperty('border-right');
        el.style.removeProperty('background-color');
        el.style.removeProperty('pointer-events');
    }

    function syncAuxDrawers(container, sideCol, mainCol) {
        if (!container) return;
        resetHorizontalScrollLock(container);
        var side = document.querySelector('#side');
        var mainEl = document.querySelector('#main');
        var navRailEl = container.querySelector(':scope > [data-wa-nav-rail="true"]') || container.querySelector(':scope > header');
        if (navRailEl && !navRailEl.hasAttribute('data-wa-nav-rail')) {
            navRailEl.setAttribute('data-wa-nav-rail', 'true');
        }
        var navRailRect = navRailEl ? navRailEl.getBoundingClientRect() : null;
        var sideRect = sideCol ? sideCol.getBoundingClientRect() : null;
        var effectiveSavedW = (currentSidebarWidth && currentSidebarWidth >= MIN_WIDTH) ? currentSidebarWidth : getSavedWidth();
        var targetSideW = isCompactActive()
            ? effectiveSavedW
            : (effectiveSavedW || Math.round((sideRect && sideRect.width > 0 ? sideRect.width : getSavedWidth())));
        document.documentElement.style.setProperty('--wa-tab-sidebar-width', targetSideW + 'px');
        var hasRightCol = false;
        var activeLeftFlowOwner = (sideCol && sideCol.getBoundingClientRect().width > 0) ? sideCol : null;
        var children = container.children;

        function clearStaleInnerDrawers(el) {
            var stale = el.querySelectorAll('[data-wa-left-drawer="true"], [data-wa-tab-shell="true"], [data-wa-tab-side-column="true"], [data-wa-tab-spacer="true"]');
            for (var k = 0; k < stale.length; k++) {
                stale[k].removeAttribute('data-wa-left-drawer');
                stale[k].removeAttribute('data-wa-tab-shell');
                stale[k].removeAttribute('data-wa-tab-side-column');
                stale[k].removeAttribute('data-wa-tab-spacer');
                clearAuxInlineStyles(stale[k]);
            }
        }

        for (var i = 0; i < children.length; i++) {
            var child = children[i];
            if (child === sideCol || child === mainCol ||
                (side && child.contains(side)) || (mainEl && child.contains(mainEl)) ||
                (sideCol && child.contains(sideCol)) || (mainCol && child.contains(mainCol))) {
                continue;
            }

            var isStandaloneToast = child.tagName !== 'HEADER' && !child.hasAttribute('data-wa-nav-rail') &&
                                    !child.querySelector('header, section, [data-animate-drawer-left="true"], [data-animate-drawer-right="true"]') &&
                                    (child.matches('[role="alert"], [role="status"], [data-testid*="toast"], [data-animate-toast]') ||
                                     child.querySelector('[role="alert"], [role="status"], [data-testid*="toast"], [data-animate-toast]') !== null);
            if (isStandaloneToast) {
                if (child.hasAttribute('data-wa-left-drawer') || child.hasAttribute('data-wa-right-column') || child.hasAttribute('data-wa-aux-empty') || child.hasAttribute('data-wa-tab-shell')) {
                    clearAuxInlineStyles(child);
                }
                child.removeAttribute('data-wa-left-drawer');
                child.removeAttribute('data-wa-right-column');
                child.removeAttribute('data-wa-aux-empty');
                child.removeAttribute('data-wa-tab-shell');
                clearStaleInnerDrawers(child);
                continue;
            }

            var hasRealContent = child.children.length > 0 &&
                                 (child.querySelector('header, section, [role="region"], [role="heading"], [data-animate-drawer-left="true"], [data-animate-drawer-right="true"], button, [role="button"], svg') !== null ||
                                  (child.innerText || '').trim().length > 0);
            var isAfterMain = mainCol ? !!(mainCol.compareDocumentPosition(child) & Node.DOCUMENT_POSITION_FOLLOWING) : false;
            var hasExplicitLeftDrawer = child.querySelector('[data-animate-drawer-left="true"]') !== null &&
                                        child.querySelector('[data-animate-drawer-right="true"]') === null;
            if (hasExplicitLeftDrawer || child.hasAttribute('data-wa-tab-shell')) {
                isAfterMain = false;
            } else if (isAfterMain && mainCol) {
                var cR = child.getBoundingClientRect();
                var mR = mainCol.getBoundingClientRect();
                if (cR.width > 0 && mR.width > 0 && cR.left < mR.left + 20) {
                    isAfterMain = false;
                } else if (mR.width === 0 && !child.querySelector('[data-animate-drawer-right="true"]')) {
                    if (splitMultiColumnWrapper(child) || (child.firstElementChild && splitMultiColumnWrapper(child.firstElementChild))) {
                        isAfterMain = false;
                    }
                }
            }

            if (!hasRealContent && child.getAttribute('data-wa-right-column') === 'true' && isRightDragging) {
                hasRightCol = true;
                continue;
            }

            if (!hasRealContent) {
                var isSidebarAnim = !!(document.body && document.body.classList.contains('wa-sidebar-animating'));
                child.removeAttribute('data-wa-left-drawer');
                child.removeAttribute('data-wa-right-column');
                child.removeAttribute('data-wa-main-column');
                child.removeAttribute('data-wa-tab-shell');
                child.removeAttribute('data-wa-drawer-middle-active');
                clearStaleInnerDrawers(child);
                clearAuxInlineStyles(child);

                // Limpiar atributos/estilos residuales de Tab Shell en hijos cuando vuelve a quedar vacio en Chats
                var staleTabCols = child.querySelectorAll('[data-wa-side-column="true"], [data-wa-main-column="true"]');
                for (var stc = 0; stc < staleTabCols.length; stc++) {
                    staleTabCols[stc].removeAttribute('data-wa-side-column');
                    staleTabCols[stc].removeAttribute('data-wa-main-column');
                    clearAuxInlineStyles(staleTabCols[stc]);
                }

                // Preservar el contenedor nativo de WhatsApp (CH[2]) en su geometria nativa (left: 0; width: 100%; z-index: auto):
                // sus dos hijos directos dibujan los bordes verticales nativos izquierdo (junto al rail) y derecho (junto a #main)
                var hasNativeRailSeam = false;
                if (!isAfterMain && child.children.length > 0) {
                    var chPosEmpty = window.getComputedStyle(child).position;
                    if (chPosEmpty === 'absolute' || chPosEmpty === 'fixed') {
                        var seamScan = child.firstElementChild;
                        for (var sDepth = 0; sDepth < 3 && seamScan; sDepth++) {
                            var sScanCs = window.getComputedStyle(seamScan);
                            if ((parseFloat(sScanCs.borderLeftWidth) >= 0.5 && sScanCs.borderLeftStyle !== 'none') ||
                                (parseFloat(sScanCs.borderRightWidth) >= 0.5 && sScanCs.borderRightStyle !== 'none')) {
                                hasNativeRailSeam = true;
                                break;
                            }
                            seamScan = seamScan.firstElementChild;
                        }
                    }
                }
                if (hasNativeRailSeam) {
                    child.removeAttribute('data-wa-aux-empty');
                    child.setAttribute('data-wa-rail-seam-host', 'true');
                    if (!isSidebarAnim) {
                        for (var scIdx = 0; scIdx < child.children.length; scIdx++) {
                            clearAuxInlineStyles(child.children[scIdx]);
                        }
                    }
                    continue;
                }

                child.removeAttribute('data-wa-rail-seam-host');
                child.setAttribute('data-wa-aux-empty', 'true');
                child.style.setProperty('flex', '0 0 0px', 'important');
                child.style.setProperty('flex-grow', '0', 'important');
                child.style.setProperty('flex-shrink', '0', 'important');
                child.style.setProperty('width', '0px', 'important');
                child.style.setProperty('min-width', '0px', 'important');
                child.style.setProperty('max-width', '0px', 'important');
                child.style.setProperty('border', 'none', 'important');
                child.style.setProperty('overflow', 'hidden', 'important');
            } else if (!isAfterMain) {
                var middleDrawerEl = child.querySelector(':scope > [data-testid="drawer-middle"]');
                if (middleDrawerEl && child.children.length >= 2) {
                    var leftSlot = child.children[0];
                    var leftSlotHasUi = !!(leftSlot && leftSlot !== middleDrawerEl && (
                        leftSlot.querySelector('header, section, [role="region"], [role="heading"], h1, h2, input, [role="textbox"], [role="row"], [role="listitem"], [data-animate-drawer-left="true"], button, [role="button"], svg') !== null ||
                        (leftSlot.innerText || '').trim().length > 0
                    ));
                    var middleHasUi = !!(
                        middleDrawerEl.querySelector('header, section, [role="region"], [role="heading"], button, [role="button"], input, [role="textbox"], canvas, img, video, svg') !== null ||
                        (middleDrawerEl.innerText || '').trim().length > 0
                    );
                    if (!leftSlotHasUi && middleHasUi) {
                        var isSidebarAnimMid = !!(document.body && document.body.classList.contains('wa-sidebar-animating'));
                        child.removeAttribute('data-wa-left-drawer');
                        child.removeAttribute('data-wa-right-column');
                        child.removeAttribute('data-wa-main-column');
                        child.removeAttribute('data-wa-tab-shell');
                        child.removeAttribute('data-wa-aux-empty');
                        clearStaleInnerDrawers(child);
                        clearAuxInlineStyles(child);

                        var staleMidCols = child.querySelectorAll('[data-wa-side-column="true"], [data-wa-main-column="true"]');
                        for (var smc = 0; smc < staleMidCols.length; smc++) {
                            staleMidCols[smc].removeAttribute('data-wa-side-column');
                            staleMidCols[smc].removeAttribute('data-wa-main-column');
                            clearAuxInlineStyles(staleMidCols[smc]);
                        }
                        if (!isSidebarAnimMid) {
                            for (var mcIdx = 0; mcIdx < child.children.length; mcIdx++) {
                                clearAuxInlineStyles(child.children[mcIdx]);
                            }
                        }
                        child.setAttribute('data-wa-rail-seam-host', 'true');
                        child.setAttribute('data-wa-drawer-middle-active', 'true');
                        continue;
                    }
                }
                if (child.hasAttribute('data-wa-drawer-middle-active')) {
                    child.removeAttribute('data-wa-drawer-middle-active');
                }
                if (child.hasAttribute('data-wa-aux-empty') || child.hasAttribute('data-wa-rail-seam-host')) {
                    if (child.hasAttribute('data-wa-rail-seam-host') && child.firstElementChild) {
                        clearAuxInlineStyles(child.firstElementChild);
                    }
                    clearAuxInlineStyles(child);
                    child.removeAttribute('data-wa-aux-empty');
                    child.removeAttribute('data-wa-rail-seam-host');
                }
                var childRect = child.getBoundingClientRect();
                var isNavRail = (child.tagName === 'HEADER') ||
                                (child.getAttribute('data-wa-nav-rail') === 'true' &&
                                 childRect.width > 0 && childRect.width <= 96 &&
                                 !child.querySelector('[data-animate-drawer-left="true"], section, [role="region"], [role="heading"], h1, h2, input, [role="textbox"], [role="row"], [role="listitem"], [role="grid"]')) ||
                                (sideCol &&
                                 !!(child.compareDocumentPosition(sideCol) & Node.DOCUMENT_POSITION_FOLLOWING) &&
                                 !child.hasAttribute('data-wa-left-drawer') &&
                                 !child.querySelector('[data-animate-drawer-left="true"], section, [role="region"], [role="heading"], h1, h2, input, [role="textbox"], [role="row"], [role="listitem"], [role="grid"]') &&
                                 childRect.width > 0 && childRect.width <= 96 &&
                                 ((sideRect && sideRect.width > 0 && childRect.right <= sideRect.left + 2) ||
                                  ((!sideRect || sideRect.width === 0) && childRect.left <= 4)));
                if (isNavRail) {
                    if (child.hasAttribute('data-wa-left-drawer') || child.hasAttribute('data-wa-right-column') || child.hasAttribute('data-wa-tab-shell')) {
                        clearAuxInlineStyles(child);
                    }
                    child.removeAttribute('data-wa-left-drawer');
                    child.removeAttribute('data-wa-right-column');
                    child.removeAttribute('data-wa-tab-shell');
                    child.setAttribute('data-wa-nav-rail', 'true');
                    navRailEl = child;
                    navRailRect = childRect;
                    clearStaleInnerDrawers(child);
                    continue;
                }
                if (child.hasAttribute('data-wa-nav-rail')) {
                    child.removeAttribute('data-wa-nav-rail');
                }

                var childPos = window.getComputedStyle(child).position;
                var absOverlay = null;
                if (childPos !== 'absolute' && childPos !== 'fixed') {
                    var innerCand = child.querySelector('[data-animate-drawer-left="true"]') || child.firstElementChild;
                    if (innerCand) {
                        var innerPos = window.getComputedStyle(innerCand).position;
                        if (innerPos === 'absolute' || innerPos === 'fixed') {
                            absOverlay = innerCand;
                        }
                    }
                }

                var navRailRightPx = (navRailRect && navRailRect.width > 0)
                    ? Math.round(navRailRect.right)
                    : ((sideRect && sideRect.width > 0) ? Math.round(sideRect.left) : 0);

                var leftAnchorPx = (sideRect && sideRect.width > 0)
                    ? Math.round(sideRect.left)
                    : navRailRightPx;

                // Detectar Tab Shell de 2 columnas (Estados, Canales, Comunidades, Configuracion, Perfil)
                // ANTES de aplicar data-wa-left-drawer (tanto si #side sigue montado en el DOM como si no!)
                var tabSplit = splitMultiColumnWrapper(absOverlay || child);
                if (!tabSplit && absOverlay) {
                    tabSplit = splitMultiColumnWrapper(child);
                }
                if (tabSplit) {
                    applyTabShellLayout(child, absOverlay || child, tabSplit, navRailRightPx, targetSideW);
                    continue;
                }

                // Si antes fue un tab-shell pero ahora es un sub-drawer de 1 sola columna, limpiar atributos de tab-shell
                if (child.hasAttribute('data-wa-tab-shell') || child.querySelector('[data-wa-tab-shell="true"], [data-wa-tab-side-column="true"]')) {
                    child.removeAttribute('data-wa-tab-shell');
                    clearStaleInnerDrawers(child);
                }

                // Si #main no esta montado y este hijo viene despues de activeLeftFlowOwner sin ser un drawer izquierdo explicito,
                // es el panel central/derecho principal de la pestana (Configuracion, Estados, Canales, Comunidades, Perfil)
                if (!mainEl && !mainCol && activeLeftFlowOwner && activeLeftFlowOwner !== child && !hasExplicitLeftDrawer) {
                    mainCol = child;
                    cachedMainColumn = child;
                    applyMainColumnFlexStyles(child);
                    continue;
                }

                if (absOverlay) {
                    clearAuxInlineStyles(child);
                    child.removeAttribute('data-wa-left-drawer');
                    child.removeAttribute('data-wa-right-column');
                    child.style.setProperty('flex', '0 0 0px', 'important');
                    child.style.setProperty('width', '0px', 'important');
                    child.style.setProperty('min-width', '0px', 'important');
                    child.style.setProperty('overflow', 'visible', 'important');
                    var absRect = absOverlay.getBoundingClientRect();
                    var absW = targetSideW;
                    if (leftAnchorPx > 0 && absRect.width > 0 && absRect.left < leftAnchorPx) {
                        absW = Math.max(targetSideW, Math.round((leftAnchorPx + targetSideW) - absRect.left));
                    }
                    absOverlay.style.setProperty('width', absW + 'px', 'important');
                    absOverlay.style.setProperty('min-width', absW + 'px', 'important');
                    absOverlay.style.setProperty('max-width', absW + 'px', 'important');
                    absOverlay.style.setProperty('overflow', 'hidden', 'important');
                    absOverlay.style.setProperty('border-right', '1px solid rgba(134, 150, 160, 0.22)', 'important');
                    absOverlay.style.setProperty('background-color', 'var(--panel-background-deep, var(--background-default, #111b21))', 'important');
                    absOverlay.setAttribute('data-wa-left-drawer', 'true');
                    continue;
                }

                child.removeAttribute('data-wa-right-column');
                child.removeAttribute('data-wa-main-column');
                child.setAttribute('data-wa-left-drawer', 'true');

                var drawerW = targetSideW;
                if (leftAnchorPx > 0 && childRect.width > 0 && childRect.left < leftAnchorPx) {
                    var sideRight = leftAnchorPx + targetSideW;
                    drawerW = Math.max(targetSideW, Math.round(sideRight - childRect.left));
                }

                // Superponer pegado al rail (0px gap) si ya es position: absolute/fixed o si es un sub-drawer izquierdo real
                if (childPos === 'absolute' || childPos === 'fixed') {
                    var absDrawerLeft = navRailRightPx;
                    if (childPos === 'absolute') {
                        var cdOp = child.offsetParent;
                        var cdOpLeft = (cdOp && cdOp !== document.body && cdOp !== document.documentElement)
                            ? Math.round(cdOp.getBoundingClientRect().left)
                            : 0;
                        absDrawerLeft = Math.max(0, navRailRightPx - cdOpLeft);
                    }
                    child.style.setProperty('left', absDrawerLeft + 'px', 'important');
                    child.style.setProperty('inset-inline-start', absDrawerLeft + 'px', 'important');
                    child.style.setProperty('top', '0px', 'important');
                    child.style.setProperty('bottom', '0px', 'important');
                    child.style.setProperty('z-index', '250', 'important');
                    child.style.setProperty('width', targetSideW + 'px', 'important');
                    child.style.setProperty('min-width', targetSideW + 'px', 'important');
                    child.style.setProperty('max-width', targetSideW + 'px', 'important');
                    child.style.setProperty('overflow', 'hidden', 'important');
                    child.style.setProperty('border-right', '1px solid rgba(134, 150, 160, 0.22)', 'important');
                    child.style.setProperty('background-color', 'var(--panel-background-deep, var(--background-default, #111b21))', 'important');
                    continue;
                }

                if (activeLeftFlowOwner && activeLeftFlowOwner !== child && hasExplicitLeftDrawer) {
                    child.style.setProperty('position', 'absolute', 'important');
                    child.style.setProperty('top', '0px', 'important');
                    child.style.setProperty('bottom', '0px', 'important');
                    child.style.setProperty('left', navRailRightPx + 'px', 'important');
                    child.style.setProperty('inset-inline-start', navRailRightPx + 'px', 'important');
                    child.style.setProperty('height', '100%', 'important');
                    child.style.setProperty('z-index', '15', 'important');
                    child.style.setProperty('width', targetSideW + 'px', 'important');
                    child.style.setProperty('min-width', targetSideW + 'px', 'important');
                    child.style.setProperty('max-width', targetSideW + 'px', 'important');
                    child.style.setProperty('overflow', 'hidden', 'important');
                    child.style.setProperty('border-right', '1px solid rgba(134, 150, 160, 0.22)', 'important');
                    child.style.setProperty('background-color', 'var(--panel-background-deep, var(--background-default, #111b21))', 'important');
                    continue;
                }

                activeLeftFlowOwner = child;
                child.style.removeProperty('position');
                child.style.removeProperty('left');
                child.style.removeProperty('top');
                child.style.removeProperty('bottom');
                child.style.removeProperty('z-index');
                child.style.removeProperty('border');
                child.style.removeProperty('border-left');
                child.style.setProperty('flex', '0 0 ' + drawerW + 'px', 'important');
                child.style.setProperty('flex-basis', drawerW + 'px', 'important');
                child.style.setProperty('flex-grow', '0', 'important');
                child.style.setProperty('flex-shrink', '0', 'important');
                child.style.setProperty('width', drawerW + 'px', 'important');
                child.style.setProperty('min-width', drawerW + 'px', 'important');
                child.style.setProperty('max-width', drawerW + 'px', 'important');
                child.style.setProperty('overflow', 'hidden', 'important');
                child.style.setProperty('border-right', '1px solid rgba(134, 150, 160, 0.22)', 'important');
                child.style.setProperty('background-color', 'var(--panel-background-deep, var(--background-default, #111b21))', 'important');
            } else {
                if (child.hasAttribute('data-wa-aux-empty')) {
                    clearAuxInlineStyles(child);
                    child.removeAttribute('data-wa-aux-empty');
                }
                hasRightCol = true;
                child.removeAttribute('data-wa-left-drawer');
                child.removeAttribute('data-wa-tab-shell');
                clearStaleInnerDrawers(child);
                child.setAttribute('data-wa-right-column', 'true');

                if (!isRightDragging) {
                    var rw = Math.max(MIN_RIGHT_WIDTH, Math.min(getSavedRightWidth(), getMaxRightWidth()));
                    document.documentElement.style.setProperty('--wa-right-panel-width', rw + 'px');
                    child.style.removeProperty('overflow');
                    child.style.removeProperty('border');
                    child.style.removeProperty('border-right');
                    child.style.removeProperty('background-color');
                    applyRightColumnInlineWidth(child, rw);
                }
            }
        }

        var leftDrawers = container.querySelectorAll('[data-animate-drawer-left="true"]');
        for (var j = 0; j < leftDrawers.length; j++) {
            var dl = leftDrawers[j];
            if (dl.children.length === 0) continue;
            // Si el drawer es o contiene un Tab Shell de 2 columnas (Estados/Canales/Comunidades/Configuracion/Perfil),
            // NO aplastarlo a targetSideW!
            if (dl.hasAttribute('data-wa-tab-shell') ||
                dl.querySelector('[data-wa-tab-shell="true"], [data-wa-tab-side-column="true"]')) {
                continue;
            }
            var dlSplit = !dl.closest('[data-wa-tab-side-column="true"]') ? splitMultiColumnWrapper(dl) : null;
            if (dlSplit) {
                var navRightFallback = (navRailRect && navRailRect.width > 0) ? Math.round(navRailRect.right) : 0;
                applyTabShellLayout(dl, dl, dlSplit, navRightFallback, targetSideW);
                continue;
            }
            if (dl.hasAttribute('data-wa-left-drawer')) {
                dl.style.setProperty('box-sizing', 'border-box', 'important');
                continue;
            }
            var inLeftDrawer = !!dl.closest('[data-wa-left-drawer="true"]');
            var inTabSideCol = !!dl.closest('[data-wa-tab-side-column="true"]');
            var inSideCol = !!(sideCol && sideCol.contains(dl));
            if (inLeftDrawer || inTabSideCol || (inSideCol && !isCompactActive())) {
                var dlRect = dl.getBoundingClientRect();
                if (sideRect && inSideCol && !isCompactActive() && dlRect.width > 0 && dlRect.left < sideRect.left - 1) {
                    var dlW = Math.max(targetSideW, Math.round((sideRect.left + targetSideW) - dlRect.left));
                    dl.style.setProperty('width', dlW + 'px', 'important');
                    dl.style.setProperty('min-width', '0px', 'important');
                    dl.style.setProperty('max-width', dlW + 'px', 'important');
                } else {
                    dl.style.setProperty('width', '100%', 'important');
                    dl.style.setProperty('min-width', '0px', 'important');
                    dl.style.setProperty('max-width', '100%', 'important');
                }
            } else {
                dl.style.setProperty('width', targetSideW + 'px', 'important');
                dl.style.setProperty('min-width', '0px', 'important');
                dl.style.setProperty('max-width', targetSideW + 'px', 'important');
                dl.style.setProperty('background-color', 'var(--panel-background-deep, var(--background-default, #111b21))', 'important');
            }
            dl.style.setProperty('overflow-x', 'clip', 'important');
            dl.style.setProperty('box-sizing', 'border-box', 'important');
        }

        var activeTabShell = false;
        var tabShells = container.querySelectorAll('[data-wa-tab-shell="true"]');
        for (var tsIdx = 0; tsIdx < tabShells.length; tsIdx++) {
            var tsEl = tabShells[tsIdx];
            if (!tsEl.isConnected) continue;
            var tsRect = tsEl.getBoundingClientRect();
            var tsCs = window.getComputedStyle(tsEl);
            if (tsRect.width > 0 && tsRect.height > 0 && tsCs.display !== 'none' && tsCs.visibility !== 'hidden') {
                activeTabShell = true;
                break;
            }
        }
        if (!activeTabShell && !side) {
            var tabSideCheck = container.querySelector('[data-wa-tab-side-column="true"]');
            if (tabSideCheck && tabSideCheck.isConnected) {
                var tscRect = tabSideCheck.getBoundingClientRect();
                if (tscRect.width > 0 && tscRect.height > 0) {
                    activeTabShell = true;
                }
            }
        }

        var activeLeftDrawer = false;
        var activeLeftDrawers = container.querySelectorAll('[data-wa-left-drawer="true"]:not([data-wa-tab-shell="true"])');
        for (var ldIdx = 0; ldIdx < activeLeftDrawers.length; ldIdx++) {
            var ldEl = activeLeftDrawers[ldIdx];
            if (!ldEl.isConnected) continue;
            var ldRect = ldEl.getBoundingClientRect();
            var ldCs = window.getComputedStyle(ldEl);
            if (ldRect.width > 0 && ldRect.height > 0 && ldCs.display !== 'none' && ldCs.visibility !== 'hidden') {
                activeLeftDrawer = true;
                break;
            }
        }

        var wasTabShellActive = !!(document.body && document.body.classList.contains('wa-tab-shell-active'));
        var wasLeftDrawerActive = !!(document.body && document.body.classList.contains('wa-left-drawer-active'));
        if (document.body) {
            if (activeTabShell) {
                document.body.classList.add('wa-tab-shell-active');
            } else {
                document.body.classList.remove('wa-tab-shell-active');
            }
            if (activeLeftDrawer) {
                document.body.classList.add('wa-left-drawer-active');
            } else {
                document.body.classList.remove('wa-left-drawer-active');
            }
        }

        var sideCoveredByTabShellHost = false;
        for (var ci = 0; ci < children.length; ci++) {
            var cChild = children[ci];
            var isChatUnderlying = (side && (cChild === side || cChild.contains(side))) ||
                                   (mainEl && (cChild === mainEl || cChild.contains(mainEl))) ||
                                   (sideCol && cChild === sideCol && !cChild.hasAttribute('data-wa-tab-side-column')) ||
                                   (mainCol && cChild === mainCol && !cChild.hasAttribute('data-wa-tab-shell') && !cChild.closest('[data-wa-tab-shell="true"]'));
            if (!isChatUnderlying) {
                if (cChild.hasAttribute('data-wa-chat-bg-hidden')) {
                    cChild.removeAttribute('data-wa-chat-bg-hidden');
                }
                continue;
            }
            var hostsTabShell = cChild.hasAttribute('data-wa-tab-shell') || !!cChild.querySelector('[data-wa-tab-shell="true"]');
            if (activeTabShell && !hostsTabShell) {
                cChild.setAttribute('data-wa-chat-bg-hidden', 'true');
            } else {
                if (hostsTabShell && side && (cChild === side || cChild.contains(side))) {
                    sideCoveredByTabShellHost = true;
                }
                if (cChild.hasAttribute('data-wa-chat-bg-hidden')) {
                    cChild.removeAttribute('data-wa-chat-bg-hidden');
                }
            }
        }
        if (side) {
            if (activeTabShell && sideCoveredByTabShellHost &&
                !side.closest('[data-wa-tab-shell="true"]') &&
                !side.querySelector('[data-wa-tab-shell="true"]')) {
                side.setAttribute('data-wa-chat-bg-hidden', 'true');
            } else if (side.hasAttribute('data-wa-chat-bg-hidden')) {
                side.removeAttribute('data-wa-chat-bg-hidden');
            }
        }

        if (hasRightCol) {
            ensureRightResizer();
        }
        updateResizerPosition();
        if (wasTabShellActive !== activeTabShell || wasLeftDrawerActive !== activeLeftDrawer) {
            syncResizerOverlayState();
        }
    }

    function setSidebarWidth(width, persist) {
        var max = getMaxWidth();
        var numericWidth = (typeof width === 'number' && !isNaN(width)) ? width : DEFAULT_WIDTH;
        var clamped = Math.max(MIN_WIDTH, Math.min(Math.round(numericWidth), max));
        currentSidebarWidth = clamped;

        document.documentElement.style.setProperty('--wa-sidebar-width', clamped + 'px');
        document.documentElement.style.setProperty('--wa-tab-sidebar-width', clamped + 'px');

        // Actualizar cualquier sub-columna izquierda activa de pestanas no-Chat o drawers izquierdos
        var tabSideCols = document.querySelectorAll('[data-wa-tab-side-column="true"], [data-wa-left-drawer="true"]:not([data-wa-tab-shell="true"])');
        for (var ts = 0; ts < tabSideCols.length; ts++) {
            var tsc = tabSideCols[ts];
            tsc.style.setProperty('flex', '0 0 ' + clamped + 'px', 'important');
            tsc.style.setProperty('flex-basis', clamped + 'px', 'important');
            tsc.style.setProperty('flex-grow', '0', 'important');
            tsc.style.setProperty('flex-shrink', '0', 'important');
            tsc.style.setProperty('width', clamped + 'px', 'important');
            tsc.style.setProperty('min-width', clamped + 'px', 'important');
            tsc.style.setProperty('max-width', clamped + 'px', 'important');
        }

        var didSyncAux = false;
        var containers = resolveLayoutContainers();
        if (containers && !isCompactActive()) {
            var side = containers.side;
            var sideCol = containers.sideColumn;
            var mainCol = containers.mainColumn;

            if (side) {
                side.__waWidthApplied = true;
            }

            if (sideCol) {
                sideCol.style.removeProperty('border-right');
                sideCol.style.removeProperty('overflow');
                sideCol.style.setProperty('width', clamped + 'px', 'important');
                sideCol.style.setProperty('min-width', clamped + 'px', 'important');
                sideCol.style.setProperty('max-width', clamped + 'px', 'important');
                sideCol.style.setProperty('flex-basis', clamped + 'px', 'important');
                sideCol.style.setProperty('flex-grow', '0', 'important');
                sideCol.style.setProperty('flex-shrink', '0', 'important');
            }

            if (side && side !== sideCol) {
                side.style.removeProperty('border-right');
                side.style.removeProperty('overflow');
                side.style.setProperty('width', '100%', 'important');
                side.style.setProperty('min-width', '100%', 'important');
                side.style.setProperty('max-width', '100%', 'important');
                side.style.setProperty('flex-basis', '100%', 'important');
                side.style.setProperty('flex-grow', '1', 'important');
                side.style.setProperty('flex-shrink', '1', 'important');
            } else if (side) {
                side.style.removeProperty('border-right');
                side.style.removeProperty('overflow');
                side.style.setProperty('width', clamped + 'px', 'important');
                side.style.setProperty('min-width', clamped + 'px', 'important');
                side.style.setProperty('max-width', clamped + 'px', 'important');
                side.style.setProperty('flex-basis', clamped + 'px', 'important');
            }

            if (mainCol) {
                mainCol.style.setProperty('flex', '1 1 0%', 'important');
                mainCol.style.setProperty('flex-grow', '1', 'important');
                mainCol.style.setProperty('flex-shrink', '1', 'important');
                mainCol.style.setProperty('min-width', '0', 'important');
                mainCol.style.setProperty('width', 'auto', 'important');
                mainCol.style.setProperty('max-width', 'none', 'important');
            }

            var mainEl = document.querySelector('#main');
            if (mainEl && mainEl !== mainCol) {
                mainEl.style.setProperty('width', '100%', 'important');
                mainEl.style.setProperty('height', '100%', 'important');
                mainEl.style.setProperty('min-width', '0', 'important');
                mainEl.style.setProperty('flex', '1 1 auto', 'important');
            }

            syncAuxDrawers(containers.flexContainer, sideCol, mainCol);
            didSyncAux = true;
        }

        if (persist) {
            localStorage.setItem(STORAGE_KEY_WIDTH, clamped.toString());
        }

        if (!didSyncAux) {
            updateResizerPosition();
        }
        scheduleMainScaleUpdate();
    }

    function resolveLeftResizeTarget() {
        // 1. Priorizar la sub-columna izquierda visible de una pestana no-Chat activa ([data-wa-tab-side-column="true"])
        var tabCols = document.querySelectorAll('[data-wa-tab-side-column="true"]');
        for (var tc = tabCols.length - 1; tc >= 0; tc--) {
            var tcEl = tabCols[tc];
            if (!tcEl.isConnected) continue;
            var tcRect = tcEl.getBoundingClientRect();
            if (tcRect.width > 0 && tcRect.height > 0) {
                return { element: tcEl, rect: tcRect };
            }
        }
        // 2. Priorizar cualquier drawer izquierdo visible (p. ej. Configuracion/sub-drawers en modo compacto o normal)
        var drawers = document.querySelectorAll('[data-wa-left-drawer="true"]:not([data-wa-tab-shell="true"])');
        for (var di = drawers.length - 1; di >= 0; di--) {
            var dEl = drawers[di];
            if (!dEl.isConnected) continue;
            var dRect = dEl.getBoundingClientRect();
            if (dRect.width > 0 && dRect.height > 0) {
                return { element: dEl, rect: dRect };
            }
        }
        var containers = resolveLayoutContainers();
        var targetEl = (containers && containers.sideColumn) ? containers.sideColumn : document.querySelector('#side');
        var rect = targetEl ? targetEl.getBoundingClientRect() : null;
        if (!targetEl || !rect || rect.width === 0 || rect.height === 0) {
            return null;
        }
        return { element: targetEl, rect: rect };
    }

    function updateLeftResizerPosition() {
        if (!resizerElement) return;

        var target = resolveLeftResizeTarget();
        if (!target) {
            resizerElement.style.display = 'none';
            resizerElement.style.left = '-9999px';
            return;
        }
        var isTabOrDrawerTarget = target.element.getAttribute('data-wa-tab-side-column') === 'true' ||
                                  target.element.getAttribute('data-wa-left-drawer') === 'true';
        if (isCompactActive() && !isTabOrDrawerTarget) {
            resizerElement.style.display = 'none';
            resizerElement.style.left = '-9999px';
            return;
        }

        resizerElement.style.display = 'block';
        resizerElement.style.top = target.rect.top + 'px';
        resizerElement.style.height = target.rect.height + 'px';
        resizerElement.style.left = target.rect.right + 'px';
    }

    function updateRightResizerPosition() {
        if (!rightResizerElement) return;
        if (isRightDragging) {
            var dragCol = document.querySelector('[data-wa-right-column="true"]');
            if (dragCol) {
                var dRect = dragCol.getBoundingClientRect();
                if (dRect.width > 0) {
                    rightResizerElement.style.left = dRect.left + 'px';
                }
            }
            return;
        }

        var rightCol = document.querySelector('[data-wa-right-column="true"]');
        if (!rightCol) {
            rightResizerElement.style.display = 'none';
            rightResizerElement.style.left = '-9999px';
            return;
        }

        var rRect = rightCol.getBoundingClientRect();
        if (rRect.width <= 0 || rRect.height <= 0) {
            rightResizerElement.style.display = 'none';
            rightResizerElement.style.left = '-9999px';
            return;
        }

        rightResizerElement.style.display = 'block';
        rightResizerElement.style.top = rRect.top + 'px';
        rightResizerElement.style.height = rRect.height + 'px';
        rightResizerElement.style.left = rRect.left + 'px';
    }

    function updateResizerPosition() {
        updateLeftResizerPosition();
        updateRightResizerPosition();
        scheduleMainScaleUpdate();
    }

    function onMouseDown(e) {
        if (e.button !== 0) return;
        var hasActiveTabOrDrawer = false;
        var tabCols = document.querySelectorAll('[data-wa-tab-side-column="true"], [data-wa-left-drawer="true"]:not([data-wa-tab-shell="true"])');
        for (var tc = 0; tc < tabCols.length; tc++) {
            var tcR = tabCols[tc].getBoundingClientRect();
            if (tcR.width > 0 && tcR.height > 0) {
                hasActiveTabOrDrawer = true;
                break;
            }
        }
        if (isCompactActive() && !hasActiveTabOrDrawer) return;
        syncResizerOverlayState(e.clientX, e.clientY);
        if (resizerElement && resizerElement.classList.contains('wa-resizer-disabled')) {
            return;
        }
        e.preventDefault();

        if (compactAnimTimer) {
            clearTimeout(compactAnimTimer);
            compactAnimTimer = null;
        }
        document.body.classList.remove('wa-sidebar-animating');
        hideHoverTooltip();

        isDragging = true;
        if (resizerElement) {
            resizerElement.classList.add('is-resizing');
        }
        document.documentElement.classList.add('wa-resizing-active');

        window.addEventListener('mousemove', onMouseMove, { passive: false, capture: true });
        window.addEventListener('mouseup', onMouseUp, { once: true, capture: true });
    }

    function onMouseMove(e) {
        if (!isDragging) return;
        e.preventDefault();
        targetClientX = e.clientX;

        if (!rafPending) {
            rafPending = true;
            window.requestAnimationFrame(function() {
                rafPending = false;
                if (!isDragging) return;

                var target = resolveLeftResizeTarget();
                if (!target) return;

                var sideLeft = target.rect.left;
                var calculatedWidth = targetClientX - sideLeft;

                setSidebarWidth(calculatedWidth, false);
            });
        }
    }

    function onMouseUp(e) {
        if (!isDragging) return;
        isDragging = false;

        if (resizerElement) {
            resizerElement.classList.remove('is-resizing');
        }
        document.documentElement.classList.remove('wa-resizing-active');

        window.removeEventListener('mousemove', onMouseMove, { capture: true });

        var target = resolveLeftResizeTarget();
        if (target) {
            var currentWidth = Math.round(target.rect.width);
            setSidebarWidth(currentWidth, true);
        }
    }

    function onRightMouseDown(e) {
        if (e.button !== 0) return;
        syncResizerOverlayState(e.clientX, e.clientY);
        if (rightResizerElement && rightResizerElement.classList.contains('wa-resizer-disabled')) {
            return;
        }
        var rightCol = document.querySelector('[data-wa-right-column="true"]');
        if (!rightCol) return;

        hideHoverTooltip();
        e.preventDefault();
        isRightDragging = true;
        if (rightResizerElement) {
            rightResizerElement.classList.add('is-resizing');
        }
        document.documentElement.classList.add('wa-resizing-active');

        window.addEventListener('mousemove', onRightMouseMove, { passive: false, capture: true });
        window.addEventListener('mouseup', onRightMouseUp, { once: true, capture: true });
    }

    function onRightMouseMove(e) {
        if (!isRightDragging) return;
        e.preventDefault();
        rightTargetClientX = e.clientX;

        if (!rightRafPending) {
            rightRafPending = true;
            window.requestAnimationFrame(function() {
                rightRafPending = false;
                if (!isRightDragging) return;

                var rightCol = document.querySelector('[data-wa-right-column="true"]');
                if (!rightCol) return;

                var rightEdge = rightCol.getBoundingClientRect().right;
                var calculatedWidth = rightEdge - rightTargetClientX;
                setRightPanelWidth(calculatedWidth, false);
            });
        }
    }

    function onRightMouseUp(e) {
        if (!isRightDragging) return;
        isRightDragging = false;

        if (rightResizerElement) {
            rightResizerElement.classList.remove('is-resizing');
        }
        document.documentElement.classList.remove('wa-resizing-active');

        window.removeEventListener('mousemove', onRightMouseMove, { capture: true });

        var rightCol = document.querySelector('[data-wa-right-column="true"]');
        if (rightCol) {
            var currentWidth = Math.round(rightCol.getBoundingClientRect().width);
            setRightPanelWidth(currentWidth, true);
        }
    }

    window.__waSetSidebarCompact = function(targetCompact) {
        var currentlyCompact = isCompactActive();
        if (targetCompact === currentlyCompact) return;

        hideHoverTooltip();

        var containers = resolveLayoutContainers();
        var side = (containers && containers.side) ? containers.side : document.querySelector('#side');
        var sideCol = (containers && containers.sideColumn) ? containers.sideColumn : side;
        var mainCol = (containers && containers.mainColumn) ? containers.mainColumn : null;
        var mainAppEl = document.querySelector('#main [role="application"]');

        var navRail = document.querySelector('[data-wa-nav-rail="true"]') ||
                      (containers && containers.flexContainer ? containers.flexContainer.querySelector(':scope > header') : null);
        var topCollapsible = [];
        if (side) {
            for (var sc = 0; sc < side.children.length; sc++) {
                var ch = side.children[sc];
                if (ch.id === 'pane-side' || ch.querySelector('#pane-side')) continue;
                if (ch.matches('[role="alert"], [role="status"], [data-testid*="toast"], [data-animate-toast]') ||
                    ch.querySelector('[role="alert"], [role="status"], [data-testid*="toast"], [data-animate-toast]')) {
                    continue;
                }
                topCollapsible.push(ch);
            }
        }

        if (compactAnimTimer) {
            clearTimeout(compactAnimTimer);
            compactAnimTimer = null;
        }

        // Fase 1: Agrupar todas las lecturas iniciales antes de cualquier escritura DOM
        var flipPane = document.getElementById('pane-side');
        var flipBeforeTop = flipPane ? flipPane.getBoundingClientRect().top : 0;
        var navW = navRail ? Math.round(navRail.getBoundingClientRect().width) : 0;
        var sideColW = sideCol ? Math.round(sideCol.getBoundingClientRect().width) : 0;
        var tcHeights = [];
        if (targetCompact) {
            for (var tc0 = 0; tc0 < topCollapsible.length; tc0++) {
                tcHeights.push(Math.round(topCollapsible[tc0].getBoundingClientRect().height));
            }
        }

        // Fase 2: Agrupar escrituras de estado inicial
        var railSeamHost = document.querySelector('[data-wa-rail-seam-host="true"]');
        var railSeamFirst = railSeamHost ? railSeamHost.firstElementChild : null;
        if (flipPane) {
            flipPane.style.removeProperty('transition');
            flipPane.style.removeProperty('transform');
        }
        if (sideCol) {
            sideCol.style.setProperty('will-change', 'width', 'important');
        }
        if (navRail) {
            navRail.style.setProperty('will-change', 'width', 'important');
        }
        if (railSeamFirst) {
            railSeamFirst.style.setProperty('will-change', 'margin-inline-start, width', 'important');
        }
        if (mainAppEl) {
            mainAppEl.style.setProperty('contain', 'layout style', 'important');
        }

        if (targetCompact) {
            if (navRail) {
                if (navW > 42) {
                    navRail.__waNormalWidth = navW;
                }
                if (navW > 0) {
                    navRail.style.setProperty('width', navW + 'px', 'important');
                    navRail.style.setProperty('min-width', navW + 'px', 'important');
                    navRail.style.setProperty('max-width', navW + 'px', 'important');
                    navRail.style.setProperty('flex-basis', navW + 'px', 'important');
                }
            }
            if (railSeamFirst) {
                var seamStartMargin = (navW > 0) ? navW : 64;
                var seamStartW = (sideColW > 0) ? sideColW : getSavedWidth();
                railSeamFirst.style.setProperty('margin-inline-start', seamStartMargin + 'px', 'important');
                railSeamFirst.style.setProperty('width', seamStartW + 'px', 'important');
                railSeamFirst.style.setProperty('min-width', seamStartW + 'px', 'important');
                railSeamFirst.style.setProperty('max-width', seamStartW + 'px', 'important');
                railSeamFirst.style.setProperty('flex-basis', seamStartW + 'px', 'important');
            }
            for (var tc = 0; tc < topCollapsible.length; tc++) {
                var tcEl = topCollapsible[tc];
                var h = tcHeights[tc];
                tcEl.style.setProperty('max-height', (h > 0 ? h : 64) + 'px', 'important');
                tcEl.style.setProperty('overflow', 'hidden', 'important');
                tcEl.style.setProperty('opacity', '1', 'important');
            }
        } else {
            if (navRail) {
                navRail.style.setProperty('width', '42px', 'important');
                navRail.style.setProperty('min-width', '42px', 'important');
                navRail.style.setProperty('max-width', '42px', 'important');
                navRail.style.setProperty('flex-basis', '42px', 'important');
            }
            if (railSeamFirst) {
                railSeamFirst.style.setProperty('margin-inline-start', '42px', 'important');
                railSeamFirst.style.setProperty('width', '70px', 'important');
                railSeamFirst.style.setProperty('min-width', '70px', 'important');
                railSeamFirst.style.setProperty('max-width', '70px', 'important');
                railSeamFirst.style.setProperty('flex-basis', '70px', 'important');
            }
        }

        document.body.classList.add('wa-sidebar-animating');
        // Unico flush de layout antes de activar los estilos de destino de la transicion
        if (sideCol) {
            void sideCol.offsetWidth;
        }

        var savedWidth = getSavedWidth();

        if (targetCompact) {
            if (sideColW >= MIN_WIDTH) {
                localStorage.setItem(STORAGE_KEY_WIDTH, sideColW.toString());
            }
            document.body.classList.add('wa-sidebar-compact');
            localStorage.setItem(STORAGE_KEY_COMPACT, 'true');
            document.documentElement.style.setProperty('--wa-sidebar-width', '70px');
            // Etiquetar solo atributos data-wa-avatar-col/data-wa-text-col; diferir shiftWrites al final de la animacion
            syncAvatarTooltips(true);
            if (resizerElement &&
                !document.body.classList.contains('wa-tab-shell-active') &&
                !document.body.classList.contains('wa-left-drawer-active')) {
                resizerElement.style.display = 'none';
                resizerElement.style.left = '-9999px';
            }
            if (mainCol) {
                mainCol.style.setProperty('flex', '1 1 0%', 'important');
                mainCol.style.setProperty('flex-grow', '1', 'important');
                mainCol.style.setProperty('min-width', '0', 'important');
                mainCol.style.setProperty('width', 'auto', 'important');
                mainCol.style.setProperty('max-width', 'none', 'important');
            }
        } else {
            document.body.classList.remove('wa-sidebar-compact');
            localStorage.setItem(STORAGE_KEY_COMPACT, 'false');
            syncAvatarTooltips(false);
            document.documentElement.style.setProperty('--wa-sidebar-width', savedWidth + 'px');
        }

        var deltaY = 0;
        if (flipPane && flipPane.isConnected) {
            var flipAfterTop = flipPane.getBoundingClientRect().top;
            deltaY = flipBeforeTop - flipAfterTop;
            if (Math.abs(deltaY) > 2) {
                flipPane.style.setProperty('transition', 'none', 'important');
                flipPane.style.setProperty('transform', 'translateY(' + Math.round(deltaY) + 'px)', 'important');
                void flipPane.offsetHeight;
            }
        }

        // Sincronizar navRail + railSeamFirst + sideCol + topCollapsible + flipPane en el MISMO unico requestAnimationFrame
        window.requestAnimationFrame(function() {
            if (targetCompact) {
                if (navRail) {
                    navRail.style.setProperty('width', '42px', 'important');
                    navRail.style.setProperty('min-width', '42px', 'important');
                    navRail.style.setProperty('max-width', '42px', 'important');
                    navRail.style.setProperty('flex-basis', '42px', 'important');
                }
                if (railSeamFirst) {
                    railSeamFirst.style.setProperty('margin-inline-start', '42px', 'important');
                    railSeamFirst.style.setProperty('width', '70px', 'important');
                    railSeamFirst.style.setProperty('min-width', '70px', 'important');
                    railSeamFirst.style.setProperty('max-width', '70px', 'important');
                    railSeamFirst.style.setProperty('flex-basis', '70px', 'important');
                }
                for (var tc2 = 0; tc2 < topCollapsible.length; tc2++) {
                    var tcEl2 = topCollapsible[tc2];
                    tcEl2.style.setProperty('transition', 'max-height 180ms cubic-bezier(0.22, 1, 0.36, 1), opacity 150ms ease, padding 180ms cubic-bezier(0.22, 1, 0.36, 1), margin 180ms cubic-bezier(0.22, 1, 0.36, 1)', 'important');
                    tcEl2.style.setProperty('max-height', '0px', 'important');
                    tcEl2.style.setProperty('opacity', '0', 'important');
                    tcEl2.style.setProperty('padding-top', '0px', 'important');
                    tcEl2.style.setProperty('padding-bottom', '0px', 'important');
                    tcEl2.style.setProperty('margin-top', '0px', 'important');
                    tcEl2.style.setProperty('margin-bottom', '0px', 'important');
                }
                if (sideCol) {
                    sideCol.style.removeProperty('border-right');
                    sideCol.style.setProperty('width', '70px', 'important');
                    sideCol.style.setProperty('min-width', '70px', 'important');
                    sideCol.style.setProperty('max-width', '70px', 'important');
                    sideCol.style.setProperty('flex-basis', '70px', 'important');
                    sideCol.style.setProperty('overflow', 'visible', 'important');
                }
                if (side && side !== sideCol) {
                    side.style.removeProperty('border-right');
                    side.style.setProperty('width', '100%', 'important');
                    side.style.setProperty('min-width', '0', 'important');
                    side.style.setProperty('max-width', '100%', 'important');
                    side.style.setProperty('flex', '1 1 auto', 'important');
                    side.style.setProperty('overflow', 'hidden', 'important');
                }
            } else {
                var railNormalW = (navRail && navRail.__waNormalWidth) ? navRail.__waNormalWidth : 64;
                if (navRail) {
                    navRail.style.setProperty('width', railNormalW + 'px', 'important');
                    navRail.style.setProperty('min-width', railNormalW + 'px', 'important');
                    navRail.style.setProperty('max-width', railNormalW + 'px', 'important');
                    navRail.style.setProperty('flex-basis', railNormalW + 'px', 'important');
                }
                if (railSeamFirst) {
                    railSeamFirst.style.setProperty('margin-inline-start', railNormalW + 'px', 'important');
                    railSeamFirst.style.setProperty('width', savedWidth + 'px', 'important');
                    railSeamFirst.style.setProperty('min-width', savedWidth + 'px', 'important');
                    railSeamFirst.style.setProperty('max-width', savedWidth + 'px', 'important');
                    railSeamFirst.style.setProperty('flex-basis', savedWidth + 'px', 'important');
                }
                setSidebarWidth(savedWidth, false);
            }
            if (flipPane && flipPane.isConnected && Math.abs(deltaY) > 2) {
                flipPane.style.setProperty('transition', 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)', 'important');
                flipPane.style.setProperty('transform', 'translateY(0px)', 'important');
            }
        });

        var btn = document.querySelector('.wa-compact-toggle-btn');
        if (btn) {
            updateButtonAppearance(btn, targetCompact);
        }

        compactAnimTimer = setTimeout(function() {
            compactAnimTimer = null;
            if (flipPane) {
                flipPane.style.removeProperty('transition');
                flipPane.style.removeProperty('transform');
            }
            if (sideCol) {
                sideCol.style.removeProperty('will-change');
            }
            if (navRail) {
                navRail.style.removeProperty('will-change');
                navRail.style.removeProperty('width');
                navRail.style.removeProperty('min-width');
                navRail.style.removeProperty('max-width');
                navRail.style.removeProperty('flex-basis');
            }
            if (railSeamFirst) {
                railSeamFirst.style.removeProperty('will-change');
                railSeamFirst.style.removeProperty('margin-inline-start');
                railSeamFirst.style.removeProperty('width');
                railSeamFirst.style.removeProperty('min-width');
                railSeamFirst.style.removeProperty('max-width');
                railSeamFirst.style.removeProperty('flex-basis');
            }
            if (mainAppEl) {
                mainAppEl.style.removeProperty('contain');
            }
            for (var tc3 = 0; tc3 < topCollapsible.length; tc3++) {
                var tcEl3 = topCollapsible[tc3];
                tcEl3.style.removeProperty('transition');
                tcEl3.style.removeProperty('max-height');
                tcEl3.style.removeProperty('overflow');
                tcEl3.style.removeProperty('opacity');
                tcEl3.style.removeProperty('padding-top');
                tcEl3.style.removeProperty('padding-bottom');
                tcEl3.style.removeProperty('margin-top');
                tcEl3.style.removeProperty('margin-bottom');
            }
            document.body.classList.remove('wa-sidebar-animating');
            if (isCompactActive()) {
                syncAvatarTooltips(false);
            }
            var cAfter = resolveLayoutContainers();
            if (cAfter && cAfter.flexContainer) {
                syncAuxDrawers(cAfter.flexContainer, cAfter.sideColumn, cAfter.mainColumn);
            }
            updateResizerPosition();
            scheduleMainScaleUpdate();
            syncResizerOverlayState(lastPointerX, lastPointerY);
        }, 210);
    };

    window.__waToggleSidebarCompact = function() {
        window.__waSetSidebarCompact(!isCompactActive());
    };

    function ensureToggleButton() {
        var existingBtn = document.querySelector('.wa-compact-toggle-btn');
        if (existingBtn && existingBtn.isConnected) {
            updateButtonAppearance(existingBtn, isCompactActive());
            return true;
        }

        var header = document.querySelector('#side header');
        if (!header) return false;

        var wrapper = document.createElement('div');
        wrapper.className = 'wa-compact-toggle-wrapper';

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'wa-compact-toggle-btn';
        updateButtonAppearance(btn, isCompactActive());

        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            window.__waToggleSidebarCompact();
        });

        wrapper.appendChild(btn);

        // Insertar siempre como hijo directo de header para no quedar oculto dentro de botones nativos
        header.appendChild(wrapper);

        return true;
    }

    function syncAvatarTooltips(tagOnly) {
        if (!isCompactActive()) {
            hideHoverTooltip();
            if (syncAvatarTooltips.__dirty !== false) {
                var shifted = document.querySelectorAll('[data-wa-avatar-shifted="true"]');
                for (var sh = 0; sh < shifted.length; sh++) {
                    shifted[sh].style.removeProperty('transform');
                    shifted[sh].removeAttribute('data-wa-avatar-shifted');
                    shifted[sh].removeAttribute('data-wa-shift-px');
                }
                var stale = document.querySelectorAll('[data-wa-compact-hide], [data-wa-avatar-col], [data-wa-text-col], [data-wa-chat-title]');
                for (var s = 0; s < stale.length; s++) {
                    stale[s].__waCompactTagged = false;
                    stale[s].removeAttribute('data-wa-compact-hide');
                    stale[s].removeAttribute('data-wa-avatar-col');
                    stale[s].removeAttribute('data-wa-text-col');
                    stale[s].removeAttribute('data-wa-chat-title');
                }
                restoreNativeTitles();
                syncAvatarTooltips.__dirty = false;
            }
            return;
        }
        syncAvatarTooltips.__dirty = true;

        var pane = document.getElementById('pane-side');
        if (!pane) return;

        var sideRoot = pane.closest('[data-wa-side-column="true"]') || document.getElementById('side');
        if (sideRoot) {
            var sideHeaders = sideRoot.querySelectorAll('header');
            for (var h = 0; h < sideHeaders.length; h++) {
                if (pane.contains(sideHeaders[h])) continue;
                if (sideHeaders[h].getAttribute('data-wa-compact-hide') !== 'true') {
                    sideHeaders[h].setAttribute('data-wa-compact-hide', 'true');
                }
            }

            var ancCurr = pane;
            while (ancCurr) {
                if (ancCurr.hasAttribute('data-wa-compact-hide')) {
                    ancCurr.removeAttribute('data-wa-compact-hide');
                }
                if (ancCurr === sideRoot) break;
                var ancParent = ancCurr.parentElement;
                if (!ancParent || !(sideRoot === ancParent || sideRoot.contains(ancParent))) {
                    break;
                }
                var ancSibs = ancParent.children;
                for (var as = 0; as < ancSibs.length; as++) {
                    var ancSib = ancSibs[as];
                    if (ancSib === ancCurr) continue;
                    var isPaneBranch = ancSib.id === 'pane-side' || ancSib.contains(pane);
                    var isSibToast = !isPaneBranch &&
                                     !ancSib.matches('header') &&
                                     !ancSib.querySelector('header, [role="search"], [role="tablist"], input') &&
                                     (ancSib.matches('[role="alert"], [role="status"], [data-testid*="toast"], [data-animate-toast]') ||
                                      ancSib.querySelector('[role="alert"], [role="status"], [data-testid*="toast"], [data-animate-toast]') !== null);
                    if (isPaneBranch || isSibToast) {
                        if (ancSib.hasAttribute('data-wa-compact-hide')) {
                            ancSib.removeAttribute('data-wa-compact-hide');
                        }
                        continue;
                    }
                    if (ancSib.getAttribute('data-wa-compact-hide') !== 'true') {
                        ancSib.setAttribute('data-wa-compact-hide', 'true');
                    }
                }
                ancCurr = ancParent;
            }
        }

        if (!pane.__waCompactScrollAttached) {
            pane.__waCompactScrollAttached = true;
            var scrollRaf = false;
            pane.addEventListener('scroll', function() {
                hideHoverTooltip();
                if (!isCompactActive() || scrollRaf) return;
                scrollRaf = true;
                window.requestAnimationFrame(function() {
                    scrollRaf = false;
                    syncAvatarTooltips();
                });
            }, { passive: true });
            pane.addEventListener('mouseleave', hideHoverTooltip, { passive: true });
        }

        function isTextSiblingEl(el, avatarEl) {
            if (!el || el.nodeType !== 1) return false;
            if (el.classList && el.classList.contains('wa-alt-badge')) return false;
            if (el === avatarEl || el.contains(avatarEl)) return false;
            var tag = el.tagName ? el.tagName.toLowerCase() : '';
            if (tag === 'svg' || tag === 'path' || el.hasAttribute('data-icon')) return false;
            if (el.getAttribute('role') === 'gridcell' ||
                el.querySelector('[role="gridcell"], [data-testid="cell-frame-title"], [data-testid="cell-frame-primary"], [data-testid="cell-frame-secondary"], span[title], span[dir="auto"]') !== null) {
                return true;
            }
            var nonSvgText = '';
            for (var cn = 0; cn < el.childNodes.length; cn++) {
                var ch = el.childNodes[cn];
                if (ch.nodeType === 3) {
                    nonSvgText += ch.nodeValue;
                } else if (ch.nodeType === 1 && ch.tagName && ch.tagName.toLowerCase() !== 'svg' && !ch.hasAttribute('data-icon')) {
                    nonSvgText += ch.textContent;
                }
            }
            return nonSvgText.trim().length > 0;
        }

        // Ocultar bloques de aviso de cifrado y elementos de Archivados fuera de filas de chat
        var lockIcons = pane.querySelectorAll('span[data-icon*="lock"], [data-testid*="encrypt"], a[href*="encryption"], a[href*="28030015"]');
        for (var l = 0; l < lockIcons.length; l++) {
            var lockEl = lockIcons[l];
            if (lockEl.closest('[role="row"], [role="listitem"]')) continue;
            var lockTarget = lockEl;
            while (lockTarget.parentElement && lockTarget.parentElement !== pane &&
                   !lockTarget.parentElement.querySelector('[role="row"], [role="listitem"]') &&
                   !lockTarget.parentElement.matches('[role="grid"], [role="region"], [role="list"]')) {
                lockTarget = lockTarget.parentElement;
            }
            if (lockTarget !== pane &&
                !lockTarget.matches('[role="grid"], [role="region"], [role="list"]') &&
                !lockTarget.querySelector('[role="row"], [role="listitem"], [role="grid"], [role="region"], [role="list"]')) {
                if (lockTarget.getAttribute('data-wa-compact-hide') !== 'true') {
                    lockTarget.setAttribute('data-wa-compact-hide', 'true');
                }
            }
        }

        // Acotar hideNonRowBlocks a los primeros 2 niveles de #pane-side sin recursion profunda
        function hideNonRowBlocks(node, depth) {
            if (!node || node.nodeType !== 1 || depth > 2) return;
            if (node.matches('[role="row"], [role="listitem"]')) return;
            if (node.getAttribute('data-wa-compact-hide') === 'true') return;

            var hasRowsOrList = node.querySelector('[role="row"], [role="listitem"], [role="grid"], [role="region"], [role="list"]') !== null;
            if (node !== pane && !hasRowsOrList && !node.matches('[role="grid"], [role="region"], [role="list"]')) {
                var txt = (node.textContent || '').trim();
                var hasLock = node.querySelector('span[data-icon*="lock"], [data-testid*="encrypt"], a[href*="encryption"], a[href*="28030015"]') !== null;
                var hasArchive = node.querySelector('span[data-icon*="archiv"], [data-testid*="archiv"]') !== null;
                var isEncryptTxt = /(cifrad|extremo a extremo|end-to-end|encrypt|criptograf)/i.test(txt);
                var isArchiveTxt = /^(archivados|archived|arquivadas)(\s*\d+)?$/i.test(txt);
                if (hasLock || hasArchive || isEncryptTxt || isArchiveTxt) {
                    node.setAttribute('data-wa-compact-hide', 'true');
                }
                return;
            }

            if (depth < 2) {
                var children = node.children;
                for (var c = 0; c < children.length; c++) {
                    hideNonRowBlocks(children[c], depth + 1);
                }
            }
        }
        hideNonRowBlocks(pane, 0);

        var rows = pane.querySelectorAll('[role="row"], [role="listitem"]');
        if (rows.length > 0) {
            // Ocultar hermanos sin filas del contenedor de lista dentro de #pane-side (p. ej. aviso de cifrado al pie)
            var listAncestor = rows[0].parentElement;
            if (listAncestor && listAncestor !== pane) {
                var chain = listAncestor.parentElement;
                var childInChain = listAncestor;
                while (chain && pane.contains(chain)) {
                    var siblings = chain.children;
                    for (var sb = 0; sb < siblings.length; sb++) {
                        var sib = siblings[sb];
                        if (sib === childInChain) continue;
                        if (sib.classList && sib.classList.contains('wa-alt-badge')) continue;
                        if (sib.matches('[role="row"], [role="listitem"]')) continue;
                        if (sib.querySelector('[role="row"], [role="listitem"]')) continue;
                        if ((sib.textContent && sib.textContent.trim().length > 0) ||
                            sib.querySelector('svg, button, a, span') !== null) {
                            if (sib.getAttribute('data-wa-compact-hide') !== 'true') {
                                sib.setAttribute('data-wa-compact-hide', 'true');
                            }
                        }
                    }
                    if (chain === pane) break;
                    childInChain = chain;
                    chain = chain.parentElement;
                }
            }
        } else {
            rows = pane.querySelectorAll('div[data-testid="cell-frame-container"]');
        }

        var pendingAlignments = [];

        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];

            // Fast-path para filas ya etiquetadas cuyo avatar sigue conectado
            if (row.__waCompactTagged === true && row.__waAvatarCol && row.__waAvatarEl &&
                row.contains(row.__waAvatarCol) && row.contains(row.__waAvatarEl) &&
                row.__waAvatarCol.getAttribute('data-wa-avatar-col') === 'true') {
                var quickName = computeRowChatName(row);
                if (quickName && row.getAttribute('data-wa-chat-title') !== quickName) {
                    row.setAttribute('data-wa-chat-title', quickName);
                }
                pendingAlignments.push({
                    row: row,
                    avatarCol: row.__waAvatarCol,
                    avatarEl: row.__waAvatarEl
                });
                continue;
            }

            var isPinned = row.querySelector('span[data-icon*="pin"], [data-testid*="pin"]') !== null;
            if (!isPinned) {
                var hasArchiveIcon = row.querySelector('span[data-icon*="archiv"], [data-testid*="archiv"]') !== null;
                var rowFullText = (row.textContent || '').trim();
                var isArchivedRow = hasArchiveIcon || /^(archivados|archived|arquivadas)(\s*\d+)?$/i.test(rowFullText);
                var isNoticeRow = !row.querySelector('img, span[title], [data-testid="cell-frame-title"]') &&
                                  (row.querySelector('span[data-icon*="lock"], [data-testid*="encrypt"]') !== null ||
                                   /(cifrad|extremo a extremo|end-to-end|encrypt|criptograf)/i.test(rowFullText));
                if (isArchivedRow || isNoticeRow) {
                    if (row.getAttribute('data-wa-compact-hide') !== 'true') {
                        row.setAttribute('data-wa-compact-hide', 'true');
                    }
                    continue;
                }
            }
            if (row.hasAttribute('data-wa-compact-hide')) {
                row.removeAttribute('data-wa-compact-hide');
            }

            var name = computeRowChatName(row);
            if (name && row.getAttribute('data-wa-chat-title') !== name) {
                row.setAttribute('data-wa-chat-title', name);
            }
            suppressNativeTitles(row);

            // Prioridad estricta: img de avatar (no emoji inline), luego svg con <image>, luego iconos por defecto, luego svg grande
            var avatarEl = null;
            var imgs = row.querySelectorAll('img:not(.emoji):not([data-plain-text])');
            for (var im = 0; im < imgs.length; im++) {
                var wAttr = parseInt(imgs[im].getAttribute('width') || '0', 10);
                if (!imgs[im].classList.contains('emoji') && (wAttr === 0 || wAttr >= 24)) {
                    avatarEl = imgs[im];
                    break;
                }
            }
            if (!avatarEl) {
                var svgImg = row.querySelector('svg image');
                if (svgImg) {
                    avatarEl = svgImg.closest('svg');
                }
            }
            if (!avatarEl) {
                avatarEl = row.querySelector(
                    'span[data-icon*="default-"], span[data-icon*="community"], ' +
                    'span[data-icon*="avatar"], span[data-icon*="channel"], span[data-icon*="newsletter"], ' +
                    'span[data-icon*="broadcast"]'
                );
            }
            if (!avatarEl) {
                var svgs = row.querySelectorAll('svg');
                for (var sv = 0; sv < svgs.length; sv++) {
                    var svR = svgs[sv].getBoundingClientRect();
                    if (svR.width >= 32 && svR.height >= 32) {
                        avatarEl = svgs[sv];
                        break;
                    }
                }
            }
            if (!avatarEl) continue;

            var avatarCol = null;
            var flexParent = null;
            var curr = avatarEl;
            while (curr && curr !== row) {
                var parent = curr.parentElement;
                if (!parent || !row.contains(parent)) break;
                var hasTextSib = false;
                var pChildren = parent.children;
                for (var k = 0; k < pChildren.length; k++) {
                    if (pChildren[k] !== curr && isTextSiblingEl(pChildren[k], avatarEl)) {
                        hasTextSib = true;
                        break;
                    }
                }
                if (hasTextSib) {
                    avatarCol = curr;
                    flexParent = parent;
                    break;
                }
                curr = parent;
            }

            if (avatarCol && flexParent) {
                var oldCols = row.querySelectorAll('[data-wa-avatar-col], [data-wa-text-col]');
                for (var oc = 0; oc < oldCols.length; oc++) {
                    var oldEl = oldCols[oc];
                    if (oldEl !== avatarCol && oldEl.parentElement !== flexParent) {
                        if (oldEl.getAttribute('data-wa-avatar-shifted') === 'true') {
                            oldEl.style.removeProperty('transform');
                            oldEl.removeAttribute('data-wa-avatar-shifted');
                        }
                        oldEl.removeAttribute('data-wa-avatar-col');
                        oldEl.removeAttribute('data-wa-text-col');
                    }
                }

                if (avatarCol.getAttribute('data-wa-avatar-col') !== 'true') {
                    avatarCol.setAttribute('data-wa-avatar-col', 'true');
                }
                if (avatarCol.hasAttribute('data-wa-text-col')) {
                    avatarCol.removeAttribute('data-wa-text-col');
                }

                var cols = flexParent.children;
                for (var j = 0; j < cols.length; j++) {
                    var col = cols[j];
                    if (col === avatarCol) continue;
                    if ((col.classList && col.classList.contains('wa-alt-badge')) || col.contains(avatarEl)) {
                        if (col.hasAttribute('data-wa-text-col')) {
                            col.removeAttribute('data-wa-text-col');
                        }
                        continue;
                    }
                    if (col.getAttribute('data-wa-text-col') !== 'true') {
                        col.setAttribute('data-wa-text-col', 'true');
                    }
                    if (col.hasAttribute('data-wa-avatar-col')) {
                        col.removeAttribute('data-wa-avatar-col');
                    }
                }

                row.__waCompactTagged = true;
                row.__waAvatarCol = avatarCol;
                row.__waAvatarEl = avatarEl;

                pendingAlignments.push({
                    row: row,
                    avatarCol: avatarCol,
                    avatarEl: avatarEl
                });
            }
        }

        if (tagOnly || (document.body && document.body.classList.contains('wa-sidebar-animating'))) {
            return;
        }

        // Fase 1 (Lecturas DOM agrupadas, cero layout thrashing por fila): medir posiciones actuales
        var shiftWrites = [];
        for (var p = 0; p < pendingAlignments.length; p++) {
            var item = pendingAlignments[p];
            var rowRect = item.row.getBoundingClientRect();
            var avRect = item.avatarEl.getBoundingClientRect();
            if (rowRect.width <= 0 || avRect.width <= 0) continue;
            var currentShift = parseFloat(item.avatarCol.getAttribute('data-wa-shift-px') || '0') || 0;
            var delta = (rowRect.left + rowRect.width / 2) - (avRect.left + avRect.width / 2);
            var targetShift = Math.round(currentShift + delta);
            if (targetShift !== currentShift) {
                shiftWrites.push({
                    avatarCol: item.avatarCol,
                    shift: targetShift
                });
            }
        }

        // Fase 2 (Escrituras DOM agrupadas): aplicar solo las diferencias necesarias en un unico paso
        for (var w = 0; w < shiftWrites.length; w++) {
            var sw = shiftWrites[w];
            if (Math.abs(sw.shift) > 1) {
                sw.avatarCol.style.setProperty('transform', 'translateX(' + sw.shift + 'px)', 'important');
                sw.avatarCol.setAttribute('data-wa-avatar-shifted', 'true');
                sw.avatarCol.setAttribute('data-wa-shift-px', String(sw.shift));
            } else {
                sw.avatarCol.style.removeProperty('transform');
                sw.avatarCol.removeAttribute('data-wa-avatar-shifted');
                sw.avatarCol.removeAttribute('data-wa-shift-px');
            }
        }
    }

    var rightPanelResizeObserver = null;
    var rightPanelObservedTarget = null;
    var leftPanelResizeObserver = null;
    var leftPanelObservedTarget = null;

    function disconnectPanelResizeObservers() {
        if (rightPanelResizeObserver) {
            rightPanelResizeObserver.disconnect();
        }
        rightPanelObservedTarget = null;
        if (leftPanelResizeObserver) {
            leftPanelResizeObserver.disconnect();
        }
        leftPanelObservedTarget = null;
    }

    function ensureRightResizer() {
        if (!rightResizerElement || !document.body.contains(rightResizerElement)) {
            rightResizerElement = document.getElementById('wa-custom-right-resizer');
            if (!rightResizerElement) {
                rightResizerElement = document.createElement('div');
                rightResizerElement.id = 'wa-custom-right-resizer';
                rightResizerElement.setAttribute('role', 'separator');
                rightResizerElement.setAttribute('aria-orientation', 'vertical');
                rightResizerElement.setAttribute('title', 'Arrastra para redimensionar el panel de informacion');
                document.body.appendChild(rightResizerElement);
            }
            rightResizerElement.removeEventListener('mousedown', onRightMouseDown);
            rightResizerElement.addEventListener('mousedown', onRightMouseDown);
        }

        if (document.hidden) return;
        var rightCol = document.querySelector('[data-wa-right-column="true"]');
        if (rightPanelObservedTarget && (rightPanelObservedTarget !== rightCol || !rightPanelObservedTarget.isConnected)) {
            if (rightPanelResizeObserver) {
                try {
                    rightPanelResizeObserver.unobserve(rightPanelObservedTarget);
                } catch (e) {}
            }
            rightPanelObservedTarget = null;
        }
        if (window.ResizeObserver && rightCol && rightPanelObservedTarget !== rightCol) {
            if (!rightPanelResizeObserver) {
                rightPanelResizeObserver = new ResizeObserver(function() {
                    if (document.hidden) return;
                    if (document.body && document.body.classList.contains('wa-sidebar-animating')) return;
                    if (!isRightDragging) {
                        updateRightResizerPosition();
                    }
                });
            }
            rightPanelResizeObserver.observe(rightCol);
            rightPanelObservedTarget = rightCol;
        }
    }

    function initResizer() {
        var side = document.querySelector('#side');
        if (!side) return false;

        resolveLayoutContainers();

        if (!resizerElement || !document.body.contains(resizerElement)) {
            resizerElement = document.getElementById('wa-custom-resizer');
            if (!resizerElement) {
                resizerElement = document.createElement('div');
                resizerElement.id = 'wa-custom-resizer';
                resizerElement.setAttribute('role', 'separator');
                resizerElement.setAttribute('aria-orientation', 'vertical');
                resizerElement.setAttribute('title', 'Arrastra para redimensionar el panel lateral');
                document.body.appendChild(resizerElement);
            }
            resizerElement.removeEventListener('mousedown', onMouseDown);
            resizerElement.addEventListener('mousedown', onMouseDown);
        }

        ensureRightResizer();

        var containers = resolveLayoutContainers();
        var targetEl = (containers && containers.sideColumn) ? containers.sideColumn : side;

        if (!document.hidden) {
            if (leftPanelObservedTarget && (leftPanelObservedTarget !== targetEl || !leftPanelObservedTarget.isConnected)) {
                if (leftPanelResizeObserver) {
                    try {
                        leftPanelResizeObserver.unobserve(leftPanelObservedTarget);
                    } catch (e) {}
                }
                leftPanelObservedTarget = null;
            }
            if (window.ResizeObserver && targetEl && leftPanelObservedTarget !== targetEl) {
                if (!leftPanelResizeObserver) {
                    leftPanelResizeObserver = new ResizeObserver(function() {
                        if (document.hidden) return;
                        if (document.body && document.body.classList.contains('wa-sidebar-animating')) return;
                        if (!isDragging) {
                            updateLeftResizerPosition();
                        }
                        if (!isRightDragging) {
                            updateRightResizerPosition();
                        }
                    });
                }
                leftPanelResizeObserver.observe(targetEl);
                leftPanelObservedTarget = targetEl;
            }
        }

        updateResizerPosition();
        return true;
    }

    injectStyles();

    function applyCompactInline() {
        var c = resolveLayoutContainers();
        if (!c) return;
        if (c.sideColumn) {
            c.sideColumn.style.removeProperty('border-right');
            c.sideColumn.style.setProperty('width', '70px', 'important');
            c.sideColumn.style.setProperty('min-width', '70px', 'important');
            c.sideColumn.style.setProperty('max-width', '70px', 'important');
            c.sideColumn.style.setProperty('flex-basis', '70px', 'important');
            c.sideColumn.style.setProperty('overflow', 'visible', 'important');
        }
        if (c.side && c.side !== c.sideColumn) {
            c.side.style.removeProperty('border-right');
            c.side.style.setProperty('width', '100%', 'important');
            c.side.style.setProperty('min-width', '0', 'important');
            c.side.style.setProperty('max-width', '100%', 'important');
            c.side.style.setProperty('flex', '1 1 auto', 'important');
            c.side.style.setProperty('overflow', 'hidden', 'important');
        }
        if (c.mainColumn) {
            c.mainColumn.style.setProperty('flex', '1 1 0%', 'important');
            c.mainColumn.style.setProperty('min-width', '0', 'important');
        }
        if (c.flexContainer) {
            syncAuxDrawers(c.flexContainer, c.sideColumn, c.mainColumn);
        }
        if (c.side && c.sideColumn && c.mainColumn) {
            c.side.__waCompactApplied = true;
        }
        ensureRightResizer();
        updateRightResizerPosition();
        ensureMainResizeObserver();
        scheduleMainScaleUpdate();
    }

    function isPointerNearResizer(clientX) {
        if (typeof clientX !== 'number') return false;
        if (resizerElement && resizerElement.style.display !== 'none') {
            var lLeft = parseFloat(resizerElement.style.left);
            if (!isNaN(lLeft) && lLeft > -100 && Math.abs(clientX - lLeft) <= 40) {
                return true;
            }
        }
        if (rightResizerElement && rightResizerElement.style.display !== 'none') {
            var rLeft = parseFloat(rightResizerElement.style.left);
            if (!isNaN(rLeft) && rLeft > -100 && Math.abs(clientX - rLeft) <= 40) {
                return true;
            }
        }
        return false;
    }

    function onGlobalPointerMove(e) {
        lastPointerX = e.clientX;
        lastPointerY = e.clientY;
        handleCompactTooltipPointerMove(e);
        if (!isDragging && !isRightDragging && isPointerNearResizer(e.clientX)) {
            scheduleResizerOverlayCheck();
        }
    }

    function onGlobalPointerDown(e) {
        if (!e || !e.isTrusted) return;
        lastPointerX = e.clientX;
        lastPointerY = e.clientY;
        hideHoverTooltip();
        var tgt = e.target;
        if (tgt && tgt.closest && tgt.closest('#main footer')) {
            pickerOpeningUntil = performance.now() + 500;
        }
        if (!isDragging && !isRightDragging) {
            syncResizerOverlayState(e.clientX, e.clientY);
        }
    }

    var themeAttrObserver = new MutationObserver(function(mutations) {
        if (document.body && document.body.classList.contains('wa-sidebar-animating')) return;
        if (window.__waAltKeyDown === true) return;
        var hasExternalThemeChange = false;
        for (var i = 0; i < mutations.length; i++) {
            var m = mutations[i];
            if (m.attributeName === 'data-theme') {
                hasExternalThemeChange = true;
                break;
            }
            if (m.attributeName === 'class') {
                if (m.target === document.body) {
                    var cls = (document.body.className || '').replace(/\b(wa-sidebar-compact|wa-sidebar-animating|wa-resizing-active)\b/g, '').trim();
                    if (cls === (document.body.__waLastExternalClass || '')) {
                        continue;
                    }
                    document.body.__waLastExternalClass = cls;
                }
                hasExternalThemeChange = true;
                break;
            }
            if (m.attributeName === 'style') {
                if (m.target === document.documentElement) {
                    var rawStyle = (document.documentElement.getAttribute('style') || '').replace(/--wa-[a-z0-9-]+\s*:[^;]+;?/gi, '').trim();
                    if (rawStyle === (document.documentElement.__waLastExternalStyle || '')) {
                        continue;
                    }
                    document.documentElement.__waLastExternalStyle = rawStyle;
                }
                hasExternalThemeChange = true;
                break;
            }
        }
        if (hasExternalThemeChange) {
            discoveredWdsVarRuleText = '';
            scheduleAccentSync(false);
        }
    });

    function observeThemeRoots() {
        var targets = [document.documentElement, document.body, document.querySelector('#app > div')];
        for (var i = 0; i < targets.length; i++) {
            var t = targets[i];
            if (!t || t.__waThemeObserverAttached) continue;
            t.__waThemeObserverAttached = true;
            if (t === document.body) {
                t.__waLastExternalClass = (t.className || '').replace(/\b(wa-sidebar-compact|wa-sidebar-animating|wa-resizing-active)\b/g, '').trim();
            } else if (t === document.documentElement) {
                t.__waLastExternalStyle = (t.getAttribute('style') || '').replace(/--wa-[a-z0-9-]+\s*:[^;]+;?/gi, '').trim();
            }
            themeAttrObserver.observe(t, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
        }
    }

    var savedCompact = localStorage.getItem(STORAGE_KEY_COMPACT);
    if (savedCompact === 'true') {
        document.body.classList.add('wa-sidebar-compact');
        document.documentElement.style.setProperty('--wa-sidebar-width', '70px');
        applyCompactInline();
    } else {
        var initialWidth = getSavedWidth();
        setSidebarWidth(initialWidth, false);
    }

    initResizer();
    ensureToggleButton();
    syncAvatarTooltips();
    ensureMainResizeObserver();
    scheduleMainScaleUpdate();
    syncDynamicAccent();
    observeThemeRoots();
    syncResizerOverlayState(lastPointerX, lastPointerY);

    document.addEventListener('pointermove', onGlobalPointerMove, { passive: true, capture: true });
    document.addEventListener('pointerdown', onGlobalPointerDown, { capture: true });
    document.addEventListener('keydown', hideHoverTooltip, { passive: true, capture: true });
    document.addEventListener('mouseleave', hideHoverTooltip, { passive: true });
    window.addEventListener('blur', hideHoverTooltip);

    var mutationSyncRaf = null;
    var dirtyLayout = false;
    var dirtyOverlay = false;
    var dirtySideNav = false;
    var dirtyPaneSide = false;
    var dirtyMainChanged = false;
    var dirtyTheme = false;

    var POPUP_MUTATION_SELECTOR = '[data-animate-picker], [data-animate-modal-popup], [role="dialog"], [role="menu"], [role="listbox"], [role="tablist"], #wa-privacy-blur-overlay';

    function isInternalMutationNode(node) {
        if (!node || node.nodeType !== 1) return false;
        var id = node.id;
        if (id === 'wa-compact-hover-tooltip' ||
            id === 'wa-accent-probe' ||
            id === 'wa-dynamic-wds-overrides' ||
            id === 'wa-custom-resizer' ||
            id === 'wa-right-resizer') {
            return true;
        }
        return !!(node.classList && node.classList.contains('wa-alt-badge'));
    }

    function isInternalMutationRecord(mut) {
        var tgt = mut.target;
        if (!tgt) return false;
        if (isInternalMutationNode(tgt)) return true;
        if (mut.type === 'childList') {
            var added = mut.addedNodes;
            var removed = mut.removedNodes;
            var hasAny = (added && added.length > 0) || (removed && removed.length > 0);
            if (!hasAny) return true;
            if (added) {
                for (var a = 0; a < added.length; a++) {
                    if (!isInternalMutationNode(added[a])) return false;
                }
            }
            if (removed) {
                for (var r = 0; r < removed.length; r++) {
                    if (!isInternalMutationNode(removed[r])) return false;
                }
            }
            return true;
        }
        return false;
    }

    function nodeMatchesOverlayOrPopup(node) {
        if (!node || node.nodeType !== 1) return false;
        if (node.matches && (node.matches(POPUP_MUTATION_SELECTOR) || node.matches(OVERLAY_CHECK_SELECTOR))) {
            return true;
        }
        if (node.querySelector && node.querySelector(POPUP_MUTATION_SELECTOR)) {
            return true;
        }
        return false;
    }

    function scheduleMutationSync() {
        if (document.hidden) return;
        if (mutationSyncRaf) return;
        mutationSyncRaf = window.requestAnimationFrame(function() {
            mutationSyncRaf = null;
            if (document.hidden) return;
            var runLayout = dirtyLayout;
            var runOverlay = dirtyOverlay;
            var runSideNav = dirtySideNav;
            var runPaneSide = dirtyPaneSide;
            var runMainChanged = dirtyMainChanged;
            var runTheme = dirtyTheme;
            dirtyLayout = false;
            dirtyOverlay = false;
            dirtySideNav = false;
            dirtyPaneSide = false;
            dirtyMainChanged = false;
            dirtyTheme = false;

            var isAnimatingCompact = document.body && document.body.classList.contains('wa-sidebar-animating');
            if (runLayout || runSideNav) {
                ensureToggleButton();
            }
            if (!isAnimatingCompact && (runLayout || runSideNav || (runPaneSide && isCompactActive()))) {
                syncAvatarTooltips();
            }
            if (runLayout || runTheme) {
                observeThemeRoots();
            }
            if ((runLayout || runPaneSide || runSideNav) && window.__waEnsurePaneListeners) {
                window.__waEnsurePaneListeners();
            }
            if (!isAnimatingCompact) {
                if (runLayout) {
                    var c = resolveLayoutContainers();
                    if (c && c.flexContainer) {
                        syncAuxDrawers(c.flexContainer, c.sideColumn, c.mainColumn);
                    }
                    ensureRightResizer();
                    updateRightResizerPosition();
                    ensureMainResizeObserver();
                    if (!isCompactActive()) {
                        initResizer();
                        var sEl = document.querySelector('#side');
                        if (sEl && !sEl.__waWidthApplied) {
                            sEl.__waWidthApplied = true;
                            setSidebarWidth(currentSidebarWidth || getSavedWidth(), false);
                        }
                    } else if (document.querySelector('#side') &&
                               (!document.querySelector('[data-wa-side-column="true"]') ||
                                !document.querySelector('#side').__waCompactApplied)) {
                        applyCompactInline();
                    }
                    scheduleMainScaleUpdate();
                } else if (runMainChanged) {
                    ensureMainResizeObserver();
                    if (document.querySelector('[data-wa-right-column="true"]')) {
                        scheduleMainScaleUpdate();
                    }
                }
                if (runLayout || runTheme) {
                    scheduleAccentSync(false);
                }
            }
            if (runLayout || runOverlay) {
                scheduleResizerOverlayCheck();
            }
        });
    }

    var pendingPaneGreenTargets = [];
    var pendingPaneGreenTimer = null;
    var pendingSideGreenTargets = [];
    var pendingSideGreenRaf = null;

    function flushPendingPaneGreenTargets() {
        pendingPaneGreenTimer = null;
        if (document.hidden || !pendingPaneGreenTargets.length) {
            pendingPaneGreenTargets.length = 0;
            return;
        }
        var batch = pendingPaneGreenTargets.splice(0, 12);
        for (var i = 0; i < batch.length; i++) {
            if (batch[i] && batch[i].isConnected) {
                tagWhatsAppGreenSubtree(batch[i], 120);
            }
        }
        if (pendingPaneGreenTargets.length > 0 && !pendingPaneGreenTimer) {
            pendingPaneGreenTimer = setTimeout(flushPendingPaneGreenTargets, 80);
        }
    }

    function scheduleDeferredGreenTagging(paneTargets, sideTargets) {
        if (sideTargets.length > 0) {
            for (var s = 0; s < sideTargets.length && pendingSideGreenTargets.length < 24; s++) {
                if (pendingSideGreenTargets.indexOf(sideTargets[s]) === -1) {
                    pendingSideGreenTargets.push(sideTargets[s]);
                }
            }
            if (!pendingSideGreenRaf) {
                pendingSideGreenRaf = window.requestAnimationFrame(function() {
                    pendingSideGreenRaf = null;
                    if (document.hidden || !pendingSideGreenTargets.length) {
                        pendingSideGreenTargets.length = 0;
                        return;
                    }
                    var batch = pendingSideGreenTargets.splice(0, 24);
                    for (var i = 0; i < batch.length; i++) {
                        if (batch[i] && batch[i].isConnected) {
                            tagWhatsAppGreenSubtree(batch[i], 120);
                        }
                    }
                });
            }
        }
        if (paneTargets.length > 0) {
            for (var p = 0; p < paneTargets.length && pendingPaneGreenTargets.length < 24; p++) {
                if (pendingPaneGreenTargets.indexOf(paneTargets[p]) === -1) {
                    pendingPaneGreenTargets.push(paneTargets[p]);
                }
            }
            if (pendingPaneGreenTimer !== null) {
                clearTimeout(pendingPaneGreenTimer);
            }
            pendingPaneGreenTimer = setTimeout(flushPendingPaneGreenTargets, 140);
        }
    }

    var observer = new MutationObserver(function(mutations) {
        if (document.hidden) return;
        var onlyInternal = mutations.length > 0;
        var mainEl = document.getElementById('main');
        var mainColEl = (cachedMainColumn && cachedMainColumn.isConnected)
            ? cachedMainColumn
            : document.querySelector('[data-wa-main-column="true"]');
        var paneSideEl = document.getElementById('pane-side');
        var sideEl = document.getElementById('side');
        var mainHeaderEl = mainEl ? mainEl.querySelector('header') : null;
        var mainFooterEl = mainEl ? mainEl.querySelector('footer') : null;
        var tabShellEl = document.querySelector('[data-wa-tab-shell="true"]');
        var rightColEl = document.querySelector('[data-wa-right-column="true"]');
        var hasAddedPopupOrMain = false;
        var isOpeningPickerNow = performance.now() < pickerOpeningUntil;
        var isAnimatingNow = document.body && document.body.classList.contains('wa-sidebar-animating');
        var addedPaneGreenTargets = [];
        var addedSideGreenTargets = [];
        var layoutInitialized = !!(sideEl && mainColEl && (sideEl.__waWidthApplied || sideEl.__waCompactApplied));

        for (var m = 0; m < mutations.length; m++) {
            var mut = mutations[m];
            if (isInternalMutationRecord(mut)) continue;
            onlyInternal = false;

            var tgt = mut.target;
            var inPaneSide = !!(tgt && paneSideEl && (tgt === paneSideEl || paneSideEl.contains(tgt)));
            var inMain = !!(tgt && mainEl && (tgt === mainEl || mainEl.contains(tgt)));
            var inMainCol = !inMain && !!(tgt && mainColEl && (tgt === mainColEl || mainColEl.contains(tgt)));
            var inSide = !inPaneSide && !!(tgt && sideEl && (tgt === sideEl || sideEl.contains(tgt)));
            var inTabShell = !!(tgt && tabShellEl && (tgt === tabShellEl || tabShellEl.contains(tgt)));
            var inRightCol = !!(tgt && rightColEl && (tgt === rightColEl || rightColEl.contains(tgt)));

            if (!layoutInitialized) {
                dirtyLayout = true;
            }

            if (inPaneSide) {
                dirtyPaneSide = true;
            } else if (inMain) {
                if (tgt === mainEl || (mainHeaderEl && (tgt === mainHeaderEl || mainHeaderEl.contains(tgt)))) {
                    dirtyMainChanged = true;
                    dirtyTheme = true;
                } else if (mainFooterEl && (tgt === mainFooterEl || mainFooterEl.contains(tgt))) {
                    if (isOpeningPickerNow || !(tgt.closest && tgt.closest('[contenteditable="true"], [role="textbox"]'))) {
                        dirtyOverlay = true;
                    }
                }
            } else if (inMainCol) {
                dirtyMainChanged = true;
                dirtyTheme = true;
                if (isOpeningPickerNow) {
                    dirtyOverlay = true;
                }
            } else if (inSide) {
                dirtySideNav = true;
            } else if (inTabShell) {
                if (tgt === tabShellEl || !tabShellEl.querySelector('[data-wa-tab-side-column="true"]')) {
                    dirtyLayout = true;
                }
            } else if (inRightCol) {
                // Si se desmonta o vacia el contenido del panel derecho al cerrarlo, resincronizar layout
                if (mut.removedNodes && mut.removedNodes.length > 0 &&
                    (tgt === rightColEl ||
                     rightColEl.childElementCount === 0 ||
                     !rightColEl.querySelector('header, section, button, [role="button"], input, img, svg'))) {
                    dirtyLayout = true;
                }
            } else {
                var isLiveRegion = !!(tgt && tgt.nodeType === 1 &&
                    ((tgt.getAttribute && (tgt.getAttribute('aria-live') || tgt.getAttribute('role') === 'status' || tgt.getAttribute('role') === 'alert')) ||
                     (tgt.closest && tgt.closest('[aria-live], [role="status"], [role="alert"]'))));
                if (!isLiveRegion) {
                    dirtyLayout = true;
                    dirtyOverlay = true;
                }
            }

            if (mut.addedNodes && mut.addedNodes.length > 0) {
                for (var an = 0; an < mut.addedNodes.length; an++) {
                    var added = mut.addedNodes[an];
                    if (!added || added.nodeType !== 1 || isInternalMutationNode(added)) continue;
                    if (added.id === 'main') {
                        dirtyMainChanged = true;
                        dirtyTheme = true;
                        if (!mainColEl) dirtyLayout = true;
                    } else if (added.id === 'side' || added.id === 'pane-side') {
                        dirtyLayout = true;
                        dirtySideNav = true;
                        dirtyTheme = true;
                    } else if (!inPaneSide && added.querySelector && added.querySelector('#main')) {
                        dirtyMainChanged = true;
                        dirtyTheme = true;
                        if (!mainColEl) dirtyLayout = true;
                    }

                    if (isOpeningPickerNow ||
                        (!inPaneSide && nodeMatchesOverlayOrPopup(added)) ||
                        (inPaneSide && added.matches && added.matches(POPUP_MUTATION_SELECTOR))) {
                        hasAddedPopupOrMain = true;
                        dirtyOverlay = true;
                    }

                    if (!isAnimatingNow) {
                        if (inPaneSide) {
                            if (addedPaneGreenTargets.length < 24) {
                                addedPaneGreenTargets.push(added);
                            }
                        } else if (addedSideGreenTargets.length < 24 && added.closest &&
                            added.closest('#side, [data-wa-nav-rail="true"], [data-wa-side-column="true"], [data-wa-tab-side-column="true"], [data-wa-left-drawer="true"], #app > div > header')) {
                            addedSideGreenTargets.push(added);
                        }
                    }
                }
            }

            if (mut.removedNodes && mut.removedNodes.length > 0 && (!dirtyOverlay || (!dirtyLayout && !inPaneSide && !inMain))) {
                for (var rn = 0; rn < mut.removedNodes.length; rn++) {
                    var rem = mut.removedNodes[rn];
                    if (!rem || rem.nodeType !== 1 || isInternalMutationNode(rem)) continue;
                    if (!dirtyOverlay && !inPaneSide && nodeMatchesOverlayOrPopup(rem)) {
                        dirtyOverlay = true;
                    }
                    if (!dirtyLayout && !inPaneSide && !inMain &&
                        (rem.id === 'side' ||
                         (rem.getAttribute && (rem.getAttribute('data-wa-tab-shell') === 'true' ||
                                               rem.getAttribute('data-wa-tab-side-column') === 'true' ||
                                               rem.getAttribute('data-wa-right-column') === 'true' ||
                                               rem.getAttribute('data-wa-left-drawer') === 'true')))) {
                        dirtyLayout = true;
                    }
                    if (dirtyOverlay && (dirtyLayout || inPaneSide || inMain)) break;
                }
            }
        }
        if (onlyInternal) return;

        // Diferir el etiquetado de verdes fuera del microtask de MutationObserver:
        // en #pane-side se agrupa tras 140ms para cero bloqueos durante scroll activo.
        if (addedPaneGreenTargets.length > 0 || addedSideGreenTargets.length > 0) {
            scheduleDeferredGreenTagging(addedPaneGreenTargets, addedSideGreenTargets);
        }

        // Pre-paint clamping en microtask para evitar que el picker de emojis pinte fuera de pantalla en el frame 1
        if (hasAddedPopupOrMain) {
            syncFloatingPickerBounds();
        }

        scheduleMutationSync();
    });

    var mainObserverConnected = false;
    var visualObserversPaused = false;

    function connectMainObserver() {
        if (mainObserverConnected || !document.body) return;
        observer.observe(document.body, { childList: true, subtree: true });
        mainObserverConnected = true;
    }

    function pauseVisualObservers() {
        if (visualObserversPaused) return;
        visualObserversPaused = true;
        if (mainObserverConnected) {
            observer.disconnect();
            mainObserverConnected = false;
        }
        if (mutationSyncRaf) {
            window.cancelAnimationFrame(mutationSyncRaf);
            mutationSyncRaf = null;
        }
        if (pendingPaneGreenTimer !== null) {
            clearTimeout(pendingPaneGreenTimer);
            pendingPaneGreenTimer = null;
        }
        pendingPaneGreenTargets.length = 0;
        if (pendingSideGreenRaf) {
            window.cancelAnimationFrame(pendingSideGreenRaf);
            pendingSideGreenRaf = null;
        }
        pendingSideGreenTargets.length = 0;
        disconnectMainResizeObserver();
        disconnectPanelResizeObservers();
        hideHoverTooltip();
    }

    function resumeVisualObservers() {
        if (!visualObserversPaused) return;
        visualObserversPaused = false;
        connectMainObserver();
        dirtyLayout = true;
        dirtyOverlay = true;
        dirtySideNav = true;
        dirtyTheme = true;
        scheduleMutationSync();
    }

    if (document.hidden) {
        visualObserversPaused = true;
    } else {
        connectMainObserver();
    }

    document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
            pauseVisualObservers();
        } else {
            resumeVisualObservers();
        }
    });

    window.addEventListener('resize', function() {
        if (document.hidden) return;
        hideHoverTooltip();
        syncFloatingPickerBounds();
        if (!isCompactActive()) {
            var curWidth = getSavedWidth();
            setSidebarWidth(curWidth, false);
        }
        if (document.querySelector('[data-wa-right-column="true"]')) {
            setRightPanelWidth(getSavedRightWidth(), false);
        } else {
            updateRightResizerPosition();
            scheduleMainScaleUpdate();
        }
        scheduleMainScaleUpdate();
        scheduleResizerOverlayCheck();
    });
})();
