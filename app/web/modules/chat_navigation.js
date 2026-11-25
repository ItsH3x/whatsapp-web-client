/* Modulo JS 7: chat_navigation.js
 * Responsabilidad: descubrimiento y filtrado de chats validos en #pane-side (excluyendo Archivados
 * y avisos de cifrado), seleccion compatible con React 18, deteccion del indice activo, navegacion
 * secuencial, busqueda con scroll progresivo sobre lista virtualizada y gestion de listeners de
 * #pane-side con eventos de inversion de control (onPaneReady, onPaneScroll, onNavigate).
 * Dependencias: ninguna dentro de window.__waApp (solo APIs nativas del navegador y ganchos
 * opcionales de read_receipt_blocker.js: __waCancelTemporarySeen, __waScheduleReadOnlyChatCheck).
 */
(function() {
    'use strict';
    var app = window.__waApp = window.__waApp || {};
    if (app.chatNavigation &&
        typeof window.__waGetValidChats === 'function' &&
        typeof window.__waSelectChatElement === 'function' &&
        typeof window.__waNavigateChat === 'function' &&
        typeof window.__waFindAndOpenChat === 'function') {
        if (typeof app.chatNavigation.ensurePaneListeners === 'function') {
            app.chatNavigation.ensurePaneListeners();
        }
        return;
    }

    var CHAT_CONTENT_SELECTOR = 'img, svg, span[data-icon], span[title], span[dir="auto"], div[data-testid*="cell-frame"], [data-wa-avatar-col="true"]';
    var ROW_VALIDITY_TTL_MS = 400;
    var NAV_PENDING_COMMIT_MS = 300;

    var validChatsBatchCache = null;
    var rowValidityCache = typeof WeakMap === 'function' ? new WeakMap() : null;
    var lastNavFromEl = null;
    var lastNavTargetEl = null;
    var lastNavAt = 0;

    var paneReadyListeners = [];
    var paneScrollListeners = [];
    var navigateListeners = [];

    function addListener(list, listener) {
        if (typeof listener !== 'function') return function() {};
        if (list.indexOf(listener) === -1) {
            list.push(listener);
        }
        return function() {
            removeListener(list, listener);
        };
    }

    function removeListener(list, listener) {
        var idx = list.indexOf(listener);
        if (idx !== -1) {
            list.splice(idx, 1);
        }
    }

    function notifyListeners(list, payload) {
        if (!list.length) return;
        var snapshot = list.slice();
        for (var i = 0; i < snapshot.length; i++) {
            try {
                snapshot[i](payload);
            } catch (e) {}
        }
    }

    function onPaneReady(listener) {
        return addListener(paneReadyListeners, listener);
    }

    function offPaneReady(listener) {
        removeListener(paneReadyListeners, listener);
    }

    function onPaneScroll(listener) {
        return addListener(paneScrollListeners, listener);
    }

    function offPaneScroll(listener) {
        removeListener(paneScrollListeners, listener);
    }

    function onNavigate(listener) {
        return addListener(navigateListeners, listener);
    }

    function offNavigate(listener) {
        removeListener(navigateListeners, listener);
    }

    // Gestion de listeners pasivos de #pane-side sin acoplar la capa de badges
    function ensurePaneListeners() {
        var pane = document.getElementById('pane-side');
        if (!pane) return null;
        if (!pane.__waPaneScrollAttached) {
            pane.__waPaneScrollAttached = true;
            pane.addEventListener('scroll', function(event) {
                notifyListeners(paneScrollListeners, { pane: pane, event: event });
            }, { passive: true });
        }
        notifyListeners(paneReadyListeners, pane);
        return pane;
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

    // Obtiene chats validos ignorando la pestana de Archivados y capturando todas las
    // conversaciones visibles (fijadas, propias y normales) en su orden visual exacto.
    function computeValidChatsSnapshot() {
        ensurePaneListeners();
        var pane = document.getElementById('pane-side');
        if (!pane || !isElementVisible(pane, 20, 20)) {
            return { all: [], visible: [] };
        }
        var paneRect = pane.getBoundingClientRect();

        var getCandidateRowRect = function(node) {
            if (!node || !node.isConnected) return null;
            if (node.getAttribute('data-wa-compact-hide') === 'true' ||
                (node.classList && node.classList.contains('wa-archived-row')) ||
                (node.style && (node.style.display === 'none' || node.style.visibility === 'hidden')) ||
                (node.closest && node.closest('[data-wa-compact-hide="true"]'))) {
                return null;
            }
            var rect = node.getBoundingClientRect();
            if (rect.width < 30 || rect.height < 40 || rect.height > 140) {
                return null;
            }
            return rect;
        };

        var rawItems = [];
        var rawSet = typeof Set === 'function' ? new Set() : null;
        var hasRawNode = function(node) {
            return rawSet ? rawSet.has(node) : rawItems.some(function(it) { return it.el === node; });
        };
        var pushRawNode = function(node) {
            if (!node || hasRawNode(node)) return;
            var rect = getCandidateRowRect(node);
            if (!rect) return;
            if (rawSet) rawSet.add(node);
            rawItems.push({ el: node, top: rect.top, height: rect.height });
        };

        // Estrategia A: Filas accesibles con role="row" o role="listitem"
        var roleNodes = pane.querySelectorAll('[role="row"], [role="listitem"]');
        for (var r = 0; r < roleNodes.length; r++) {
            pushRawNode(roleNodes[r]);
        }

        // Estrategia B (fallback): solo si Estrategia A no devolvio filas
        if (!rawItems.length) {
            var virtualNodes = pane.querySelectorAll('div[style*="translateY"], div[style*="translate3d"]');
            for (var v = 0; v < virtualNodes.length; v++) {
                var vNode = virtualNodes[v];
                var semRow = vNode.querySelector('[role="row"], [role="listitem"]') || vNode;
                if (!hasRawNode(semRow) && !hasRawNode(vNode)) {
                    pushRawNode(semRow);
                }
            }
        }

        // Estrategia C: Fallback para estructuras con cell-frame-container
        if (!rawItems.length) {
            var cellFrames = pane.querySelectorAll('div[data-testid="cell-frame-container"]');
            for (var c = 0; c < cellFrames.length; c++) {
                var cf = cellFrames[c];
                var row = cf.closest('[role="row"], [role="listitem"]') || cf;
                if (!pane.contains(row)) {
                    row = cf;
                }
                pushRawNode(row);
            }
        }

        // Deduplicacion jerarquica en O(N * profundidad) usando ancestros en lugar de O(N^2)
        var dedupedItems = [];
        for (var i = 0; i < rawItems.length; i++) {
            var item = rawItems[i];
            var isContained = false;
            var ancestor = item.el.parentElement;
            while (ancestor && ancestor !== pane) {
                if (hasRawNode(ancestor)) {
                    isContained = true;
                    break;
                }
                ancestor = ancestor.parentElement;
            }
            if (!isContained) {
                dedupedItems.push(item);
            }
        }

        var validEntries = [];
        var cacheNow = performance.now();
        for (var k = 0; k < dedupedItems.length; k++) {
            var entry = dedupedItems[k];
            var el = entry.el;

            if (rowValidityCache) {
                var cachedRow = rowValidityCache.get(el);
                if (cachedRow && (cacheNow - cachedRow.at) < ROW_VALIDITY_TTL_MS) {
                    if (cachedRow.valid) {
                        validEntries.push(entry);
                    }
                    continue;
                }
            }

            var isValidRow = true;
            // Deteccion de chat anclado / fijado (pin):
            // Si contiene el icono de fijado, es obligatoriamente un chat valido y NUNCA debe descartarse como archivado
            var isPinned = el.querySelector('span[data-icon*="pin"], [data-testid*="pin"]') !== null;

            if (!isPinned) {
                // Filtrar si es la fila de Archivados por icono, atributo o texto
                var hasArchiveIcon = el.querySelector('span[data-icon*="archiv"], [data-testid*="archiv"], [aria-label*="archiv" i]') !== null;
                if (hasArchiveIcon) {
                    isValidRow = false;
                }

                if (isValidRow) {
                    var title = extractRowTitle(el).trim().toLowerCase();
                    if (/^(archivados|archived|arquivadas)/i.test(title)) {
                        isValidRow = false;
                    }
                }

                if (isValidRow) {
                    var fullText = (el.textContent || '').trim().toLowerCase();
                    if (/^(archivados|archived|arquivadas)(\s*\d+)?$/i.test(fullText)) {
                        isValidRow = false;
                    } else {
                        // Descartar filas informativas de cifrado que pudieran montarse como row/listitem
                        var hasAvatarOrTitle = el.querySelector('img, span[title], div[data-testid="cell-frame-title"]') !== null;
                        if (!hasAvatarOrTitle &&
                            (el.querySelector('span[data-icon*="lock"], [data-testid*="encrypt"]') !== null ||
                             /(cifrad|extremo a extremo|end-to-end|encrypt|criptograf)/i.test(fullText))) {
                            isValidRow = false;
                        }
                    }
                }
            }

            // Verificar que contiene la estructura minima de un chat real (avatar o contenido de texto)
            if (isValidRow && el.querySelector(CHAT_CONTENT_SELECTOR) === null) {
                isValidRow = false;
            }

            if (rowValidityCache) {
                rowValidityCache.set(el, { valid: isValidRow, at: cacheNow });
            }
            if (isValidRow) {
                validEntries.push(entry);
            }
        }

        // Ordenar visualmente usando la coordenada top cacheada (cero getBoundingClientRect dentro de sort)
        validEntries.sort(function(a, b) {
            return a.top - b.top;
        });

        var allChats = new Array(validEntries.length);
        var visibleChats = [];
        var hasPaneHeight = paneRect.height > 0;
        for (var m = 0; m < validEntries.length; m++) {
            var ve = validEntries[m];
            allChats[m] = ve.el;
            if (hasPaneHeight) {
                var centerY = ve.top + (ve.height / 2);
                if (centerY >= paneRect.top && centerY <= paneRect.bottom) {
                    visibleChats.push(ve.el);
                }
            } else {
                visibleChats.push(ve.el);
            }
        }

        return { all: allChats, visible: visibleChats };
    }

    function getValidChats(skipViewportFilter) {
        if (validChatsBatchCache) {
            return (skipViewportFilter ? validChatsBatchCache.all : validChatsBatchCache.visible).slice();
        }
        var snap = computeValidChatsSnapshot();
        return skipViewportFilter ? snap.all : snap.visible;
    }

    // Seleccion y clic simulado 100% compatible con React 18
    function selectChatElement(target, preserveSeenState) {
        if (!target) return false;

        var isAlreadySelected = (target.getAttribute && target.getAttribute('aria-selected') === 'true') ||
                                (target.querySelector && target.querySelector('[aria-selected="true"]') !== null);
        if (!preserveSeenState && !window.__waMarkingSeenActive && !isAlreadySelected && window.__waCancelTemporarySeen) {
            window.__waCancelTemporarySeen();
        }

        var isClickableEl = function(el) {
            if (!isElementVisible(el, 1, 1)) return false;
            if (el.style && el.style.pointerEvents === 'none') return false;
            return true;
        };

        var isActionButton = function(el) {
            if (!el || !el.tagName) return false;
            var tag = el.tagName.toLowerCase();
            return tag === 'button' || tag === 'a' || el.getAttribute('role') === 'button';
        };

        var clickTarget = null;
        var isCompactMode = !!(document.body && document.body.classList.contains('wa-sidebar-compact'));

        var tryNormalSelectors = function() {
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
                    return;
                }
            }
        };

        var tryCompactSelectors = function() {
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
        };

        if (isCompactMode) {
            tryCompactSelectors();
            if (!clickTarget) {
                tryNormalSelectors();
            }
        } else {
            tryNormalSelectors();
            if (!clickTarget) {
                tryCompactSelectors();
            }
        }

        if (!clickTarget) {
            clickTarget = target;
        }

        var rect = clickTarget.getBoundingClientRect();
        var clientX = Math.round(rect.left + (rect.width > 0 ? rect.width / 2 : 10));
        var clientY = Math.round(rect.top + (rect.height > 0 ? rect.height / 2 : 10));

        var needsScroll = true;
        var paneForScroll = document.getElementById('pane-side');
        if (paneForScroll) {
            var paneRectForScroll = paneForScroll.getBoundingClientRect();
            var targetRectForScroll = (target === clickTarget) ? rect : target.getBoundingClientRect();
            if (paneRectForScroll.height > 0 && targetRectForScroll.height > 0) {
                needsScroll = (targetRectForScroll.top < paneRectForScroll.top - 1) ||
                              (targetRectForScroll.bottom > paneRectForScroll.bottom + 1);
            }
        }

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
            try {
                target.focus({ preventScroll: true });
            } catch (e) {
                try { target.focus(); } catch (e2) {}
            }
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

        var didScroll = false;
        if (needsScroll && typeof target.scrollIntoView === 'function') {
            target.scrollIntoView({ block: 'nearest', behavior: 'auto' });
            didScroll = true;
        }

        if (!preserveSeenState && !window.__waMarkingSeenActive && typeof window.__waScheduleReadOnlyChatCheck === 'function') {
            window.__waScheduleReadOnlyChatCheck();
        }
        return didScroll;
    }

    // Obtiene el indice del chat seleccionado actualmente
    function getCurrentChatIndex(includeAllMounted) {
        var validChats = getValidChats(!!includeAllMounted);
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
    }

    // Navegacion secuencial por chats (+1 abajo, -1 arriba)
    function navigateChat(offset) {
        var navNow = performance.now();
        var snap = computeValidChatsSnapshot();
        var validChats = snap.all;
        if (!validChats.length) return -1;

        validChatsBatchCache = snap;
        try {
            var currentIndex = getCurrentChatIndex(true);
            // Si React aun no comprometio aria-selected del salto anterior (< 300ms),
            // evitar re-seleccionar el mismo chat tomando como base el destino logico previo.
            if (lastNavTargetEl && lastNavTargetEl.isConnected && (navNow - lastNavAt) < NAV_PENDING_COMMIT_MS) {
                var currentEl = currentIndex >= 0 ? validChats[currentIndex] : null;
                if (currentEl === lastNavFromEl) {
                    var prevTargetIdx = validChats.indexOf(lastNavTargetEl);
                    if (prevTargetIdx !== -1) {
                        currentIndex = prevTargetIdx;
                    }
                }
            }
            var targetIndex = 0;

            if (currentIndex === -1) {
                var visibleChats = snap.visible;
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
                return targetIndex;
            }

            window.__waCurrentChatIndex = targetIndex;
            window.__waHasRepliedInCurrentChat = false;
            window.__waMarkingSeenActive = false;
            if (window.__waCancelTemporarySeen) {
                window.__waCancelTemporarySeen();
            }

            var target = validChats[targetIndex];
            lastNavFromEl = (currentIndex >= 0 && currentIndex < validChats.length) ? validChats[currentIndex] : null;
            lastNavTargetEl = target || null;
            lastNavAt = navNow;

            var didScroll = false;
            if (target) {
                didScroll = !!selectChatElement(target);
            }
            if (didScroll) {
                validChatsBatchCache = null;
            }

            notifyListeners(navigateListeners, {
                fromIndex: currentIndex,
                targetIndex: targetIndex,
                target: target || null,
                didScroll: didScroll
            });

            return targetIndex;
        } finally {
            validChatsBatchCache = null;
        }
    }

    // Busqueda de chat por nombre con scroll progresivo sobre la lista virtualizada de #pane-side
    if (typeof window.__waFindChatTimer === 'undefined') {
        window.__waFindChatTimer = null;
    }

    function findAndOpenChat(targetName, onFoundCallback) {
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
            var chats = getValidChats(true);
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
            selectChatElement(immediate);
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
                selectChatElement(hit);
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
    }

    app.chatNavigation = {
        CHAT_CONTENT_SELECTOR: CHAT_CONTENT_SELECTOR,
        ROW_VALIDITY_TTL_MS: ROW_VALIDITY_TTL_MS,
        NAV_PENDING_COMMIT_MS: NAV_PENDING_COMMIT_MS,
        normalizeChatTitle: normalizeChatTitle,
        isElementVisible: isElementVisible,
        extractRowTitle: extractRowTitle,
        computeValidChatsSnapshot: computeValidChatsSnapshot,
        getValidChats: getValidChats,
        selectChatElement: selectChatElement,
        getCurrentChatIndex: getCurrentChatIndex,
        navigateChat: navigateChat,
        findAndOpenChat: findAndOpenChat,
        ensurePaneListeners: ensurePaneListeners,
        onPaneReady: onPaneReady,
        offPaneReady: offPaneReady,
        onPaneScroll: onPaneScroll,
        offPaneScroll: offPaneScroll,
        onNavigate: onNavigate,
        offNavigate: offNavigate
    };

    // Contratos publicos consumidos por whatsapp_chat_bridge.cpp, read_receipt_blocker.js y bootstrap.js
    window.__waGetValidChats = getValidChats;
    window.__waSelectChatElement = selectChatElement;
    window.__waGetCurrentChatIndex = getCurrentChatIndex;
    window.__waNavigateChat = navigateChat;
    window.__waFindAndOpenChat = findAndOpenChat;
    window.__waEnsurePaneListeners = ensurePaneListeners;

    ensurePaneListeners();
})();
