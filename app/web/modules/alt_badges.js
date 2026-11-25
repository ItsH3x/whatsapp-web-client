/* Modulo JS 8: alt_badges.js
 * Responsabilidad: inyeccion de estilos de scrollbar y .wa-alt-badge, renderizado/ocultacion de
 * badges numericos (1..9, 0) sobre avatares, consumo del acento dinamico (__waRefreshAccentColor),
 * observer de mutaciones en #pane-side activo solo mientras Alt esta pulsado y listeners de
 * teclado Alt/AltGr/blur.
 * Dependencias: window.__waApp.chatNavigation (y consumo pasivo del contrato publico de acentos:
 * window.__waDetectAndApplyAccent, window.__waAppliedDynamicAccent y --wa-dynamic-accent*).
 */
(function() {
    'use strict';
    var app = window.__waApp = window.__waApp || {};
    if (app.altBadges &&
        typeof window.__waShowAltBadges === 'function' &&
        typeof window.__waHideAltBadges === 'function' &&
        window.__waAltListenersAttached) {
        if (app.chatNavigation && typeof app.chatNavigation.ensurePaneListeners === 'function') {
            app.chatNavigation.ensurePaneListeners();
        }
        return;
    }

    var chatNav = app.chatNavigation || null;

    var STYLE_ELEMENT_ID = 'wa-alt-badge-styles';
    var BADGE_CLASS_NAME = 'wa-alt-badge';
    var FALLBACK_ACCENT_COLOR = '#00a884';
    var NAV_BADGE_DELAY_MS = 140;
    var BADGE_OBSERVER_OPTS = {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'data-wa-compact-hide']
    };

    var observedBadgePane = null;
    var navBadgeRafId = null;
    var navBadgeTimer = null;
    var scrollBadgeRaf = false;
    var altListenersBound = false;
    var unsubPaneReady = null;
    var unsubPaneScroll = null;
    var unsubNavigate = null;

    function getValidChats() {
        if (chatNav && typeof chatNav.getValidChats === 'function') {
            return chatNav.getValidChats();
        }
        return typeof window.__waGetValidChats === 'function' ? window.__waGetValidChats() : [];
    }

    function isElementVisible(el, minW, minH) {
        if (chatNav && typeof chatNav.isElementVisible === 'function') {
            return chatNav.isElementVisible(el, minW, minH);
        }
        if (!el || !el.isConnected) return false;
        var cs = window.getComputedStyle(el);
        if (!cs || cs.display === 'none' || cs.visibility === 'hidden') return false;
        var rect = el.getBoundingClientRect();
        return rect.width >= (minW || 1) && rect.height >= (minH || 1);
    }

    // 1. Inyectar estilos CSS para scrollbar y badges de atajos
    function ensureBadgeStyles() {
        var existing = document.getElementById(STYLE_ELEMENT_ID);
        if (existing) return existing;
        var style = document.createElement('style');
        style.id = STYLE_ELEMENT_ID;
        style.textContent =
            '::-webkit-scrollbar { width: 6px !important; height: 6px !important; }\n' +
            '::-webkit-scrollbar-track { background: transparent !important; }\n' +
            '::-webkit-scrollbar-thumb { background: rgba(128, 128, 128, 0.25) !important; border-radius: 3px !important; }\n' +
            '::-webkit-scrollbar-thumb:hover { background: rgba(128, 128, 128, 0.45) !important; }\n' +
            '.wa-alt-badge {\n' +
            '    position: absolute !important;\n' +
            '    display: flex !important;\n' +
            '    align-items: center !important;\n' +
            '    justify-content: center !important;\n' +
            '    width: 20px !important;\n' +
            '    height: 20px !important;\n' +
            '    line-height: 1 !important;\n' +
            '    text-align: center !important;\n' +
            '    font-size: 12px !important;\n' +
            '    font-weight: 600 !important;\n' +
            '    font-family: inherit !important;\n' +
            '    color: var(--wa-dynamic-accent-fg, #111b21) !important;\n' +
            '    background: var(--wa-dynamic-accent, #00a884) !important;\n' +
            '    border: none !important;\n' +
            '    outline: none !important;\n' +
            '    border-radius: 50% !important;\n' +
            '    pointer-events: none !important;\n' +
            '    z-index: 999999 !important;\n' +
            '    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35) !important;\n' +
            '    box-sizing: border-box !important;\n' +
            '    padding: 0 !important;\n' +
            '    margin: 0 !important;\n' +
            '    animation: wa-badge-pop 0.1s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important;\n' +
            '}\n' +
            '@keyframes wa-badge-pop {\n' +
            '    0% { transform: scale(0.3); opacity: 0; }\n' +
            '    100% { transform: scale(1); opacity: 1; }\n' +
            '}';
        var host = document.head || document.documentElement;
        if (host) {
            host.appendChild(style);
        }
        return style;
    }

    // 2. Consumo del motor unificado de acentos dinamicos (app/web/modules/accent_theme.js)
    function refreshAccentColor() {
        if (typeof window.__waDetectAndApplyAccent === 'function') {
            var shared = window.__waDetectAndApplyAccent();
            if (shared && shared.accent) {
                return shared.accent;
            }
        }
        return window.__waAppliedDynamicAccent || FALLBACK_ACCENT_COLOR;
    }

    function clearNavBadgeTimers() {
        if (navBadgeRafId !== null) {
            window.cancelAnimationFrame(navBadgeRafId);
            navBadgeRafId = null;
        }
        if (navBadgeTimer !== null) {
            clearTimeout(navBadgeTimer);
            navBadgeTimer = null;
        }
    }

    function scheduleNavBadgeRefresh() {
        // Evitar llamar showAltBadges() sincronamente justo tras el click (causaba reflow de 95-136ms).
        // Si la lista se desplazo, refrescar en el siguiente frame y tras asentarse la virtualizacion.
        navBadgeRafId = window.requestAnimationFrame(function() {
            navBadgeRafId = null;
            if (window.__waAltKeyDown) {
                showAltBadges();
            }
        });
        navBadgeTimer = setTimeout(function() {
            navBadgeTimer = null;
            if (window.__waAltKeyDown) {
                showAltBadges();
            }
        }, NAV_BADGE_DELAY_MS);
    }

    function isBadgeNode(node) {
        return !!(node && node.nodeType === 1 && node.classList && node.classList.contains(BADGE_CLASS_NAME));
    }

    function isOnlyBadgeMutation(m) {
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
    }

    function ensurePaneBadgeObserver(pane) {
        if (!pane || pane.__waBadgeObserver || !window.MutationObserver) return;
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
                if (window.__waAltKeyDown) {
                    showAltBadges();
                }
            });
        });
        pane.__waBadgeObserverConnected = false;
    }

    function syncBadgeObserver(shouldObserve) {
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
    }

    // 3. Mostrar badges sobre la esquina de la foto de perfil sin depender de cell-frame-container
    function showAltBadges() {
        // Reutiliza los badges existentes: solo crea (con animacion) los que faltan,
        // actualiza posicion/etiqueta de los ya visibles y elimina los sobrantes.
        var validChats = getValidChats();
        var count = Math.min(validChats.length, 10);
        var keep = [];

        for (var i = 0; i < count; i++) {
            var keyLabel = (i < 9) ? String(i + 1) : '0';
            var chatRow = validChats[i];

            var rowRect = chatRow.getBoundingClientRect();
            if (rowRect.width <= 0 || rowRect.height <= 0) continue;

            var candidate = null;
            var isCompactRow = (rowRect.width <= 85) || !!(document.body && document.body.classList.contains('wa-sidebar-compact'));

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
                if (chatRow.children[cb].classList && chatRow.children[cb].classList.contains(BADGE_CLASS_NAME)) {
                    badge = chatRow.children[cb];
                    break;
                }
            }
            if (!badge) {
                badge = document.createElement('span');
                badge.className = BADGE_CLASS_NAME;
                chatRow.appendChild(badge);
            }
            if (badge.textContent !== keyLabel) badge.textContent = keyLabel;
            var topStr = badgeTop + 'px';
            var leftStr = badgeLeft + 'px';
            if (badge.style.top !== topStr) badge.style.top = topStr;
            if (badge.style.left !== leftStr) badge.style.left = leftStr;
            keep.push(badge);
        }

        document.querySelectorAll('.' + BADGE_CLASS_NAME).forEach(function(el) {
            if (keep.indexOf(el) === -1) el.remove();
        });

        if (window.__waAltKeyDown) {
            syncBadgeObserver(true);
        }
    }

    // 4. Ocultar badges y desconectar observer/temporizadores activos
    function hideAltBadges() {
        syncBadgeObserver(false);
        document.querySelectorAll('.' + BADGE_CLASS_NAME).forEach(function(el) { el.remove(); });
    }

    // 5. Suscripcion a eventos de chat_navigation.js (inversion de control, cero ciclos)
    function handlePaneReady(pane) {
        ensurePaneBadgeObserver(pane);
        if (window.__waAltKeyDown) {
            syncBadgeObserver(true);
        }
    }

    function handlePaneScroll() {
        if (!window.__waAltKeyDown || scrollBadgeRaf) return;
        scrollBadgeRaf = true;
        window.requestAnimationFrame(function() {
            scrollBadgeRaf = false;
            if (window.__waAltKeyDown) {
                showAltBadges();
            }
        });
    }

    function handleNavigate(evt) {
        clearNavBadgeTimers();
        if (evt && evt.didScroll && window.__waAltKeyDown) {
            scheduleNavBadgeRefresh();
        }
    }

    function bindNavigationSync() {
        if (!chatNav) return;
        if (!unsubPaneReady && typeof chatNav.onPaneReady === 'function') {
            unsubPaneReady = chatNav.onPaneReady(handlePaneReady);
        }
        if (!unsubPaneScroll && typeof chatNav.onPaneScroll === 'function') {
            unsubPaneScroll = chatNav.onPaneScroll(handlePaneScroll);
        }
        if (!unsubNavigate && typeof chatNav.onNavigate === 'function') {
            unsubNavigate = chatNav.onNavigate(handleNavigate);
        }
    }

    function unbindNavigationSync() {
        if (unsubPaneReady) {
            unsubPaneReady();
            unsubPaneReady = null;
        }
        if (unsubPaneScroll) {
            unsubPaneScroll();
            unsubPaneScroll = null;
        }
        if (unsubNavigate) {
            unsubNavigate();
            unsubNavigate = null;
        }
    }

    // 6. Escuchadores directos de teclado Alt/AltGr y blur dentro de la ventana web
    // Nota: Alt + Wheel se intercepta de forma nativa en C++ (whatsapp_window.cpp);
    // no registrar listeners wheel { passive: false } en JS para preservar el scroll GPU compositor.
    function onWindowKeyDown(e) {
        var isAltGrEvent = e.key === 'AltGraph' ||
                           e.key === 'ISO_Level3_Shift' ||
                           e.code === 'AltRight' ||
                           e.location === 2 ||
                           (e.getModifierState && e.getModifierState('AltGraph'));
        if (isAltGrEvent) {
            if (window.__waAltKeyDown) {
                window.__waAltKeyDown = false;
                hideAltBadges();
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
    }

    function onWindowKeyUp(e) {
        if (e.key === 'Alt' || e.key === 'AltGraph' || e.code === 'AltRight') {
            window.__waAltKeyDown = false;
            hideAltBadges();
        }
    }

    function onWindowBlur() {
        if (window.__waAltKeyDown) {
            window.__waAltKeyDown = false;
            hideAltBadges();
        }
    }

    function bindAltListeners() {
        if (altListenersBound || window.__waAltListenersAttached) return;
        altListenersBound = true;
        window.__waAltListenersAttached = true;
        if (typeof window.__waAltKeyDown !== 'boolean') {
            window.__waAltKeyDown = false;
        }
        window.addEventListener('keydown', onWindowKeyDown, true);
        window.addEventListener('keyup', onWindowKeyUp, true);
        window.addEventListener('blur', onWindowBlur);
    }

    function unbindAltListeners() {
        if (!altListenersBound) return;
        window.removeEventListener('keydown', onWindowKeyDown, true);
        window.removeEventListener('keyup', onWindowKeyUp, true);
        window.removeEventListener('blur', onWindowBlur);
        altListenersBound = false;
        window.__waAltListenersAttached = false;
    }

    ensureBadgeStyles();
    bindNavigationSync();
    bindAltListeners();

    app.altBadges = {
        STYLE_ELEMENT_ID: STYLE_ELEMENT_ID,
        BADGE_CLASS_NAME: BADGE_CLASS_NAME,
        FALLBACK_ACCENT_COLOR: FALLBACK_ACCENT_COLOR,
        NAV_BADGE_DELAY_MS: NAV_BADGE_DELAY_MS,
        ensureBadgeStyles: ensureBadgeStyles,
        refreshAccentColor: refreshAccentColor,
        showAltBadges: showAltBadges,
        hideAltBadges: hideAltBadges,
        clearNavBadgeTimers: clearNavBadgeTimers,
        scheduleNavBadgeRefresh: scheduleNavBadgeRefresh,
        isBadgeNode: isBadgeNode,
        ensurePaneBadgeObserver: ensurePaneBadgeObserver,
        syncBadgeObserver: syncBadgeObserver,
        bindNavigationSync: bindNavigationSync,
        unbindNavigationSync: unbindNavigationSync,
        bindAltListeners: bindAltListeners,
        unbindAltListeners: unbindAltListeners
    };

    // Contratos publicos consumidos por whatsapp_chat_bridge.cpp y diagnosticos
    window.__waRefreshAccentColor = refreshAccentColor;
    window.__waShowAltBadges = showAltBadges;
    window.__waHideAltBadges = hideAltBadges;
    window.__waSyncBadgeObserver = syncBadgeObserver;

    if (chatNav && typeof chatNav.ensurePaneListeners === 'function') {
        chatNav.ensurePaneListeners();
    }
})();
