/* Modulo JS 6: bootstrap.js
 * Responsabilidad: punto de entrada y coordinador del ciclo de vida de la capa modular de barra lateral.
 * Inyecta la hoja de estilos consolidada, inicializa en orden determinista core/accent/layout/resizers/compact,
 * registra listeners globales de puntero/teclado/visibilidad/resize y opera el enrutador unico de
 * MutationObserver que despacha cada dominio sucio exclusivamente al modulo correspondiente.
 * Dependencias: window.__waApp.core, accent, layout, resizers y compact (exclusivamente).
 */
(function() {
    'use strict';
    var app = window.__waApp = window.__waApp || {};
    if (app.bootstrap || window.__waSidebarEnhancementsInitialized) return;
    var core = app.core;
    var accent = app.accent;
    var layout = app.layout;
    var resizers = app.resizers;
    var compact = app.compact;
    if (!core || !accent || !layout || !resizers || !compact) return;

    var STYLE_ELEMENT_ID = 'wa-sidebar-enhancements-style';
    var MAX_DEFERRED_GREEN_TARGETS = 24;
    var SIDE_GREEN_SCOPE_SELECTOR = '#side, [data-wa-nav-rail="true"], [data-wa-side-column="true"], [data-wa-tab-side-column="true"], [data-wa-left-drawer="true"], #app > div > header';

    var getSavedWidth = core.getSavedWidth;
    var isCompactActive = core.isCompactActive;
    var hideHoverTooltip = compact.hideHoverTooltip;

    var initialized = false;
    var listenersBound = false;
    var mainObserverConnected = false;
    var visualObserversPaused = false;
    var mutationSyncRaf = null;

    var dirtyLayout = false;
    var dirtyOverlay = false;
    var dirtySideNav = false;
    var dirtyPaneSide = false;
    var dirtyMainChanged = false;
    var dirtyTheme = false;

    function injectStyles() {
        var existing = document.getElementById(STYLE_ELEMENT_ID);
        if (existing) {
            existing.remove();
        }
        var style = document.createElement('style');
        style.id = STYLE_ELEMENT_ID;
        style.textContent = __WA_SIDEBAR_CSS__;
        var host = document.head || document.documentElement;
        if (host) {
            host.appendChild(style);
        }
        return style;
    }

    function onGlobalPointerMove(e) {
        compact.handleCompactTooltipPointerMove(e);
        resizers.handlePointerMove(e.clientX, e.clientY);
    }

    function onGlobalPointerDown(e) {
        if (!e || !e.isTrusted) return;
        hideHoverTooltip();
        resizers.handlePointerDown(e);
    }

    function onVisibilityChange() {
        if (document.hidden) {
            pauseVisualObservers();
        } else {
            resumeVisualObservers();
        }
    }

    function onWindowResize() {
        if (document.hidden) return;
        hideHoverTooltip();
        resizers.syncFloatingPickerBounds();
        if (!isCompactActive()) {
            var curWidth = getSavedWidth();
            layout.setSidebarWidth(curWidth, false);
        }
        if (document.querySelector('[data-wa-right-column="true"]')) {
            layout.setRightPanelWidth(layout.getSavedRightWidth(), false);
        } else {
            resizers.updateRightResizerPosition();
            layout.scheduleMainScaleUpdate();
        }
        layout.scheduleMainScaleUpdate();
        resizers.scheduleResizerOverlayCheck();
    }

    function bindGlobalListeners() {
        if (listenersBound) return;
        document.addEventListener('pointermove', onGlobalPointerMove, { passive: true, capture: true });
        document.addEventListener('pointerdown', onGlobalPointerDown, { capture: true });
        document.addEventListener('keydown', hideHoverTooltip, { passive: true, capture: true });
        document.addEventListener('mouseleave', hideHoverTooltip, { passive: true });
        window.addEventListener('blur', hideHoverTooltip);
        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('resize', onWindowResize);
        listenersBound = true;
    }

    function unbindGlobalListeners() {
        if (!listenersBound) return;
        document.removeEventListener('pointermove', onGlobalPointerMove, { capture: true });
        document.removeEventListener('pointerdown', onGlobalPointerDown, { capture: true });
        document.removeEventListener('keydown', hideHoverTooltip, { capture: true });
        document.removeEventListener('mouseleave', hideHoverTooltip);
        window.removeEventListener('blur', hideHoverTooltip);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('resize', onWindowResize);
        listenersBound = false;
    }

    function isInternalMutationNode(node) {
        if (!node || node.nodeType !== 1) return false;
        if (node.id === STYLE_ELEMENT_ID) return true;
        if (accent.isInternalNode(node) || resizers.isInternalNode(node) || compact.isInternalNode(node)) return true;
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

    function markDirty(domains) {
        if (!domains) return;
        if (domains.layout) dirtyLayout = true;
        if (domains.overlay) dirtyOverlay = true;
        if (domains.sideNav) dirtySideNav = true;
        if (domains.paneSide) dirtyPaneSide = true;
        if (domains.mainChanged) dirtyMainChanged = true;
        if (domains.theme) dirtyTheme = true;
    }

    function flushDirtyDomains() {
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

        var isAnimatingCompact = compact.isAnimating();
        if (runLayout || runSideNav) {
            compact.ensureToggleButton();
        }
        if (!isAnimatingCompact && (runLayout || runSideNav || (runPaneSide && isCompactActive()))) {
            compact.syncAvatarTooltips();
        }
        if (runLayout || runTheme) {
            accent.observeThemeRoots();
        }
        if ((runLayout || runPaneSide || runSideNav) && window.__waEnsurePaneListeners) {
            window.__waEnsurePaneListeners();
        }
        if (!isAnimatingCompact) {
            if (runLayout) {
                var c = layout.resolveLayoutContainers();
                if (c && c.flexContainer) {
                    layout.syncAuxDrawers(c.flexContainer, c.sideColumn, c.mainColumn);
                }
                resizers.ensureRightResizer();
                resizers.updateRightResizerPosition();
                layout.ensureMainResizeObserver();
                if (!isCompactActive()) {
                    resizers.initResizer();
                    var sEl = document.querySelector('#side');
                    if (sEl && !sEl.__waWidthApplied) {
                        sEl.__waWidthApplied = true;
                        layout.setSidebarWidth(layout.getCurrentSidebarWidth() || getSavedWidth(), false);
                    }
                } else if (document.querySelector('#side') &&
                           (!document.querySelector('[data-wa-side-column="true"]') ||
                            !document.querySelector('#side').__waCompactApplied)) {
                    compact.applyCompactInline();
                }
                layout.scheduleMainScaleUpdate();
            } else if (runMainChanged) {
                layout.ensureMainResizeObserver();
                if (document.querySelector('[data-wa-right-column="true"]')) {
                    layout.scheduleMainScaleUpdate();
                }
            }
            if (runLayout || runTheme) {
                accent.scheduleAccentSync(false);
            }
        }
        if (runLayout || runOverlay) {
            resizers.scheduleResizerOverlayCheck();
        }
    }

    function scheduleMutationSync() {
        if (document.hidden) return;
        if (mutationSyncRaf) return;
        mutationSyncRaf = window.requestAnimationFrame(function() {
            mutationSyncRaf = null;
            if (document.hidden) return;
            flushDirtyDomains();
        });
    }

    function handleMutations(mutations) {
        if (document.hidden) return;
        var onlyInternal = mutations.length > 0;
        var mainEl = document.getElementById('main');
        var cachedLayout = layout.getCachedContainers();
        var mainColEl = (cachedLayout.mainColumn && cachedLayout.mainColumn.isConnected)
            ? cachedLayout.mainColumn
            : document.querySelector('[data-wa-main-column="true"]');
        var paneSideEl = document.getElementById('pane-side');
        var sideEl = document.getElementById('side');
        var mainHeaderEl = mainEl ? mainEl.querySelector('header') : null;
        var mainFooterEl = mainEl ? mainEl.querySelector('footer') : null;
        var tabShellEl = document.querySelector('[data-wa-tab-shell="true"]');
        var rightColEl = document.querySelector('[data-wa-right-column="true"]');
        var hasAddedPopupOrMain = false;
        var isOpeningPickerNow = resizers.isPickerOpening();
        var isAnimatingNow = compact.isAnimating();
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
                if (tabShellEl) {
                    dirtyLayout = true;
                }
                if (isOpeningPickerNow) {
                    dirtyOverlay = true;
                }
            } else if (inSide) {
                dirtySideNav = true;
            } else if (inTabShell) {
                if (tgt === tabShellEl ||
                    !tabShellEl.querySelector('[data-wa-tab-side-column="true"]') ||
                    (tgt.closest && tgt.closest('[data-testid="drawer-middle"]'))) {
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
                        if (!mainColEl || tabShellEl) dirtyLayout = true;
                    } else if (added.id === 'side' || added.id === 'pane-side') {
                        dirtyLayout = true;
                        dirtySideNav = true;
                        dirtyTheme = true;
                    } else if (!inPaneSide && added.querySelector && added.querySelector('#main')) {
                        dirtyMainChanged = true;
                        dirtyTheme = true;
                        if (!mainColEl || tabShellEl) dirtyLayout = true;
                    }

                    if (isOpeningPickerNow ||
                        (!inPaneSide && resizers.nodeMatchesOverlayOrPopup(added)) ||
                        (inPaneSide && added.matches && added.matches(resizers.POPUP_MUTATION_SELECTOR))) {
                        hasAddedPopupOrMain = true;
                        dirtyOverlay = true;
                    }

                    if (!isAnimatingNow) {
                        if (inPaneSide) {
                            if (addedPaneGreenTargets.length < MAX_DEFERRED_GREEN_TARGETS) {
                                addedPaneGreenTargets.push(added);
                            }
                        } else if (addedSideGreenTargets.length < MAX_DEFERRED_GREEN_TARGETS &&
                                   added.closest && added.closest(SIDE_GREEN_SCOPE_SELECTOR)) {
                            addedSideGreenTargets.push(added);
                        }
                    }
                }
            }

            if (mut.removedNodes && mut.removedNodes.length > 0 && (!dirtyOverlay || (!dirtyLayout && !inPaneSide && !inMain))) {
                for (var rn = 0; rn < mut.removedNodes.length; rn++) {
                    var rem = mut.removedNodes[rn];
                    if (!rem || rem.nodeType !== 1 || isInternalMutationNode(rem)) continue;
                    if (!dirtyOverlay && !inPaneSide && resizers.nodeMatchesOverlayOrPopup(rem)) {
                        dirtyOverlay = true;
                    }
                    if (!dirtyLayout && !inPaneSide && !inMain &&
                        (rem.id === 'side' ||
                         (rem.id === 'main' && tabShellEl) ||
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
            accent.scheduleDeferredGreenTagging(addedPaneGreenTargets, addedSideGreenTargets);
        }

        // Pre-paint clamping en microtask para evitar que el picker de emojis pinte fuera de pantalla en el frame 1
        if (hasAddedPopupOrMain) {
            resizers.syncFloatingPickerBounds();
        }

        scheduleMutationSync();
    }

    var observer = new MutationObserver(handleMutations);

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
        accent.clearDeferredGreenTagging();
        layout.disconnectMainResizeObserver();
        resizers.cancelScheduledOverlayCheck();
        resizers.disconnectPanelResizeObservers();
        hideHoverTooltip();
    }

    function resumeVisualObservers() {
        if (!visualObserversPaused) return;
        visualObserversPaused = false;
        connectMainObserver();
        markDirty({
            layout: true,
            overlay: true,
            sideNav: true,
            theme: true
        });
        scheduleMutationSync();
    }

    function getLifecycleState() {
        return {
            initialized: initialized,
            listenersBound: listenersBound,
            mainObserverConnected: mainObserverConnected,
            visualObserversPaused: visualObserversPaused,
            mutationSyncPending: !!mutationSyncRaf,
            dirty: {
                layout: dirtyLayout,
                overlay: dirtyOverlay,
                sideNav: dirtySideNav,
                paneSide: dirtyPaneSide,
                mainChanged: dirtyMainChanged,
                theme: dirtyTheme
            }
        };
    }

    function isPaused() {
        return visualObserversPaused;
    }

    function isMainObserverConnected() {
        return mainObserverConnected;
    }

    function init() {
        if (initialized || window.__waSidebarEnhancementsInitialized) return false;
        initialized = true;
        window.__waSidebarEnhancementsInitialized = true;

        injectStyles();

        resizers.bindLayoutSync();
        compact.bindResizerSync();

        if (!compact.restoreSavedCompactState()) {
            var initialWidth = getSavedWidth();
            layout.setSidebarWidth(initialWidth, false);
        }

        resizers.initResizer();
        compact.ensureToggleButton();
        compact.syncAvatarTooltips();
        layout.ensureMainResizeObserver();
        layout.scheduleMainScaleUpdate();
        accent.syncDynamicAccent();
        accent.observeThemeRoots();
        var initPtr = resizers.getLastPointerPosition();
        resizers.syncResizerOverlayState(initPtr.x, initPtr.y);

        bindGlobalListeners();

        if (document.hidden) {
            visualObserversPaused = true;
        } else {
            connectMainObserver();
        }
        return true;
    }

    app.bootstrap = {
        STYLE_ELEMENT_ID: STYLE_ELEMENT_ID,
        MAX_DEFERRED_GREEN_TARGETS: MAX_DEFERRED_GREEN_TARGETS,
        SIDE_GREEN_SCOPE_SELECTOR: SIDE_GREEN_SCOPE_SELECTOR,
        injectStyles: injectStyles,
        init: init,
        bindGlobalListeners: bindGlobalListeners,
        unbindGlobalListeners: unbindGlobalListeners,
        isInternalMutationNode: isInternalMutationNode,
        isInternalMutationRecord: isInternalMutationRecord,
        markDirty: markDirty,
        flushDirtyDomains: flushDirtyDomains,
        scheduleMutationSync: scheduleMutationSync,
        connectMainObserver: connectMainObserver,
        pauseVisualObservers: pauseVisualObservers,
        resumeVisualObservers: resumeVisualObservers,
        getLifecycleState: getLifecycleState,
        isPaused: isPaused,
        isMainObserverConnected: isMainObserverConnected
    };

    init();
})();
