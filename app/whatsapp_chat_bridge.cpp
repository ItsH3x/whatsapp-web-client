#include "whatsapp_window.h"

#include <QFile>
#include <QIODevice>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QKeySequence>
#include <QStringList>
#include <QWebEngineScript>
#include <QWebEngineScriptCollection>

namespace {

QString loadWebAsset(const QString &resourcePath) {
    QFile file(resourcePath);
    if (!file.open(QIODevice::ReadOnly | QIODevice::Text)) {
        return {};
    }
    return QString::fromUtf8(file.readAll());
}

QString loadConcatenatedWebAssets(const QStringList &resourcePaths, const QString &separator) {
    QString combined;
    for (const QString &path : resourcePaths) {
        const QString chunk = loadWebAsset(path);
        if (!chunk.isEmpty()) {
            if (!combined.isEmpty()) {
                combined.append(separator);
            }
            combined.append(chunk);
        }
    }
    return combined;
}

QString toJsStringLiteral(const QString &value) {
    QJsonArray arr;
    arr.append(value);
    const QString json = QString::fromUtf8(QJsonDocument(arr).toJson(QJsonDocument::Compact));
    return json.mid(1, json.length() - 2);
}

} // namespace

void WhatsAppClient::setupChatShortcuts() {
    for (int i = 0; i < 10; ++i) {
        QAction *action = new QAction(this);
        action->setShortcut(QKeySequence(QString("Alt+%1").arg(i)));
        int chatIndex = (i == 0) ? 9 : (i - 1);
        connect(action, &QAction::triggered, this, [this, chatIndex]() {
            switchToChatByIndex(chatIndex);
        });
        addAction(action);
    }

    // Atajo para alternar el modo compacto de la barra lateral (Alt+M)
    QAction *toggleCompactAction = new QAction(this);
    toggleCompactAction->setShortcut(QKeySequence("Alt+M"));
    connect(toggleCompactAction, &QAction::triggered, this, &WhatsAppClient::toggleSidebarCompact);
    addAction(toggleCompactAction);
}

QString WhatsAppClient::getInitChatHelpersJs() const {
    static const QString script = loadWebAsset(QStringLiteral(":/web/chat_helpers.js"));
    return script;
}

QString WhatsAppClient::getReadReceiptBlockerJs() const {
    static const QString script = loadWebAsset(QStringLiteral(":/web/read_receipt_blocker.js"));
    return script;
}

QString WhatsAppClient::getSidebarEnhancementsJs() const {
    static const QString script = []() {
        QString js = loadWebAsset(QStringLiteral(":/web/sidebar_enhancements.js"));
        const QString css = loadConcatenatedWebAssets({
            QStringLiteral(":/web/styles/theme_accents.css"),
            QStringLiteral(":/web/styles/layout_columns.css"),
            QStringLiteral(":/web/styles/resizers_overlays.css"),
            QStringLiteral(":/web/styles/compact_mode.css"),
        }, QStringLiteral("\n\n"));
        js.replace(QStringLiteral("__WA_SIDEBAR_CSS__"), toJsStringLiteral(css));
        return js;
    }();
    return script;
}

void WhatsAppClient::setupWebScripts() {
    if (!m_profile) return;

    auto insertScript = [this](const QString &name, const QString &source, QWebEngineScript::InjectionPoint point) {
        QWebEngineScript script;
        script.setName(name);
        script.setSourceCode(source);
        script.setInjectionPoint(point);
        script.setWorldId(QWebEngineScript::MainWorld);
        script.setRunsOnSubFrames(false);
        m_profile->scripts()->insert(script);
    };

    insertScript(QStringLiteral("WAWebReadReceiptController"), getReadReceiptBlockerJs(), QWebEngineScript::DocumentCreation);
    insertScript(QStringLiteral("WAWebSidebarEnhancements"), getSidebarEnhancementsJs(), QWebEngineScript::DocumentReady);
    insertScript(QStringLiteral("WAWebChatHelpers"), getInitChatHelpersJs(), QWebEngineScript::DocumentReady);
}

void WhatsAppClient::toggleSidebarCompact() {
    if (m_browser && m_browser->page()) {
        m_browser->page()->runJavaScript(QStringLiteral("if (window.__waToggleSidebarCompact) { window.__waToggleSidebarCompact(); }"));
    }
}

void WhatsAppClient::initChatHelpers() {
    if (m_browser && m_browser->page()) {
        m_browser->page()->runJavaScript(getInitChatHelpersJs());
    }
}

void WhatsAppClient::switchToChatByIndex(int index) {
    if (m_lockOverlay && m_lockOverlay->isLocked()) {
        return;
    }

    m_currentChatIndex = index;

    runChatJs(QStringLiteral(R"JS(
        var validChats = window.__waGetValidChats();
        if (validChats.length > %1) {
            var target = validChats[%1];
            window.__waCurrentChatIndex = %1;
            window.__waHasRepliedInCurrentChat = false;
            window.__waMarkingSeenActive = false;
            if (window.__waCancelTemporarySeen) {
                window.__waCancelTemporarySeen();
            }
            window.__waSelectChatElement(target);
            if (window.__waAltKeyDown) {
                window.__waShowAltBadges();
            }
        }
        return %1;
    )JS").arg(index));
}

// Ejecuta un cuerpo JS que depende de los helpers de chat sin re-inyectar el bloque completo
// de getInitChatHelpersJs() en cada atajo. Si los helpers aun no existen (p. ej. tras recargar),
// se inyectan una sola vez y se reintenta.
void WhatsAppClient::runChatJs(const QString &body, std::function<void(const QVariant &)> callback, bool retried) {
    if (!m_browser || !m_browser->page()) {
        return;
    }
    const QString wrapped = QStringLiteral("(function(){ if (!window.__waGetValidChats || !window.__waSelectChatElement || !window.__waNavigateChat || !window.__waShowAltBadges || !window.__waFindAndOpenChat) { return '__wa_need_init__'; }\n")
                            + body + QStringLiteral("\n})();");
    m_browser->page()->runJavaScript(wrapped, [this, body, callback, retried](const QVariant &result) {
        if (result.toString() == QLatin1String("__wa_need_init__")) {
            if (!retried && m_browser && m_browser->page()) {
                m_browser->page()->runJavaScript(getInitChatHelpersJs());
                runChatJs(body, callback, true);
            }
            return;
        }
        if (callback) {
            callback(result);
        }
    });
}

void WhatsAppClient::navigateChatByOffset(int offset) {
    if (m_lockOverlay && m_lockOverlay->isLocked()) {
        return;
    }
    if (m_quickPrivacyMode) {
        return;
    }

    runChatJs(QStringLiteral("window.__waAltKeyDown = true; return window.__waNavigateChat(%1);").arg(offset),
              [this](const QVariant &result) {
        bool ok = false;
        int idx = result.toInt(&ok);
        if (ok && idx >= 0) {
            m_currentChatIndex = idx;
        }
    });
}

void WhatsAppClient::showChatBadges() {
    if (isPrivacyActive()) {
        return;
    }

    runChatJs(QStringLiteral("window.__waAltKeyDown = true; window.__waShowAltBadges(); return 0;"));
}

void WhatsAppClient::hideChatBadges() {
    QString js = R"JS(
    window.__waAltKeyDown = false;
    if (window.__waHideAltBadges) {
        window.__waHideAltBadges();
    } else {
        document.querySelectorAll('.wa-alt-badge').forEach(function(el) { el.remove(); });
    }
    )JS";

    if (m_browser && m_browser->page()) {
        m_browser->page()->runJavaScript(js);
    }
}

void WhatsAppClient::scrapeRecentChats() {
    QString js = R"JS(
    (function() {
        var chats = [];
        var validChats = (window.__waGetValidChats) ? window.__waGetValidChats() : [];
        if (!validChats.length) {
            var pane = document.getElementById('pane-side');
            if (!pane) return JSON.stringify(chats);
            validChats = pane.querySelectorAll('[role="row"], [role="listitem"]');
        }

        var count = Math.min(validChats.length, 10);
        for (var i = 0; i < count; i++) {
            var row = validChats[i];
            var titleEl = row.querySelector('span[title]') || row.querySelector('span[dir="auto"]');
            var lastMsgEl = row.querySelector('span[data-testid="last-msg-status"]') ||
                            row.querySelector('span.matched-text') ||
                            row.querySelector('div[data-testid="cell-frame-secondary"] span span') ||
                            row.querySelector('[role="gridcell"]:last-child span');
            if (titleEl) {
                var nameText = titleEl.getAttribute('title') || titleEl.textContent || '';
                if (nameText.trim()) {
                    chats.push({
                        name: nameText.trim(),
                        lastMsg: lastMsgEl ? lastMsgEl.textContent.substring(0, 50).trim() : ''
                    });
                }
            }
        }
        return JSON.stringify(chats);
    })();
    )JS";

    if (m_browser && m_browser->page()) {
        m_browser->page()->runJavaScript(js, [this](const QVariant &result) {
            onChatsScraped(result.toString());
        });
    }
}

void WhatsAppClient::onChatsScraped(const QString &result) {
    if (result.isEmpty()) return;
    QJsonDocument doc = QJsonDocument::fromJson(result.toUtf8());
    if (doc.isArray()) {
        QJsonArray arr = doc.array();
        m_recentChats.clear();
        for (const QJsonValue &val : arr) {
            if (val.isObject()) {
                QJsonObject obj = val.toObject();
                RecentChat chat;
                chat.name = obj.value("name").toString();
                chat.lastMsg = obj.value("lastMsg").toString();
                m_recentChats.append(chat);
            }
        }
    }
}

void WhatsAppClient::openChat(const QString &chatName) {
    show();
    activateWindow();

    const QString jsonChat = toJsStringLiteral(chatName);
    QString js = QString(R"JS(
        var targetName = %1;
        if (window.__waCancelTemporarySeen) {
            window.__waCancelTemporarySeen();
        }
        return window.__waFindAndOpenChat(targetName, function() {
            if (window.__waScheduleReadOnlyChatCheck) {
                window.__waScheduleReadOnlyChatCheck();
            }
        });
    )JS").arg(jsonChat);

    runChatJs(js);
}

void WhatsAppClient::sendWhatsAppMessage(const QString &chatName, const QString &text) {
    const QString jsonChat = toJsStringLiteral(chatName);
    const QString jsonText = toJsStringLiteral(text);

    QString js = QString(R"JS(
        var targetChat = %1;
        var msgText = %2;
        return window.__waFindAndOpenChat(targetChat, function() {
            var isVisible = function(el) {
                if (!el || !el.isConnected) return false;
                try {
                    var style = window.getComputedStyle(el);
                    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
                } catch (e) {}
                if (window.innerWidth > 0 && window.innerHeight > 0 && el.getBoundingClientRect) {
                    var rect = el.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                }
                return true;
            };

            var findComposer = function() {
                var selectors = [
                    '#main footer div[contenteditable="true"]',
                    '#main div[contenteditable="true"][data-tab="10"]',
                    '#main div[contenteditable="true"][role="textbox"]'
                ];
                for (var i = 0; i < selectors.length; i++) {
                    var matches = document.querySelectorAll(selectors[i]);
                    for (var j = 0; j < matches.length; j++) {
                        if (isVisible(matches[j])) {
                            return matches[j];
                        }
                    }
                }
                return null;
            };

            var findSendButton = function() {
                var roots = [];
                var footer = document.querySelector('#main footer');
                if (footer) roots.push(footer);
                roots.push(document);
                var selectors = [
                    'span[data-icon="wds-ic-send-filled"]',
                    'span[data-icon="send"]',
                    'span[data-testid="send"]',
                    'button[data-testid="compose-btn-send"]',
                    'button[data-tab="11"]',
                    'button[aria-label="Enviar"]',
                    'button[aria-label="Send"]'
                ];
                for (var r = 0; r < roots.length; r++) {
                    for (var s = 0; s < selectors.length; s++) {
                        var matches = roots[r].querySelectorAll(selectors[s]);
                        for (var j = 0; j < matches.length; j++) {
                            var btn = matches[j].closest('button, [role="button"]') || matches[j];
                            if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true' && isVisible(btn)) {
                                return btn;
                            }
                        }
                    }
                }
                return null;
            };

            var triggerSeen = function() {
                if (window.__waTriggerTemporarySeen) {
                    window.__waTriggerTemporarySeen();
                } else if (window.__waTriggerSeen) {
                    setTimeout(window.__waTriggerSeen, 200);
                    setTimeout(window.__waTriggerSeen, 600);
                } else {
                    window.__waMarkingSeenActive = false;
                }
            };

            var composerAttempts = 0;
            var maxComposerAttempts = 25;
            var pollComposer = function() {
                composerAttempts++;
                var composer = findComposer();
                if (!composer) {
                    if (composerAttempts < maxComposerAttempts) {
                        setTimeout(pollComposer, 100);
                    }
                    return;
                }

                window.__waMarkingSeenActive = true;
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
                } catch (e) {}

                document.execCommand('insertText', false, msgText);
                try {
                    composer.dispatchEvent(new InputEvent('input', {
                        bubbles: true,
                        inputType: 'insertText',
                        data: msgText
                    }));
                } catch (e) {}

                var sendAttempts = 0;
                var maxSendAttempts = 10;
                var pollSend = function() {
                    sendAttempts++;
                    var btn = findSendButton();
                    if (btn) {
                        btn.click();
                        triggerSeen();
                        return;
                    }
                    if (sendAttempts < maxSendAttempts) {
                        setTimeout(pollSend, 80);
                        return;
                    }
                    var remainingText = (composer.innerText || composer.textContent || '').replace(/[\u200B\uFEFF]/g, '').trim();
                    if (remainingText.length > 0) {
                        composer.dispatchEvent(new KeyboardEvent('keydown', {
                            key: 'Enter',
                            code: 'Enter',
                            keyCode: 13,
                            which: 13,
                            bubbles: true,
                            cancelable: true
                        }));
                        triggerSeen();
                    } else {
                        window.__waMarkingSeenActive = false;
                    }
                };
                setTimeout(pollSend, 80);
            };

            setTimeout(pollComposer, 100);
        });
    )JS").arg(jsonChat, jsonText);

    runChatJs(js);
}

