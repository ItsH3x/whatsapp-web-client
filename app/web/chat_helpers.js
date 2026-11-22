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

    // 1b. El motor unificado de acentos dinamicos vive en sidebar_enhancements.js
    window.__waRefreshAccentColor = function() {
        if (typeof window.__waDetectAndApplyAccent === 'function') {
            var shared = window.__waDetectAndApplyAccent();
            if (shared && shared.accent) {
                return shared.accent;
            }
        }
        return window.__waAppliedDynamicAccent || '#00a884';
    };

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
    var validChatsBatchCache = null;
    var navBadgeTimer1 = null;
    var navBadgeTimer2 = null;
    var navBadgeRafId = null;
    var rowValidityCache = typeof WeakMap === 'function' ? new WeakMap() : null;
    var lastNavFromEl = null;
    var lastNavTargetEl = null;
    var lastNavAt = 0;

    function clearNavBadgeTimers() {
        if (navBadgeRafId !== null) {
            window.cancelAnimationFrame(navBadgeRafId);
            navBadgeRafId = null;
        }
        if (navBadgeTimer1 !== null) {
            clearTimeout(navBadgeTimer1);
            navBadgeTimer1 = null;
        }
        if (navBadgeTimer2 !== null) {
            clearTimeout(navBadgeTimer2);
            navBadgeTimer2 = null;
        }
    }

    function computeValidChatsSnapshot() {
        if (window.__waEnsurePaneListeners) {
            window.__waEnsurePaneListeners();
        }
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
        var chatContentSelector = 'img, svg, span[data-icon], span[title], span[dir="auto"], div[data-testid*="cell-frame"], [data-wa-avatar-col="true"]';
        var cacheNow = performance.now();
        for (var k = 0; k < dedupedItems.length; k++) {
            var entry = dedupedItems[k];
            var el = entry.el;

            if (rowValidityCache) {
                var cachedRow = rowValidityCache.get(el);
                if (cachedRow && (cacheNow - cachedRow.at) < 400) {
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
            if (isValidRow && el.querySelector(chatContentSelector) === null) {
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

    window.__waGetValidChats = function(skipViewportFilter) {
        if (validChatsBatchCache) {
            return (skipViewportFilter ? validChatsBatchCache.all : validChatsBatchCache.visible).slice();
        }
        var snap = computeValidChatsSnapshot();
        return skipViewportFilter ? snap.all : snap.visible;
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
        var navNow = performance.now();
        var snap = computeValidChatsSnapshot();
        var validChats = snap.all;
        if (!validChats.length) return -1;

        validChatsBatchCache = snap;
        try {
            var currentIndex = window.__waGetCurrentChatIndex(true);
            // Si React aun no comprometio aria-selected del salto anterior (< 300ms),
            // evitar re-seleccionar el mismo chat tomando como base el destino logico previo.
            if (lastNavTargetEl && lastNavTargetEl.isConnected && (navNow - lastNavAt) < 300) {
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
            if (target && window.__waSelectChatElement) {
                didScroll = !!window.__waSelectChatElement(target);
            }
            if (didScroll) {
                validChatsBatchCache = null;
            }

            clearNavBadgeTimers();
            // Evitar llamar __waShowAltBadges() sincronamente justo tras el click (causaba reflow de 95-136ms).
            // Si la lista no se desplazo, los badges visibles 1..9 no cambiaron de fila; solo refrescar si hubo scroll.
            if (didScroll && window.__waShowAltBadges && window.__waAltKeyDown) {
                navBadgeRafId = window.requestAnimationFrame(function() {
                    navBadgeRafId = null;
                    if (window.__waAltKeyDown && window.__waShowAltBadges) {
                        window.__waShowAltBadges();
                    }
                });
                navBadgeTimer1 = setTimeout(function() {
                    navBadgeTimer1 = null;
                    if (window.__waAltKeyDown && window.__waShowAltBadges) {
                        window.__waShowAltBadges();
                    }
                }, 140);
            }

            return targetIndex;
        } finally {
            validChatsBatchCache = null;
        }
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

    // 8. Escuchadores directos de teclado y badges dentro de la ventana web
    // Nota: Alt + Wheel se intercepta de forma nativa en C++ (whatsapp_window.cpp);
    // no registrar listeners wheel { passive: false } en JS para preservar el scroll GPU compositor.
    if (!window.__waAltListenersAttached) {
        window.__waAltListenersAttached = true;
        window.__waAltKeyDown = false;

        var observedBadgePane = null;
        var BADGE_OBSERVER_OPTS = {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'data-wa-compact-hide']
        };

        var ensurePaneBadgeObserver = function(pane) {
            if (!pane || pane.__waBadgeObserver || !window.MutationObserver) return;
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
            pane.__waBadgeObserverConnected = false;
        };

        var syncBadgeObserver = function(shouldObserve) {
            if (!shouldObserve) {
                clearNavBadgeTimers();
                if (observedBadgePane && observedBadgePane.__waBadgeObserver && observedBadgePane.__waBadgeObserverConnected) {
                    observedBadgePane.__waBadgeObserver.disconnect();
                    observedBadgePane.__waBadgeObserverConnected = false;
                    observedBadgePane.__waBadgeMutRaf = false;
                }
                var curPaneOff = document.getElementById('pane-side');
                if (curPaneOff && curPaneOff !== observedBadgePane && curPaneOff.__waBadgeObserver && curPaneOff.__waBadgeObserverConnected) {
                    curPaneOff.__waBadgeObserver.disconnect();
                    curPaneOff.__waBadgeObserverConnected = false;
                    curPaneOff.__waBadgeMutRaf = false;
                }
                observedBadgePane = null;
                return;
            }

            var pane = document.getElementById('pane-side');
            if (!pane) return;
            if (observedBadgePane && observedBadgePane !== pane && observedBadgePane.__waBadgeObserver && observedBadgePane.__waBadgeObserverConnected) {
                observedBadgePane.__waBadgeObserver.disconnect();
                observedBadgePane.__waBadgeObserverConnected = false;
                observedBadgePane.__waBadgeMutRaf = false;
            }
            ensurePaneBadgeObserver(pane);
            if (pane.__waBadgeObserver && !pane.__waBadgeObserverConnected) {
                pane.__waBadgeObserver.observe(pane, BADGE_OBSERVER_OPTS);
                pane.__waBadgeObserverConnected = true;
                observedBadgePane = pane;
            }
        };
        window.__waSyncBadgeObserver = syncBadgeObserver;

        if (typeof window.__waShowAltBadges === 'function' && !window.__waShowAltBadges.__waObsWrapped) {
            var origShowAltBadges = window.__waShowAltBadges;
            var wrappedShowAltBadges = function() {
                var result = origShowAltBadges.apply(this, arguments);
                if (window.__waAltKeyDown) {
                    syncBadgeObserver(true);
                }
                return result;
            };
            wrappedShowAltBadges.__waObsWrapped = true;
            window.__waShowAltBadges = wrappedShowAltBadges;
        }
        if (typeof window.__waHideAltBadges === 'function' && !window.__waHideAltBadges.__waObsWrapped) {
            var origHideAltBadges = window.__waHideAltBadges;
            var wrappedHideAltBadges = function() {
                syncBadgeObserver(false);
                return origHideAltBadges.apply(this, arguments);
            };
            wrappedHideAltBadges.__waObsWrapped = true;
            window.__waHideAltBadges = wrappedHideAltBadges;
        }

        window.__waEnsurePaneListeners = function() {
            var pane = document.getElementById('pane-side');
            if (!pane) return;
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
            ensurePaneBadgeObserver(pane);
            if (window.__waAltKeyDown) {
                syncBadgeObserver(true);
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
                    syncBadgeObserver(false);
                    window.__waHideAltBadges();
                }
                return;
            }
            if (e.key === 'Alt' &&
                e.code !== 'AltRight' &&
                e.location !== 2 &&
                !(e.getModifierState && e.getModifierState('AltGraph'))) {
                // Solo se marca el estado y se activa el observer mientras Alt este pulsado:
                // C++ (eventFilter) es el unico que muestra los badges.
                window.__waAltKeyDown = true;
                syncBadgeObserver(true);
            }
        }, true);

        window.addEventListener('keyup', function(e) {
            if (e.key === 'Alt' || e.key === 'AltGraph' || e.code === 'AltRight') {
                window.__waAltKeyDown = false;
                syncBadgeObserver(false);
                window.__waHideAltBadges();
            }
        }, true);

        window.addEventListener('blur', function() {
            if (window.__waAltKeyDown) {
                window.__waAltKeyDown = false;
                syncBadgeObserver(false);
                if (window.__waHideAltBadges) {
                    window.__waHideAltBadges();
                }
            }
        });
    }
    if (window.__waEnsurePaneListeners) {
        window.__waEnsurePaneListeners();
    }
})();
