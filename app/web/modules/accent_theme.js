/* Modulo JS 2: accent_theme.js
 * Responsabilidad: motor unico de deteccion, normalizacion y aplicacion de acentos dinamicos,
 * remapeo dinamico de variables WDS/nativas, contraste de primer plano, etiquetado diferido
 * de acentos verdes y observador de atributos de tema.
 * Dependencias: window.__waApp.core (exclusivamente).
 */
(function() {
    'use strict';
    var app = window.__waApp = window.__waApp || {};
    if (app.accent) return;
    var core = app.core;
    if (!core) return;

    var parseCssColor = core.parseCssColor;
    var rgbToHsl = core.rgbToHsl;
    var rgbToHue = core.rgbToHue;
    var hslToRgb = core.hslToRgb;
    var contrastRatio = core.contrastRatio;

    var PROBE_ELEMENT_ID = 'wa-accent-probe';
    var WDS_STYLE_ELEMENT_ID = 'wa-dynamic-wds-overrides';

    var lastAppliedAccent = '';
    var lastAppliedAccentFg = '';
    var lastMainThemeAccent = core.getSavedThemeAccent();
    var accentProbeEl = null;

    var discoveredWdsVarRuleText = '';
    var wdsCandidateVarNames = null;
    var wdsCandidateSheetCount = -1;

    var lastAccentContextSig = '';
    var lastWdsThemeSig = '';
    var paletteSyncTimer = null;

    var pendingPaneGreenTargets = [];
    var pendingPaneGreenTimer = null;
    var pendingSideGreenTargets = [];
    var pendingSideGreenRaf = null;

    function isInternalNode(node) {
        if (!node || node.nodeType !== 1) return false;
        var id = node.id;
        return id === PROBE_ELEMENT_ID || id === WDS_STYLE_ELEMENT_ID;
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
        return core.saveThemeAccent(col);
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
        var mainCol = probeMainChatThemeAccent();
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
        accentProbeEl = document.getElementById(PROBE_ELEMENT_ID);
        if (!accentProbeEl) {
            accentProbeEl = document.createElement('span');
            accentProbeEl.id = PROBE_ELEMENT_ID;
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

        // 4. Check #main theme vars first, then global root candidates
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
        var styleEl = document.getElementById(WDS_STYLE_ELEMENT_ID);
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
            styleEl.id = WDS_STYLE_ELEMENT_ID;
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
        var existingWdsStyle = document.getElementById(WDS_STYLE_ELEMENT_ID);
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

    function detectAndApplyAccent() {
        syncThemePalette(false, true);
        if (!discoveredWdsVarRuleText) {
            tagWhatsAppGreenAccents();
        }
        return {
            accent: lastAppliedAccent,
            fg: lastAppliedAccentFg
        };
    }

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
        if (sideTargets && sideTargets.length > 0) {
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
        if (paneTargets && paneTargets.length > 0) {
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

    function clearDeferredGreenTagging() {
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
    }

    function getAppliedAccent() {
        return {
            accent: lastAppliedAccent,
            fg: lastAppliedAccentFg
        };
    }

    function hasDiscoveredWdsVars() {
        return !!discoveredWdsVarRuleText;
    }

    function invalidateWdsCache() {
        discoveredWdsVarRuleText = '';
    }

    window.__waDetectAndApplyAccent = detectAndApplyAccent;

    app.accent = {
        PROBE_ELEMENT_ID: PROBE_ELEMENT_ID,
        WDS_STYLE_ELEMENT_ID: WDS_STYLE_ELEMENT_ID,
        isInternalNode: isInternalNode,
        isAchromaticColor: isAchromaticColor,
        isUiDarkMode: isUiDarkMode,
        isValidNeutralThemeColor: isValidNeutralThemeColor,
        isValidAccentColor: isValidAccentColor,
        normalizeAccent: normalizeAccent,
        probeMainChatThemeAccent: probeMainChatThemeAccent,
        probeAccentFromDom: probeAccentFromDom,
        detectDynamicAccent: detectDynamicAccent,
        resolveNativeBadgeFg: resolveNativeBadgeFg,
        ensureLegibleAccentFg: ensureLegibleAccentFg,
        isWhatsAppGreenColor: isWhatsAppGreenColor,
        deriveAccentPalette: deriveAccentPalette,
        syncDynamicWdsCssVars: syncDynamicWdsCssVars,
        tagWhatsAppGreenSubtree: tagWhatsAppGreenSubtree,
        tagWhatsAppGreenAccents: tagWhatsAppGreenAccents,
        syncThemePalette: syncThemePalette,
        syncDynamicAccent: syncDynamicAccent,
        detectAndApplyAccent: detectAndApplyAccent,
        scheduleAccentSync: scheduleAccentSync,
        observeThemeRoots: observeThemeRoots,
        scheduleDeferredGreenTagging: scheduleDeferredGreenTagging,
        clearDeferredGreenTagging: clearDeferredGreenTagging,
        getAppliedAccent: getAppliedAccent,
        hasDiscoveredWdsVars: hasDiscoveredWdsVars,
        invalidateWdsCache: invalidateWdsCache
    };
})();
