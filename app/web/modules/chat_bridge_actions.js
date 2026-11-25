2/* Modulo JS 9: chat_bridge_actions.js
 * Responsabilidad: acciones de puente invocadas desde C++ (app/whatsapp_chat_bridge.cpp) para
 * extraer los chats recientes mostrados en el menu de bandeja (__waScrapeRecentChats) y enviar
 * mensajes a un chat desde respuestas rapidas o acciones externas (__waSendMessage).
 * Dependencias: window.__waApp.chatNavigation (getValidChats, findAndOpenChat; con respaldo a
 * window.__waGetValidChats y window.__waFindAndOpenChat) y ganchos opcionales de
 * app/web/read_receipt_blocker.js (__waTriggerTemporarySeen, __waTriggerSeen).
 */
    (function () {
        'use strict';
        var app = window.__waApp = window.__waApp || {};
        if (app.chatBridgeActions &&
            typeof window.__waScrapeRecentChats === 'function' &&
            typeof window.__waSendMessage === 'function') {
            return;
        }

        var chatNav = app.chatNavigation || null;

        var MAX_RECENT_CHATS = 10;
        var MAX_LAST_MSG_LENGTH = 50;
        var COMPOSER_POLL_INTERVAL_MS = 100;
        var MAX_COMPOSER_ATTEMPTS = 25;
        var SEND_POLL_INTERVAL_MS = 80;
        var MAX_SEND_ATTEMPTS = 10;

        var COMPOSER_SELECTORS = [
            '#main footer div[contenteditable="true"]',
            '#main div[contenteditable="true"][data-tab="10"]',
            '#main div[contenteditable="true"][role="textbox"]'
        ];

        var SEND_BUTTON_SELECTORS = [
            'span[data-icon="wds-ic-send-filled"]',
            'span[data-icon="send"]',
            'span[data-testid="send"]',
            'button[data-testid="compose-btn-send"]',
            'button[data-tab="11"]',
            'button[aria-label="Enviar"]',
            'button[aria-label="Send"]'
        ];

        function getRecentChatRows() {
            var validChats = [];
            if (chatNav && typeof chatNav.getValidChats === 'function') {
                validChats = chatNav.getValidChats();
            } else if (typeof window.__waGetValidChats === 'function') {
                validChats = window.__waGetValidChats();
            }
            if (!validChats || !validChats.length) {
                var pane = document.getElementById('pane-side');
                if (!pane) return [];
                validChats = pane.querySelectorAll('[role="row"], [role="listitem"]');
            }
            return validChats;
        }

        function scrapeRecentChats(maxCount) {
            var chats = [];
            var validChats = getRecentChatRows();
            if (!validChats || !validChats.length) {
                return JSON.stringify(chats);
            }

            var limit = (typeof maxCount === 'number' && maxCount > 0) ? maxCount : MAX_RECENT_CHATS;
            var count = Math.min(validChats.length, limit);
            for (var i = 0; i < count; i++) {
                var row = validChats[i];
                if (!row || typeof row.querySelector !== 'function') continue;
                var titleEl = row.querySelector('span[title]') || row.querySelector('span[dir="auto"]');
                var lastMsgEl = row.querySelector('span[data-testid="last-msg-status"]') ||
                    row.querySelector('span.matched-text') ||
                    row.querySelector('div[data-testid="cell-frame-secondary"] span span') ||
                    row.querySelector('[role="gridcell"]:last-child span');
                if (titleEl) {
                    var nameText = titleEl.getAttribute('title') || titleEl.textContent || '';
                    var trimmedName = nameText.trim();
                    if (trimmedName) {
                        var lastMsgText = (lastMsgEl && lastMsgEl.textContent)
                            ? lastMsgEl.textContent.substring(0, MAX_LAST_MSG_LENGTH).trim()
                            : '';
                        chats.push({
                            name: trimmedName,
                            lastMsg: lastMsgText
                        });
                    }
                }
            }
            return JSON.stringify(chats);
        }

        // Preserva compatibilidad cuando la ventana esta oculta en bandeja (innerWidth/innerHeight == 0)
        function isInteractiveElementVisible(el) {
            if (!el || !el.isConnected) return false;
            try {
                var style = window.getComputedStyle(el);
                if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
            } catch (e) { }
            if (window.innerWidth > 0 && window.innerHeight > 0 && el.getBoundingClientRect) {
                var rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            }
            return true;
        }

        function findComposer() {
            for (var i = 0; i < COMPOSER_SELECTORS.length; i++) {
                var matches = document.querySelectorAll(COMPOSER_SELECTORS[i]);
                for (var j = 0; j < matches.length; j++) {
                    if (isInteractiveElementVisible(matches[j])) {
                        return matches[j];
                    }
                }
            }
            return null;
        }

        function findSendButton() {
            var roots = [];
            var footer = document.querySelector('#main footer');
            if (footer) roots.push(footer);
            roots.push(document);

            for (var r = 0; r < roots.length; r++) {
                for (var s = 0; s < SEND_BUTTON_SELECTORS.length; s++) {
                    var matches = roots[r].querySelectorAll(SEND_BUTTON_SELECTORS[s]);
                    for (var j = 0; j < matches.length; j++) {
                        var btn = matches[j].closest('button, [role="button"]') || matches[j];
                        if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true' && isInteractiveElementVisible(btn)) {
                            return btn;
                        }
                    }
                }
            }
            return null;
        }

        function triggerSeenAfterSend() {
            if (typeof window.__waTriggerTemporarySeen === 'function') {
                window.__waTriggerTemporarySeen();
            } else if (typeof window.__waTriggerSeen === 'function') {
                setTimeout(window.__waTriggerSeen, 200);
                setTimeout(window.__waTriggerSeen, 600);
            } else {
                window.__waMarkingSeenActive = false;
            }
        }

        function insertTextIntoComposer(composer, msgText) {
            composer.focus();
            try {
                var range = document.createRange();
                range.selectNodeContents(composer);
                range.collapse(false);
                var sel = window.getSelection();
                if (sel) {
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
            } catch (e) { }

            document.execCommand('insertText', false, msgText);
            try {
                composer.dispatchEvent(new InputEvent('input', {
                    bubbles: true,
                    inputType: 'insertText',
                    data: msgText
                }));
            } catch (e) { }
        }

        function dispatchSendOrEnter(composer) {
            var sendAttempts = 0;
            var pollSend = function () {
                sendAttempts++;
                var btn = findSendButton();
                if (btn) {
                    btn.click();
                    triggerSeenAfterSend();
                    return;
                }
                if (sendAttempts < MAX_SEND_ATTEMPTS) {
                    setTimeout(pollSend, SEND_POLL_INTERVAL_MS);
                    return;
                }
                var remainingText = (composer.innerText || composer.textContent || '')
                    .replace(/[\u200B\uFEFF]/g, '')
                    .trim();
                if (remainingText.length > 0) {
                    composer.dispatchEvent(new KeyboardEvent('keydown', {
                        key: 'Enter',
                        code: 'Enter',
                        keyCode: 13,
                        which: 13,
                        bubbles: true,
                        cancelable: true
                    }));
                    triggerSeenAfterSend();
                } else {
                    window.__waMarkingSeenActive = false;
                }
            };
            setTimeout(pollSend, SEND_POLL_INTERVAL_MS);
        }

        function openChatHelper(targetChat, onOpened) {
            if (chatNav && typeof chatNav.findAndOpenChat === 'function') {
                return chatNav.findAndOpenChat(targetChat, onOpened);
            }
            if (typeof window.__waFindAndOpenChat === 'function') {
                return window.__waFindAndOpenChat(targetChat, onOpened);
            }
            return -1;
        }

        function sendMessage(targetChat, msgText) {
            return openChatHelper(targetChat, function () {
                var composerAttempts = 0;
                var pollComposer = function () {
                    composerAttempts++;
                    var composer = findComposer();
                    if (!composer) {
                        if (composerAttempts < MAX_COMPOSER_ATTEMPTS) {
                            setTimeout(pollComposer, COMPOSER_POLL_INTERVAL_MS);
                        }
                        return;
                    }

                    window.__waMarkingSeenActive = true;
                    insertTextIntoComposer(composer, msgText);
                    dispatchSendOrEnter(composer);
                };

                setTimeout(pollComposer, COMPOSER_POLL_INTERVAL_MS);
            });
        }

        app.chatBridgeActions = {
            MAX_RECENT_CHATS: MAX_RECENT_CHATS,
            MAX_LAST_MSG_LENGTH: MAX_LAST_MSG_LENGTH,
            COMPOSER_POLL_INTERVAL_MS: COMPOSER_POLL_INTERVAL_MS,
            MAX_COMPOSER_ATTEMPTS: MAX_COMPOSER_ATTEMPTS,
            SEND_POLL_INTERVAL_MS: SEND_POLL_INTERVAL_MS,
            MAX_SEND_ATTEMPTS: MAX_SEND_ATTEMPTS,
            COMPOSER_SELECTORS: COMPOSER_SELECTORS,
            SEND_BUTTON_SELECTORS: SEND_BUTTON_SELECTORS,
            getRecentChatRows: getRecentChatRows,
            scrapeRecentChats: scrapeRecentChats,
            isInteractiveElementVisible: isInteractiveElementVisible,
            findComposer: findComposer,
            findSendButton: findSendButton,
            triggerSeenAfterSend: triggerSeenAfterSend,
            insertTextIntoComposer: insertTextIntoComposer,
            dispatchSendOrEnter: dispatchSendOrEnter,
            sendMessage: sendMessage
        };

        // Contratos publicos consumidos por app/whatsapp_chat_bridge.cpp
        window.__waScrapeRecentChats = scrapeRecentChats;
        window.__waSendMessage = sendMessage;
    })();
