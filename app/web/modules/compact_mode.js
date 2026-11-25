/* Modulo JS 5: compact_mode.js
 * Responsabilidad: modo compacto de la barra lateral (__waSetSidebarCompact, __waToggleSidebarCompact),
 * animacion FLIP de transicion, aplicacion inline compacta, boton toggle en #side header,
 * sincronizacion y centrado de avatares (syncAvatarTooltips), tooltip flotante (#wa-compact-hover-tooltip)
 * y supresion/restauracion de titulos nativos.
 * Dependencias: window.__waApp.core, window.__waApp.layout y window.__waApp.resizers (exclusivamente).
 */
(function() {
    'use strict';
    var app = window.__waApp = window.__waApp || {};
    if (app.compact) return;
    var core = app.core;
    var layout = app.layout;
    var resizers = app.resizers;
    if (!core || !layout || !resizers) return;

    var MIN_WIDTH = core.MIN_WIDTH;
    var getSavedWidth = core.getSavedWidth;
    var isCompactActive = core.isCompactActive;

    var COMPACT_SIDEBAR_WIDTH_PX = 70;
    var COMPACT_RAIL_WIDTH_PX = 42;
    var DEFAULT_RAIL_WIDTH_PX = 64;
    var ANIMATION_DURATION_MS = 210;
    var HOVER_TOOLTIP_ID = 'wa-compact-hover-tooltip';
    var TOGGLE_BUTTON_CLASS = 'wa-compact-toggle-btn';
    var TOGGLE_WRAPPER_CLASS = 'wa-compact-toggle-wrapper';

    var SVG_COLLAPSE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">' +
                       '<path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>' +
                       '</svg>';

    var SVG_EXPAND = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">' +
                     '<path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>' +
                     '</svg>';

    var compactAnimTimer = null;
    var hoverTooltipEl = null;
    var hoverTooltipActiveRow = null;
    var avatarTooltipsDirty = true;
    var resizerSyncUnsubscribe = null;

    function isInternalNode(node) {
        if (!node || node.nodeType !== 1) return false;
        return node.id === HOVER_TOOLTIP_ID;
    }

    function isAnimating() {
        return !!(document.body && document.body.classList.contains('wa-sidebar-animating'));
    }

    function cancelCompactAnimation() {
        if (compactAnimTimer) {
            clearTimeout(compactAnimTimer);
            compactAnimTimer = null;
        }
        if (document.body) {
            document.body.classList.remove('wa-sidebar-animating');
        }
    }

    function getHoverTooltipState() {
        return {
            element: hoverTooltipEl,
            activeRow: hoverTooltipActiveRow
        };
    }

    function updateButtonAppearance(btn, isCompact) {
        if (!btn) return;
        btn.innerHTML = isCompact ? SVG_EXPAND : SVG_COLLAPSE;
        var label = isCompact ? 'Expandir barra lateral' : 'Minimizar barra lateral';
        btn.setAttribute('title', label);
        btn.setAttribute('aria-label', label);
    }

    function ensureHoverTooltip() {
        if (!document.body) return null;
        if (hoverTooltipEl && hoverTooltipEl.isConnected) return hoverTooltipEl;
        hoverTooltipEl = document.getElementById(HOVER_TOOLTIP_ID);
        if (!hoverTooltipEl) {
            hoverTooltipEl = document.createElement('div');
            hoverTooltipEl.id = HOVER_TOOLTIP_ID;
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
        if (!isCompactActive() || resizers.isDragging()) {
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

    function syncAvatarTooltips(tagOnly) {
        if (!isCompactActive()) {
            hideHoverTooltip();
            if (avatarTooltipsDirty) {
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
                avatarTooltipsDirty = false;
            }
            return;
        }
        avatarTooltipsDirty = true;

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

        if (tagOnly || isAnimating()) {
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

    function setSidebarCompact(targetCompact) {
        var currentlyCompact = isCompactActive();
        if (targetCompact === currentlyCompact) return;

        hideHoverTooltip();

        var compactWidthCss = COMPACT_SIDEBAR_WIDTH_PX + 'px';
        var compactRailCss = COMPACT_RAIL_WIDTH_PX + 'px';

        var containers = layout.resolveLayoutContainers();
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
                if (navW > COMPACT_RAIL_WIDTH_PX) {
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
                var seamStartMargin = (navW > 0) ? navW : DEFAULT_RAIL_WIDTH_PX;
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
                tcEl.style.setProperty('max-height', (h > 0 ? h : DEFAULT_RAIL_WIDTH_PX) + 'px', 'important');
                tcEl.style.setProperty('overflow', 'hidden', 'important');
                tcEl.style.setProperty('opacity', '1', 'important');
            }
        } else {
            if (navRail) {
                navRail.style.setProperty('width', compactRailCss, 'important');
                navRail.style.setProperty('min-width', compactRailCss, 'important');
                navRail.style.setProperty('max-width', compactRailCss, 'important');
                navRail.style.setProperty('flex-basis', compactRailCss, 'important');
            }
            if (railSeamFirst) {
                railSeamFirst.style.setProperty('margin-inline-start', compactRailCss, 'important');
                railSeamFirst.style.setProperty('width', compactWidthCss, 'important');
                railSeamFirst.style.setProperty('min-width', compactWidthCss, 'important');
                railSeamFirst.style.setProperty('max-width', compactWidthCss, 'important');
                railSeamFirst.style.setProperty('flex-basis', compactWidthCss, 'important');
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
                core.saveWidth(sideColW);
            }
            document.body.classList.add('wa-sidebar-compact');
            core.saveCompact(true);
            document.documentElement.style.setProperty('--wa-sidebar-width', compactWidthCss);
            // Etiquetar solo atributos data-wa-avatar-col/data-wa-text-col; diferir shiftWrites al final de la animacion
            syncAvatarTooltips(true);
            if (!document.body.classList.contains('wa-tab-shell-active') &&
                !document.body.classList.contains('wa-left-drawer-active')) {
                resizers.hideLeftResizer();
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
            core.saveCompact(false);
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
                    navRail.style.setProperty('width', compactRailCss, 'important');
                    navRail.style.setProperty('min-width', compactRailCss, 'important');
                    navRail.style.setProperty('max-width', compactRailCss, 'important');
                    navRail.style.setProperty('flex-basis', compactRailCss, 'important');
                }
                if (railSeamFirst) {
                    railSeamFirst.style.setProperty('margin-inline-start', compactRailCss, 'important');
                    railSeamFirst.style.setProperty('width', compactWidthCss, 'important');
                    railSeamFirst.style.setProperty('min-width', compactWidthCss, 'important');
                    railSeamFirst.style.setProperty('max-width', compactWidthCss, 'important');
                    railSeamFirst.style.setProperty('flex-basis', compactWidthCss, 'important');
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
                    sideCol.style.setProperty('width', compactWidthCss, 'important');
                    sideCol.style.setProperty('min-width', compactWidthCss, 'important');
                    sideCol.style.setProperty('max-width', compactWidthCss, 'important');
                    sideCol.style.setProperty('flex-basis', compactWidthCss, 'important');
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
                var railNormalW = (navRail && navRail.__waNormalWidth) ? navRail.__waNormalWidth : DEFAULT_RAIL_WIDTH_PX;
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
                layout.setSidebarWidth(savedWidth, false);
            }
            if (flipPane && flipPane.isConnected && Math.abs(deltaY) > 2) {
                flipPane.style.setProperty('transition', 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)', 'important');
                flipPane.style.setProperty('transform', 'translateY(0px)', 'important');
            }
        });

        var btn = document.querySelector('.' + TOGGLE_BUTTON_CLASS);
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
            var cAfter = layout.resolveLayoutContainers();
            if (cAfter && cAfter.flexContainer) {
                layout.syncAuxDrawers(cAfter.flexContainer, cAfter.sideColumn, cAfter.mainColumn);
            }
            resizers.updateResizerPosition();
            layout.scheduleMainScaleUpdate();
            var lastPtr = resizers.getLastPointerPosition();
            resizers.syncResizerOverlayState(lastPtr.x, lastPtr.y);
        }, ANIMATION_DURATION_MS);
    }

    function toggleSidebarCompact() {
        setSidebarCompact(!isCompactActive());
    }

    function ensureToggleButton() {
        var existingBtn = document.querySelector('.' + TOGGLE_BUTTON_CLASS);
        if (existingBtn && existingBtn.isConnected) {
            updateButtonAppearance(existingBtn, isCompactActive());
            return true;
        }

        var header = document.querySelector('#side header');
        if (!header) return false;

        var wrapper = document.createElement('div');
        wrapper.className = TOGGLE_WRAPPER_CLASS;

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = TOGGLE_BUTTON_CLASS;
        updateButtonAppearance(btn, isCompactActive());

        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            toggleSidebarCompact();
        });

        wrapper.appendChild(btn);

        // Insertar siempre como hijo directo de header para no quedar oculto dentro de botones nativos
        header.appendChild(wrapper);

        return true;
    }

    function applyCompactInline() {
        var c = layout.resolveLayoutContainers();
        if (!c) return;
        var compactWidthCss = COMPACT_SIDEBAR_WIDTH_PX + 'px';
        if (c.sideColumn) {
            c.sideColumn.style.removeProperty('border-right');
            c.sideColumn.style.setProperty('width', compactWidthCss, 'important');
            c.sideColumn.style.setProperty('min-width', compactWidthCss, 'important');
            c.sideColumn.style.setProperty('max-width', compactWidthCss, 'important');
            c.sideColumn.style.setProperty('flex-basis', compactWidthCss, 'important');
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
            layout.syncAuxDrawers(c.flexContainer, c.sideColumn, c.mainColumn);
        }
        if (c.side && c.sideColumn && c.mainColumn) {
            c.side.__waCompactApplied = true;
        }
        resizers.ensureRightResizer();
        resizers.updateRightResizerPosition();
        layout.ensureMainResizeObserver();
        layout.scheduleMainScaleUpdate();
    }

    function restoreSavedCompactState() {
        if (!core.getSavedCompact()) return false;
        if (document.body) {
            document.body.classList.add('wa-sidebar-compact');
        }
        document.documentElement.style.setProperty('--wa-sidebar-width', COMPACT_SIDEBAR_WIDTH_PX + 'px');
        applyCompactInline();
        return true;
    }

    function handleResizerDragStateChange(ev) {
        if (!ev || ev.type !== 'drag-start') return;
        if (ev.side === 'left') {
            cancelCompactAnimation();
        }
        hideHoverTooltip();
    }

    function bindResizerSync() {
        if (resizerSyncUnsubscribe) return resizerSyncUnsubscribe;
        resizerSyncUnsubscribe = resizers.onDragStateChange(handleResizerDragStateChange);
        return resizerSyncUnsubscribe;
    }

    function unbindResizerSync() {
        if (resizerSyncUnsubscribe) {
            resizerSyncUnsubscribe();
            resizerSyncUnsubscribe = null;
        }
    }

    window.__waSetSidebarCompact = setSidebarCompact;
    window.__waToggleSidebarCompact = toggleSidebarCompact;

    app.compact = {
        COMPACT_SIDEBAR_WIDTH_PX: COMPACT_SIDEBAR_WIDTH_PX,
        COMPACT_RAIL_WIDTH_PX: COMPACT_RAIL_WIDTH_PX,
        DEFAULT_RAIL_WIDTH_PX: DEFAULT_RAIL_WIDTH_PX,
        ANIMATION_DURATION_MS: ANIMATION_DURATION_MS,
        HOVER_TOOLTIP_ID: HOVER_TOOLTIP_ID,
        TOGGLE_BUTTON_CLASS: TOGGLE_BUTTON_CLASS,
        TOGGLE_WRAPPER_CLASS: TOGGLE_WRAPPER_CLASS,
        bindResizerSync: bindResizerSync,
        unbindResizerSync: unbindResizerSync,
        isInternalNode: isInternalNode,
        isAnimating: isAnimating,
        cancelCompactAnimation: cancelCompactAnimation,
        getHoverTooltipState: getHoverTooltipState,
        updateButtonAppearance: updateButtonAppearance,
        ensureHoverTooltip: ensureHoverTooltip,
        hideHoverTooltip: hideHoverTooltip,
        computeRowChatName: computeRowChatName,
        extractRowChatName: extractRowChatName,
        suppressNativeTitles: suppressNativeTitles,
        restoreNativeTitles: restoreNativeTitles,
        positionHoverTooltip: positionHoverTooltip,
        handleCompactTooltipPointerMove: handleCompactTooltipPointerMove,
        syncAvatarTooltips: syncAvatarTooltips,
        setSidebarCompact: setSidebarCompact,
        toggleSidebarCompact: toggleSidebarCompact,
        ensureToggleButton: ensureToggleButton,
        applyCompactInline: applyCompactInline,
        restoreSavedCompactState: restoreSavedCompactState
    };
})();
