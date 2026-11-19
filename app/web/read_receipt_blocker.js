(function() {
    'use strict';
    if (window.__waReadReceiptControllerInitialized) return;
    window.__waReadReceiptControllerInitialized = true;

    // Estado local: ventana activa momentanea de marcado de lectura
    window.__waMarkingSeenActive = false;
    window.__waHasRepliedInCurrentChat = false;

    var seenResetTimer = null;
    var readOnlyCheckTimer1 = null;
    var readOnlyCheckTimer2 = null;
    var lastContextRow = null;
    var lastContextRowTime = 0;

    var clearReadOnlyCheckTimers = function() {
        if (readOnlyCheckTimer1) {
            clearTimeout(readOnlyCheckTimer1);
            readOnlyCheckTimer1 = null;
        }
        if (readOnlyCheckTimer2) {
            clearTimeout(readOnlyCheckTimer2);
            readOnlyCheckTimer2 = null;
        }
    };

    // Interceptar hasFocus: WhatsApp Web solo envia confirmaciones de lectura (doble check azul)
    // cuando el documento reporta foco activo. Al devolver false de forma predeterminada,
    // se mantiene la lectura de mensajes en modo incognito (doble check gris para el remitente).
    var customHasFocus = function() {
        return !!window.__waMarkingSeenActive;
    };

    try {
        Document.prototype.hasFocus = customHasFocus;
    } catch (e) {}
    document.hasFocus = customHasFocus;

    var dispatchFocusEvents = function() {
        try {
            window.dispatchEvent(new FocusEvent('focus'));
            window.dispatchEvent(new Event('focus'));
            document.dispatchEvent(new Event('visibilitychange'));
        } catch (e) {}
    };

    // Cancelar cualquier ventana activa de marcado de lectura y volver a modo incognito
    window.__waCancelTemporarySeen = function() {
        if (seenResetTimer) {
            clearTimeout(seenResetTimer);
            seenResetTimer = null;
        }
        clearReadOnlyCheckTimers();
        window.__waMarkingSeenActive = false;
        window.__waHasRepliedInCurrentChat = false;
        try {
            window.dispatchEvent(new FocusEvent('blur'));
            window.dispatchEvent(new Event('blur'));
        } catch (e) {}
    };

    // Funcion central para forzar la emision de read receipts en WhatsApp Web sobre el chat activo
    window.__waTriggerSeenCore = function(skipRowReselect) {
        // 1. Notificar eventos de foco a nivel de ventana y documento
        dispatchFocusEvents();

        if (skipRowReselect) {
            return;
        }

        // 2. Re-despachar seleccion sobre el chat activo en la lista lateral (#pane-side)
        var activeRow = document.querySelector('#pane-side [aria-selected="true"]');
        if (!activeRow) {
            var header = document.querySelector('#main header');
            if (header) {
                var titleEl = header.querySelector('span[title]') || 
                              header.querySelector('div[data-testid="conversation-info-header"] span[title]') ||
                              header.querySelector('div[role="button"] span[dir="auto"]') ||
                              header.querySelector('span[dir="auto"]');
                var activeTitle = titleEl ? (titleEl.getAttribute('title') || titleEl.innerText || titleEl.textContent || '').trim().toLowerCase() : '';
                if (activeTitle) {
                    var allSpans = document.querySelectorAll('#pane-side span[title], #pane-side div[data-testid="cell-frame-title"] span, #pane-side span[dir="auto"]');
                    for (var i = 0; i < allSpans.length; i++) {
                        var text = (allSpans[i].getAttribute('title') || allSpans[i].innerText || allSpans[i].textContent || '').trim().toLowerCase();
                        if (text === activeTitle) {
                            activeRow = allSpans[i].closest('[role="row"], [role="listitem"]') || allSpans[i].closest('div[data-testid="cell-frame-container"]') || allSpans[i];
                            break;
                        }
                    }
                }
            }
        }

        if (activeRow) {
            if (window.__waSelectChatElement) {
                window.__waSelectChatElement(activeRow, true);
            } else {
                var clickTarget = activeRow.querySelector('div[data-testid="cell-frame-container"]') || activeRow;
                ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function(evtName) {
                    clickTarget.dispatchEvent(new MouseEvent(evtName, {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                        buttons: 1
                    }));
                });
            }
        }

        // 3. Restaurar foco en el campo de texto de #main solo si existe y no esta enfocado ya
        setTimeout(function() {
            var composer = document.querySelector('#main footer div[contenteditable="true"]') ||
                           document.querySelector('#main div[contenteditable="true"][data-tab="10"]');
            if (composer && document.activeElement !== composer) {
                composer.focus();
            }
        }, 50);
    };

    // Disparador temporal: habilita momentaneamente el marcado de los mensajes acumulados,
    // emite los eventos y se desactiva tras 1400 ms para que los mensajes que lleguen despues
    // sigan sin leerse (doble check gris) hasta que el usuario envie una nueva respuesta.
    window.__waTriggerTemporarySeen = function(skipRowReselect) {
        if (seenResetTimer) {
            clearTimeout(seenResetTimer);
            seenResetTimer = null;
        }
        clearReadOnlyCheckTimers();

        window.__waMarkingSeenActive = true;
        if (!skipRowReselect) {
            window.__waHasRepliedInCurrentChat = true;
        }

        // Emitir foco en t=0 para handlers sincronos (p. ej. "Marcar como leido" desde menu)
        dispatchFocusEvents();

        setTimeout(function() {
            if (window.__waTriggerSeenCore) window.__waTriggerSeenCore(!!skipRowReselect);
        }, 200);

        setTimeout(function() {
            if (window.__waTriggerSeenCore) window.__waTriggerSeenCore(!!skipRowReselect);
        }, 600);

        // Desactivar el estado de lectura tras una ventana de 1400 ms
        seenResetTimer = setTimeout(function() {
            window.__waMarkingSeenActive = false;
            window.__waHasRepliedInCurrentChat = false;
            seenResetTimer = null;
            try {
                window.dispatchEvent(new FocusEvent('blur'));
                window.dispatchEvent(new Event('blur'));
            } catch (e) {}
        }, 1400);
    };

    window.__waTriggerSeen = window.__waTriggerTemporarySeen;

    // Detecta estrictamente si la conversacion abierta en #main es de solo lectura (Comunidades / solo administradores / grupo cerrado)
    window.__waIsReadOnlyConversation = function() {
        var main = document.getElementById('main');
        if (!main) return false;
        var header = main.querySelector('header');
        if (!header) return false;
        var conversationBody = main.querySelector(
            '[data-testid="conversation-panel-messages"], [role="application"], [role="region"]'
        );
        if (!conversationBody) return false;

        var writableControl = main.querySelector(
            '[contenteditable="true"], [contenteditable="plaintext-only"], ' +
            '[role="textbox"], [data-tab="10"], textarea, ' +
            'footer [contenteditable], ' +
            '[data-icon="ptt"], [data-icon*="mic"], [data-testid*="ptt"], ' +
            '[data-icon="ptt-send"], [data-testid="ptt-send"], [data-testid="audio-send"], ' +
            '[data-icon="plus"], [data-icon="plus-rounded"], [data-icon="clip"], ' +
            '[data-icon="smiley"], [data-icon*="expressions"], ' +
            'button[data-testid="compose-btn-send"], [data-icon="wds-ic-send-filled"], [data-icon="send"]'
        );
        if (writableControl) return false;

        var bottomBar = main.querySelector('footer');
        if (!bottomBar) {
            var mainRect = main.getBoundingClientRect();
            if (mainRect.height > 0) {
                var children = main.children;
                for (var i = children.length - 1; i >= 0; i--) {
                    var child = children[i];
                    if (!child || child.tagName !== 'DIV' || child === header || child.contains(header)) {
                        continue;
                    }
                    var rect = child.getBoundingClientRect();
                    if (rect.width <= 0 || rect.height < 24 || rect.height > 130) {
                        continue;
                    }
                    var isAtBottom = (rect.top >= mainRect.top + mainRect.height * 0.4) &&
                        (rect.bottom >= mainRect.bottom - 32) &&
                        (rect.bottom <= mainRect.bottom + 16);
                    if (isAtBottom) {
                        bottomBar = child;
                        break;
                    }
                }
            }
        }
        if (!bottomBar) return false;

        if (bottomBar.querySelector('input, textarea, [contenteditable], [role="textbox"]')) {
            return false;
        }

        var readOnlySelector =
            '[data-testid*="read-only"], [data-testid*="only-admin"], [data-testid*="announcement"], ' +
            'span[data-icon*="announcement"], span[data-icon*="megaphone"]';
        var hasExplicitIndicator = (typeof bottomBar.matches === 'function' && bottomBar.matches(readOnlySelector)) ||
            bottomBar.querySelector(readOnlySelector) !== null;
        if (hasExplicitIndicator) {
            return true;
        }

        var bottomText = (bottomBar.innerText || bottomBar.textContent || '').trim();
        if (bottomText.length >= 10 && bottomText.length <= 260 &&
            /solo los administradores pueden enviar|only admins can send|only admins can post|apenas administradores podem enviar|no puedes enviar mensajes a este|you can't send messages to this|este grupo se cerr|this group has ended|solo quienes administran|only admins/i.test(bottomText)) {
            return true;
        }

        return false;
    };

    // Programa verificacion automatica a 450 ms y 950 ms tras abrir una conversacion
    window.__waScheduleReadOnlyChatCheck = function() {
        if (window.__waMarkingSeenActive) return;
        clearReadOnlyCheckTimers();

        readOnlyCheckTimer1 = setTimeout(function() {
            readOnlyCheckTimer1 = null;
            if (window.__waMarkingSeenActive || window.__waHasRepliedInCurrentChat) return;
            if (window.__waIsReadOnlyConversation && window.__waIsReadOnlyConversation()) {
                window.__waTriggerTemporarySeen();
            }
        }, 450);

        readOnlyCheckTimer2 = setTimeout(function() {
            readOnlyCheckTimer2 = null;
            if (window.__waMarkingSeenActive || window.__waHasRepliedInCurrentChat) return;
            if (window.__waIsReadOnlyConversation && window.__waIsReadOnlyConversation()) {
                window.__waTriggerTemporarySeen();
            }
        }, 950);
    };

    // Detecta la accion manual "Marcar como leido" / "Mark as read", excluyendo "no leido" / "unread"
    var isMarkAsReadMenuAction = function(target) {
        if (!target || !target.closest) return false;
        var item = target.closest(
            '[role="menuitem"], [role="option"], [data-animate-dropdown-item="true"], ' +
            'div[role="application"] li, div[role="application"] [role="button"], ' +
            'div[role="menu"] li, div[role="menu"] [role="button"], ' +
            'ul[role="menu"] li, ul[role="menu"] [role="button"], ' +
            'li[role="button"], li[tabindex]'
        );
        if (!item) {
            var fallback = target.closest('li, div[role="button"], button');
            if (fallback && !fallback.closest('#pane-side [role="row"], #pane-side [role="listitem"], #main')) {
                item = fallback;
            }
        }
        if (!item) return false;

        var iconEl = item.querySelector('[data-icon], [data-testid]');
        var dataIcon = ((item.getAttribute('data-icon') || '') + ' ' + (iconEl ? (iconEl.getAttribute('data-icon') || '') : '')).toLowerCase();
        var dataTestId = ((item.getAttribute('data-testid') || '') + ' ' + (iconEl ? (iconEl.getAttribute('data-testid') || '') : '')).toLowerCase();

        if (dataIcon.indexOf('unread') !== -1 || dataTestId.indexOf('unread') !== -1) {
            return false;
        }
        if (dataIcon.indexOf('mark-read') !== -1 || dataIcon.indexOf('mark_read') !== -1 ||
            dataTestId.indexOf('mark-read') !== -1 || dataTestId.indexOf('mark_read') !== -1) {
            return true;
        }

        var rawText = (item.innerText || item.textContent || item.getAttribute('aria-label') || '').trim();
        if (!rawText || rawText.length > 60) return false;

        var cleanText = (rawText.normalize ? rawText.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : rawText)
                        .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
                        .replace(/\s+/g, ' ')
                        .trim()
                        .toLowerCase();

        if (/\b(no\s+leid[oa]s?|unread|nao\s+lid[oa]s?|non\s+lu[es]?|non\s+lett[oi]|da\s+leggere|ungelesen|no\s+llegit[s]?)\b/.test(cleanText)) {
            return false;
        }

        return /^(marcar\s+(como\s+|todo\s+como\s+)?leid[oa]s?|mark\s+(all\s+)?as\s+read|marcar\s+(tudo\s+)?como\s+lid[oa]s?|marquer\s+(tout\s+)?comme\s+lu[es]?|segna\s+(tutto\s+)?come\s+(gia\s+)?lett[oi]|als\s+gelesen\s+markieren|marca\s+(tot\s+)?com\s+a\s+llegit[s]?)$/.test(cleanText);
    };

    var triggerManualMarkAsRead = function(onlyEnableFocus) {
        var skipRowReselect = false;
        if (lastContextRow && (Date.now() - lastContextRowTime) < 15000) {
            var isRowSelected = lastContextRow.getAttribute('aria-selected') === 'true' ||
                                lastContextRow.querySelector('[aria-selected="true"]') !== null;
            if (!isRowSelected) {
                skipRowReselect = true;
            }
        }
        if (onlyEnableFocus) {
            if (seenResetTimer) {
                clearTimeout(seenResetTimer);
            }
            window.__waMarkingSeenActive = true;
            dispatchFocusEvents();
            seenResetTimer = setTimeout(function() {
                window.__waMarkingSeenActive = false;
                window.__waHasRepliedInCurrentChat = false;
                seenResetTimer = null;
                try {
                    window.dispatchEvent(new FocusEvent('blur'));
                    window.dispatchEvent(new Event('blur'));
                } catch (e) {}
            }, 1400);
        } else {
            window.__waTriggerTemporarySeen(skipRowReselect);
        }
    };

    var recordPaneContextRow = function(event) {
        var target = event.target;
        if (!target || !target.closest) return;
        if (target.closest('#pane-side')) {
            var row = target.closest('[role="row"], [role="listitem"], div[data-testid="cell-frame-container"]');
            if (row) {
                lastContextRow = row;
                lastContextRowTime = Date.now();
            }
        }
    };
    document.addEventListener('contextmenu', recordPaneContextRow, true);
    document.addEventListener('pointerdown', recordPaneContextRow, true);
    document.addEventListener('mousedown', recordPaneContextRow, true);

    var handleManualReadPointerDown = function(event) {
        if (!event.isTrusted) return;
        if (isMarkAsReadMenuAction(event.target)) {
            triggerManualMarkAsRead(true);
        }
    };
    window.addEventListener('pointerdown', handleManualReadPointerDown, true);
    window.addEventListener('mousedown', handleManualReadPointerDown, true);

    // Al cambiar de chat mediante clic en #pane-side o panel de comunidades, reiniciar incognito y revisar solo lectura
    document.addEventListener('click', function(event) {
        if (!event.isTrusted) return;
        var target = event.target;
        if (!target) return;
        if (isMarkAsReadMenuAction(target)) {
            return;
        }
        if (target.closest('#pane-side')) {
            window.__waCancelTemporarySeen();
            if (window.__waScheduleReadOnlyChatCheck) {
                window.__waScheduleReadOnlyChatCheck();
            }
        } else if (target.closest('#side [role="listitem"], #side [role="row"], [data-wa-side-column="true"] [role="listitem"], [data-wa-side-column="true"] [role="row"]')) {
            if (window.__waScheduleReadOnlyChatCheck) {
                window.__waScheduleReadOnlyChatCheck();
            }
        }
    }, true);

    // Deteccion de envio por teclado (Enter en compositor/modal o sobre "Marcar como leido" en menu)
    window.addEventListener('keydown', function(event) {
        if ((event.key === 'Enter' || event.key === ' ') && isMarkAsReadMenuAction(event.target || document.activeElement)) {
            triggerManualMarkAsRead(false);
            return;
        }
        if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !event.isComposing) {
            var target = event.target;
            if (target && target.closest && target.closest('#side, #pane-side')) return;

            var popups = document.querySelectorAll(
                '#main [role="listbox"], [data-animate-modal-popup="true"] [role="listbox"], ' +
                '[data-testid*="mention-suggestion"], [data-testid*="mention-list"], ' +
                '[data-testid*="emoji-suggestion"], [data-testid*="autocomplete"], .wa-autocomplete'
            );
            for (var p = 0; p < popups.length; p++) {
                if (popups[p].offsetWidth > 0 && popups[p].offsetHeight > 0) {
                    return;
                }
            }

            var hasMediaSendBtn = function() {
                var icons = document.querySelectorAll(
                    'span[data-icon="wds-ic-send-filled"], span[data-icon*="send"], [data-testid*="send"]'
                );
                for (var i = 0; i < icons.length; i++) {
                    var ic = icons[i];
                    var btn = ic.closest('button, [role="button"]');
                    if (btn && !ic.closest('#main footer') && !ic.closest('#side') && (ic.offsetWidth > 0 || ic.offsetHeight > 0)) {
                        return true;
                    }
                }
                return false;
            };

            var editable = (target && target.closest) ? target.closest('[contenteditable="true"]') : null;
            if (!editable) {
                editable = document.querySelector('#main footer div[contenteditable="true"]') ||
                           document.querySelector('div[contenteditable="true"][data-tab="10"]');
            }
            var beforeText = editable ? (editable.innerText || editable.textContent || '').trim() : '';
            var mediaSendWasOpen = hasMediaSendBtn();

            if (beforeText.length > 0 || mediaSendWasOpen) {
                setTimeout(function() {
                    if (beforeText.length > 0 && editable && editable.isConnected) {
                        var afterText = (editable.innerText || editable.textContent || '').trim();
                        if (afterText.length === 0 || (mediaSendWasOpen && !hasMediaSendBtn())) {
                            window.__waTriggerTemporarySeen();
                        }
                    } else if (mediaSendWasOpen || (editable && !editable.isConnected)) {
                        window.__waTriggerTemporarySeen();
                    }
                }, 40);
            }
        }
    }, true);

    // Deteccion de envio por clic en el boton de enviar (audio/adjuntos/stickers/encuestas en cualquier idioma) o accion manual
    window.addEventListener('click', function(event) {
        if (!event.isTrusted) return;
        var target = event.target;
        if (!target || !target.closest) return;
        if (isMarkAsReadMenuAction(target)) {
            triggerManualMarkAsRead(false);
            return;
        }
        if (target.closest('#side, #pane-side')) return;
        var sendBtn = target.closest(
            'span[data-icon="wds-ic-send-filled"], span[data-icon*="send"], [data-icon*="send"], [data-testid*="send"], ' +
            'button[aria-label="Send"], button[aria-label="Enviar"], button[data-tab="11"], button[data-testid="compose-btn-send"], ' +
            'div[role="button"][aria-label="Send"], div[role="button"][aria-label="Enviar"], [role="button"][data-tab="11"], ' +
            '[data-icon="ptt-send"], [data-testid="ptt-send"], [data-testid="audio-send"], ' +
            '[data-testid="sticker"], [data-animate-picker="true"] [role="gridcell"], [data-testid="btn-create-poll"]'
        );
        if (!sendBtn) {
            var btnContainer = target.closest('button, [role="button"]');
            if (btnContainer) {
                sendBtn = btnContainer.querySelector(
                    'span[data-icon="wds-ic-send-filled"], span[data-icon*="send"], [data-icon*="send"], ' +
                    '[data-testid*="send"], [data-icon="ptt-send"], [data-testid="ptt-send"], [data-testid="audio-send"]'
                );
            }
        }
        var attrIcon = target.getAttribute('data-icon') || '';
        var attrTestId = target.getAttribute('data-testid') || '';
        if (sendBtn || attrIcon.indexOf('send') !== -1 || attrTestId.indexOf('send') !== -1) {
            window.__waTriggerTemporarySeen();
        }
    }, true);
})();
