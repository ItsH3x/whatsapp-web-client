/* Modulo JS 4: resizers_overlays.js
 * Responsabilidad: gestion de divisores arrastrables (#wa-custom-resizer, #wa-custom-right-resizer),
 * arrastre izquierdo/derecho, ResizeObservers de paneles, deteccion de cobertura por overlays/modales,
 * snapshot de overlays, pre-paint clamping de pickers flotantes y ventana temporal pickerOpeningUntil.
 * Dependencias: window.__waApp.core y window.__waApp.layout (exclusivamente).
 */
(function() {
    'use strict';
    var app = window.__waApp = window.__waApp || {};
    if (app.resizers) return;
    var core = app.core;
    var layout = app.layout;
    if (!core || !layout) return;

    var OVERLAY_CHECK_SELECTOR = core.OVERLAY_CHECK_SELECTOR;
    var isCompactActive = core.isCompactActive;
    var isElementVisible = core.isElementVisible;
    var isPopupCandidatePresent = core.isPopupCandidatePresent;
    var rectsIntersect = core.rectsIntersect;

    var LEFT_RESIZER_ID = 'wa-custom-resizer';
    var RIGHT_RESIZER_ID = 'wa-custom-right-resizer';
    var FLOATING_PANEL_SELECTOR = '[role="dialog"], [role="menu"], [role="listbox"], [data-animate-picker], [data-animate-dropdown-item], [data-animate-modal-popup]';
    var OVERLAY_EXCLUDE_SELECTOR = '[data-wa-right-column="true"], [data-wa-left-drawer="true"], [data-wa-tab-shell="true"], [data-wa-tab-side-column="true"]';
    var POPUP_MUTATION_SELECTOR = '[data-animate-picker], [data-animate-modal-popup], [role="dialog"], [role="menu"], [role="listbox"], [role="tablist"], #wa-privacy-blur-overlay';
    var POINTER_NEAR_THRESHOLD_PX = 40;
    var PICKER_OPENING_DURATION_MS = 500;

    var leftDragging = false;
    var resizerElement = null;
    var rafPending = false;
    var targetClientX = 0;

    var rightDragging = false;
    var rightResizerElement = null;
    var rightRafPending = false;
    var rightTargetClientX = 0;

    var overlayCheckRafPending = false;
    var overlayCheckRafId = 0;
    var lastPointerX = null;
    var lastPointerY = null;
    var pickerOpeningUntil = 0;

    var rightPanelResizeObserver = null;
    var rightPanelObservedTarget = null;
    var leftPanelResizeObserver = null;
    var leftPanelObservedTarget = null;

    var dragStateListeners = [];
    var layoutSyncUnsubscribe = null;

    function onDragStateChange(listener) {
        if (typeof listener !== 'function') {
            return function() {};
        }
        if (dragStateListeners.indexOf(listener) === -1) {
            dragStateListeners.push(listener);
        }
        return function() {
            offDragStateChange(listener);
        };
    }

    function offDragStateChange(listener) {
        var idx = dragStateListeners.indexOf(listener);
        if (idx !== -1) {
            dragStateListeners.splice(idx, 1);
        }
    }

    function emitDragStateChange(event) {
        for (var i = 0; i < dragStateListeners.length; i++) {
            try {
                dragStateListeners[i](event);
            } catch (err) {}
        }
    }

    function isInternalNode(node) {
        if (!node || node.nodeType !== 1) return false;
        return node.id === LEFT_RESIZER_ID || node.id === RIGHT_RESIZER_ID;
    }

    function isLeftDragging() {
        return leftDragging;
    }

    function isRightDragging() {
        return rightDragging;
    }

    function isDragging() {
        return leftDragging || rightDragging;
    }

    function getResizerElements() {
        return {
            left: resizerElement,
            right: rightResizerElement
        };
    }

    function getLastPointerPosition() {
        return {
            x: lastPointerX,
            y: lastPointerY
        };
    }

    function markPickerOpening(durationMs) {
        var ms = (typeof durationMs === 'number' && isFinite(durationMs) && durationMs > 0)
            ? durationMs
            : PICKER_OPENING_DURATION_MS;
        pickerOpeningUntil = performance.now() + ms;
        return pickerOpeningUntil;
    }

    function isPickerOpening() {
        return performance.now() < pickerOpeningUntil;
    }

    function getPickerOpeningUntil() {
        return pickerOpeningUntil;
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
            if (explicitOverlay && !explicitOverlay.closest(OVERLAY_EXCLUDE_SELECTOR) && isElementVisible(explicitOverlay)) {
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
        var opening = isPickerOpening();
        var selector = '[data-animate-picker], [data-animate-modal-popup], [data-animate-dropdown-item], ' +
            '[role="dialog"], [role="menu"], [role="listbox"], #main [role="tablist"], #app > div > span [role="tablist"], #app > div > div [role="tablist"]';
        if (opening) {
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
            } else if (opening) {
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
        if (resizerElement && !leftDragging) {
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
        if (rightResizerElement && !rightDragging) {
            var rightCovered = hasFloatingOverlay ? true : isResizerCovered(rightResizerElement, clientX, clientY, false, overlaySnap);
            applyResizerDisabledState(rightResizerElement, rightCovered);
        }
    }

    function cancelScheduledOverlayCheck() {
        if (overlayCheckRafPending && overlayCheckRafId) {
            window.cancelAnimationFrame(overlayCheckRafId);
        }
        overlayCheckRafPending = false;
        overlayCheckRafId = 0;
    }

    function scheduleResizerOverlayCheck() {
        if (document.hidden) return;
        if (overlayCheckRafPending) return;
        overlayCheckRafPending = true;
        overlayCheckRafId = window.requestAnimationFrame(function() {
            overlayCheckRafPending = false;
            overlayCheckRafId = 0;
            if (document.hidden) return;
            syncResizerOverlayState(lastPointerX, lastPointerY);
        });
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

    function hideLeftResizer() {
        if (!resizerElement) return;
        resizerElement.style.display = 'none';
        resizerElement.style.left = '-9999px';
    }

    function updateLeftResizerPosition() {
        if (!resizerElement) return;

        var target = layout.resolveLeftResizeTarget();
        if (!target) {
            hideLeftResizer();
            return;
        }
        var isTabOrDrawerTarget = target.element.getAttribute('data-wa-tab-side-column') === 'true' ||
                                  target.element.getAttribute('data-wa-left-drawer') === 'true';
        if (isCompactActive() && !isTabOrDrawerTarget) {
            hideLeftResizer();
            return;
        }

        resizerElement.style.display = 'block';
        resizerElement.style.top = target.rect.top + 'px';
        resizerElement.style.height = target.rect.height + 'px';
        resizerElement.style.left = target.rect.right + 'px';
    }

    function updateRightResizerPosition() {
        if (!rightResizerElement) return;
        if (rightDragging) {
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
        layout.scheduleMainScaleUpdate();
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

        leftDragging = true;
        emitDragStateChange({ type: 'drag-start', side: 'left' });
        if (resizerElement) {
            resizerElement.classList.add('is-resizing');
        }
        document.documentElement.classList.add('wa-resizing-active');

        window.addEventListener('mousemove', onMouseMove, { passive: false, capture: true });
        window.addEventListener('mouseup', onMouseUp, { once: true, capture: true });
    }

    function onMouseMove(e) {
        if (!leftDragging) return;
        e.preventDefault();
        targetClientX = e.clientX;

        if (!rafPending) {
            rafPending = true;
            window.requestAnimationFrame(function() {
                rafPending = false;
                if (!leftDragging) return;

                var target = layout.resolveLeftResizeTarget();
                if (!target) return;

                var sideLeft = target.rect.left;
                var calculatedWidth = targetClientX - sideLeft;

                layout.setSidebarWidth(calculatedWidth, false);
            });
        }
    }

    function onMouseUp() {
        if (!leftDragging) return;
        leftDragging = false;

        if (resizerElement) {
            resizerElement.classList.remove('is-resizing');
        }
        document.documentElement.classList.remove('wa-resizing-active');

        window.removeEventListener('mousemove', onMouseMove, { capture: true });

        var target = layout.resolveLeftResizeTarget();
        if (target) {
            var currentWidth = Math.round(target.rect.width);
            layout.setSidebarWidth(currentWidth, true);
        }
        emitDragStateChange({ type: 'drag-end', side: 'left' });
    }

    function onRightMouseDown(e) {
        if (e.button !== 0) return;
        syncResizerOverlayState(e.clientX, e.clientY);
        if (rightResizerElement && rightResizerElement.classList.contains('wa-resizer-disabled')) {
            return;
        }
        var rightCol = document.querySelector('[data-wa-right-column="true"]');
        if (!rightCol) return;

        e.preventDefault();
        rightDragging = true;
        layout.setRightPanelResizeLock(true);
        emitDragStateChange({ type: 'drag-start', side: 'right' });
        if (rightResizerElement) {
            rightResizerElement.classList.add('is-resizing');
        }
        document.documentElement.classList.add('wa-resizing-active');

        window.addEventListener('mousemove', onRightMouseMove, { passive: false, capture: true });
        window.addEventListener('mouseup', onRightMouseUp, { once: true, capture: true });
    }

    function onRightMouseMove(e) {
        if (!rightDragging) return;
        e.preventDefault();
        rightTargetClientX = e.clientX;

        if (!rightRafPending) {
            rightRafPending = true;
            window.requestAnimationFrame(function() {
                rightRafPending = false;
                if (!rightDragging) return;

                var rightCol = document.querySelector('[data-wa-right-column="true"]');
                if (!rightCol) return;

                var rightEdge = rightCol.getBoundingClientRect().right;
                var calculatedWidth = rightEdge - rightTargetClientX;
                layout.setRightPanelWidth(calculatedWidth, false);
            });
        }
    }

    function onRightMouseUp() {
        if (!rightDragging) return;
        rightDragging = false;
        layout.setRightPanelResizeLock(false);

        if (rightResizerElement) {
            rightResizerElement.classList.remove('is-resizing');
        }
        document.documentElement.classList.remove('wa-resizing-active');

        window.removeEventListener('mousemove', onRightMouseMove, { capture: true });

        var rightCol = document.querySelector('[data-wa-right-column="true"]');
        if (rightCol) {
            var currentWidth = Math.round(rightCol.getBoundingClientRect().width);
            layout.setRightPanelWidth(currentWidth, true);
        }
        emitDragStateChange({ type: 'drag-end', side: 'right' });
    }

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
            rightResizerElement = document.getElementById(RIGHT_RESIZER_ID);
            if (!rightResizerElement) {
                rightResizerElement = document.createElement('div');
                rightResizerElement.id = RIGHT_RESIZER_ID;
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
                    if (!rightDragging) {
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

        layout.resolveLayoutContainers();

        if (!resizerElement || !document.body.contains(resizerElement)) {
            resizerElement = document.getElementById(LEFT_RESIZER_ID);
            if (!resizerElement) {
                resizerElement = document.createElement('div');
                resizerElement.id = LEFT_RESIZER_ID;
                resizerElement.setAttribute('role', 'separator');
                resizerElement.setAttribute('aria-orientation', 'vertical');
                resizerElement.setAttribute('title', 'Arrastra para redimensionar el panel lateral');
                document.body.appendChild(resizerElement);
            }
            resizerElement.removeEventListener('mousedown', onMouseDown);
            resizerElement.addEventListener('mousedown', onMouseDown);
        }

        ensureRightResizer();

        var containers = layout.resolveLayoutContainers();
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
                        if (!leftDragging) {
                            updateLeftResizerPosition();
                        }
                        if (!rightDragging) {
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

    function isPointerNearResizer(clientX) {
        if (typeof clientX !== 'number') return false;
        if (resizerElement && resizerElement.style.display !== 'none') {
            var lLeft = parseFloat(resizerElement.style.left);
            if (!isNaN(lLeft) && lLeft > -100 && Math.abs(clientX - lLeft) <= POINTER_NEAR_THRESHOLD_PX) {
                return true;
            }
        }
        if (rightResizerElement && rightResizerElement.style.display !== 'none') {
            var rLeft = parseFloat(rightResizerElement.style.left);
            if (!isNaN(rLeft) && rLeft > -100 && Math.abs(clientX - rLeft) <= POINTER_NEAR_THRESHOLD_PX) {
                return true;
            }
        }
        return false;
    }

    function handlePointerMove(clientX, clientY) {
        lastPointerX = clientX;
        lastPointerY = clientY;
        if (!leftDragging && !rightDragging && isPointerNearResizer(clientX)) {
            scheduleResizerOverlayCheck();
        }
    }

    function handlePointerDown(e) {
        if (!e || !e.isTrusted) return;
        lastPointerX = e.clientX;
        lastPointerY = e.clientY;
        var tgt = e.target;
        if (tgt && tgt.closest && tgt.closest('#main footer')) {
            markPickerOpening(PICKER_OPENING_DURATION_MS);
        }
        if (!leftDragging && !rightDragging) {
            syncResizerOverlayState(e.clientX, e.clientY);
        }
    }

    function handleLayoutChange(ev) {
        if (!ev) return;
        if (ev.type === 'aux-drawers') {
            if (ev.hasRightCol) {
                ensureRightResizer();
            }
            updateResizerPosition();
            if (ev.tabShellChanged || ev.leftDrawerChanged) {
                syncResizerOverlayState();
            }
        } else if (ev.type === 'sidebar-width') {
            if (!ev.syncedAuxDrawers) {
                updateResizerPosition();
            }
        } else if (ev.type === 'right-width') {
            updateRightResizerPosition();
        }
    }

    function bindLayoutSync() {
        if (layoutSyncUnsubscribe) return layoutSyncUnsubscribe;
        layoutSyncUnsubscribe = layout.onLayoutChange(handleLayoutChange);
        return layoutSyncUnsubscribe;
    }

    function unbindLayoutSync() {
        if (layoutSyncUnsubscribe) {
            layoutSyncUnsubscribe();
            layoutSyncUnsubscribe = null;
        }
    }

    app.resizers = {
        LEFT_RESIZER_ID: LEFT_RESIZER_ID,
        RIGHT_RESIZER_ID: RIGHT_RESIZER_ID,
        FLOATING_PANEL_SELECTOR: FLOATING_PANEL_SELECTOR,
        OVERLAY_EXCLUDE_SELECTOR: OVERLAY_EXCLUDE_SELECTOR,
        POPUP_MUTATION_SELECTOR: POPUP_MUTATION_SELECTOR,
        POINTER_NEAR_THRESHOLD_PX: POINTER_NEAR_THRESHOLD_PX,
        PICKER_OPENING_DURATION_MS: PICKER_OPENING_DURATION_MS,
        onDragStateChange: onDragStateChange,
        offDragStateChange: offDragStateChange,
        bindLayoutSync: bindLayoutSync,
        unbindLayoutSync: unbindLayoutSync,
        isInternalNode: isInternalNode,
        isLeftDragging: isLeftDragging,
        isRightDragging: isRightDragging,
        isDragging: isDragging,
        getResizerElements: getResizerElements,
        getLastPointerPosition: getLastPointerPosition,
        markPickerOpening: markPickerOpening,
        isPickerOpening: isPickerOpening,
        getPickerOpeningUntil: getPickerOpeningUntil,
        isLayoutColumnOrAncestor: isLayoutColumnOrAncestor,
        isPointCoveredByOverlay: isPointCoveredByOverlay,
        computeUnscaledHorizontalBounds: computeUnscaledHorizontalBounds,
        isFloatingPickerHost: isFloatingPickerHost,
        isFloatingHostEligible: isFloatingHostEligible,
        clampFloatingPickerViewport: clampFloatingPickerViewport,
        attachPopupHostStyleObserver: attachPopupHostStyleObserver,
        resolveFloatingPopupHost: resolveFloatingPopupHost,
        syncFloatingPickerBounds: syncFloatingPickerBounds,
        hasActiveFloatingPickerOrModal: hasActiveFloatingPickerOrModal,
        collectOverlayStateSnapshot: collectOverlayStateSnapshot,
        isFloatingPanelOverResizer: isFloatingPanelOverResizer,
        isResizerCovered: isResizerCovered,
        applyResizerDisabledState: applyResizerDisabledState,
        syncResizerOverlayState: syncResizerOverlayState,
        scheduleResizerOverlayCheck: scheduleResizerOverlayCheck,
        cancelScheduledOverlayCheck: cancelScheduledOverlayCheck,
        nodeMatchesOverlayOrPopup: nodeMatchesOverlayOrPopup,
        hideLeftResizer: hideLeftResizer,
        updateLeftResizerPosition: updateLeftResizerPosition,
        updateRightResizerPosition: updateRightResizerPosition,
        updateResizerPosition: updateResizerPosition,
        ensureRightResizer: ensureRightResizer,
        initResizer: initResizer,
        disconnectPanelResizeObservers: disconnectPanelResizeObservers,
        isPointerNearResizer: isPointerNearResizer,
        handlePointerMove: handlePointerMove,
        handlePointerDown: handlePointerDown
    };
})();
