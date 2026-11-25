/* Modulo JS 3: layout_columns.js
 * Responsabilidad: resolucion de contenedores flex y columnas (#side, #main, panel derecho),
 * soporte Tab Shell multi-pestana, sincronizacion de drawers auxiliares y host nativo de bordes (CH[2]),
 * gestion de anchos de barra lateral y panel derecho, escalado adaptativo (#main y contenido P10),
 * ResizeObserver de layout y diagnostico __waInspectLayout.
 * Dependencias: window.__waApp.core (exclusivamente).
 */
(function() {
    'use strict';
    var app = window.__waApp = window.__waApp || {};
    if (app.layout) return;
    var core = app.core;
    if (!core) return;

    var MIN_WIDTH = core.MIN_WIDTH;
    var DEFAULT_WIDTH = core.DEFAULT_WIDTH;
    var MIN_RIGHT_WIDTH = core.MIN_RIGHT_WIDTH;
    var DEFAULT_RIGHT_WIDTH = core.DEFAULT_RIGHT_WIDTH;
    var MAIN_SCALE_THRESHOLD = core.MAIN_SCALE_THRESHOLD;
    var MAIN_SCALE_MIN = core.MAIN_SCALE_MIN;

    var getMaxWidth = core.getMaxWidth;
    var getSavedWidth = core.getSavedWidth;
    var isCompactActive = core.isCompactActive;

    var currentSidebarWidth = getSavedWidth();
    var cachedSideColumn = null;
    var cachedMainColumn = null;
    var cachedFlexContainer = null;
    var currentMainScale = 1;
    var mainScaleRafPending = false;
    var rightPanelResizeLocked = false;
    var layoutChangeListeners = [];

    function onLayoutChange(listener) {
        if (typeof listener !== 'function') {
            return function() {};
        }
        if (layoutChangeListeners.indexOf(listener) === -1) {
            layoutChangeListeners.push(listener);
        }
        return function() {
            offLayoutChange(listener);
        };
    }

    function offLayoutChange(listener) {
        var idx = layoutChangeListeners.indexOf(listener);
        if (idx !== -1) {
            layoutChangeListeners.splice(idx, 1);
        }
    }

    function emitLayoutChange(event) {
        for (var i = 0; i < layoutChangeListeners.length; i++) {
            try {
                layoutChangeListeners[i](event);
            } catch (err) {}
        }
    }

    function getCurrentSidebarWidth() {
        return currentSidebarWidth;
    }

    function getCurrentMainScale() {
        return currentMainScale;
    }

    function getCachedContainers() {
        return {
            sideColumn: cachedSideColumn,
            mainColumn: cachedMainColumn,
            flexContainer: cachedFlexContainer
        };
    }

    function setRightPanelResizeLock(locked) {
        rightPanelResizeLocked = !!locked;
    }

    function isRightPanelResizeLocked() {
        return rightPanelResizeLocked;
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

    function inspectLayout() {
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
    }

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
                mainEl = document.querySelector('#main');
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
        return core.getSavedRightWidth(getMaxRightWidth());
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
            core.saveRightWidth(clamped);
        }

        emitLayoutChange({
            type: 'right-width',
            width: clamped,
            persisted: !!persist
        });
        scheduleMainScaleUpdate();
        return clamped;
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

    function syncAuxDrawers(container, sideCol, mainCol, options) {
        if (!container) return null;
        resetHorizontalScrollLock(container);
        var preserveRightCol = !!(rightPanelResizeLocked || (options && options.preserveRightWidth));
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

            if (!hasRealContent && child.getAttribute('data-wa-right-column') === 'true' && preserveRightCol) {
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

                if (!preserveRightCol) {
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

        var syncResult = {
            hasRightCol: hasRightCol,
            activeTabShell: activeTabShell,
            activeLeftDrawer: activeLeftDrawer,
            tabShellChanged: wasTabShellActive !== activeTabShell,
            leftDrawerChanged: wasLeftDrawerActive !== activeLeftDrawer
        };
        emitLayoutChange({
            type: 'aux-drawers',
            hasRightCol: syncResult.hasRightCol,
            activeTabShell: syncResult.activeTabShell,
            activeLeftDrawer: syncResult.activeLeftDrawer,
            tabShellChanged: syncResult.tabShellChanged,
            leftDrawerChanged: syncResult.leftDrawerChanged
        });
        return syncResult;
    }

    function setSidebarWidth(width, persist, options) {
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

            syncAuxDrawers(containers.flexContainer, sideCol, mainCol, options);
            didSyncAux = true;
        }

        if (persist) {
            core.saveWidth(clamped);
        }

        emitLayoutChange({
            type: 'sidebar-width',
            width: clamped,
            persisted: !!persist,
            syncedAuxDrawers: didSyncAux
        });
        scheduleMainScaleUpdate();
        return clamped;
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

    window.__waInspectLayout = inspectLayout;

    app.layout = {
        PANEL_ADAPTIVE_SELECTOR: PANEL_ADAPTIVE_SELECTOR,
        PANEL_VISUAL_SCALE_MIN: PANEL_VISUAL_SCALE_MIN,
        onLayoutChange: onLayoutChange,
        offLayoutChange: offLayoutChange,
        getCurrentSidebarWidth: getCurrentSidebarWidth,
        getCurrentMainScale: getCurrentMainScale,
        getCachedContainers: getCachedContainers,
        setRightPanelResizeLock: setRightPanelResizeLock,
        isRightPanelResizeLocked: isRightPanelResizeLocked,
        resetHorizontalScrollLock: resetHorizontalScrollLock,
        clearAuxInlineStyles: clearAuxInlineStyles,
        applyMainColumnFlexStyles: applyMainColumnFlexStyles,
        applyWrapperPassThroughStyles: applyWrapperPassThroughStyles,
        splitMultiColumnWrapper: splitMultiColumnWrapper,
        applyTabShellLayout: applyTabShellLayout,
        resolveLayoutContainers: resolveLayoutContainers,
        resolveLeftResizeTarget: resolveLeftResizeTarget,
        getMaxRightWidth: getMaxRightWidth,
        getSavedRightWidth: getSavedRightWidth,
        applyRightColumnInlineWidth: applyRightColumnInlineWidth,
        setRightPanelWidth: setRightPanelWidth,
        syncAuxDrawers: syncAuxDrawers,
        setSidebarWidth: setSidebarWidth,
        updateMainAdaptiveScale: updateMainAdaptiveScale,
        updatePanelAdaptiveContent: updatePanelAdaptiveContent,
        scheduleMainScaleUpdate: scheduleMainScaleUpdate,
        ensureMainResizeObserver: ensureMainResizeObserver,
        disconnectMainResizeObserver: disconnectMainResizeObserver,
        inspectLayout: inspectLayout
    };
})();
