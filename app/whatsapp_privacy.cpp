#include "whatsapp_window.h"

#include <QApplication>
#include <QSettings>
#include <QTimer>

void WhatsAppClient::setupPrivacyShortcut() {
    m_quickPrivacyMode = false;
    m_altBDown = false;
    m_altBHoldTriggered = false;

    m_altBHoldTimer = new QTimer(this);
    m_altBHoldTimer->setSingleShot(true);
    m_altBHoldTimer->setInterval(500);
    connect(m_altBHoldTimer, &QTimer::timeout, this, &WhatsAppClient::onAltBHeld);

    if (qApp) {
        qApp->installEventFilter(this);
    }
}

bool WhatsAppClient::isPrivacyActive() const {
    if (m_quickPrivacyMode) {
        return true;
    }
    if (m_lockOverlay && m_lockOverlay->isLocked()) {
        return true;
    }
    return false;
}

void WhatsAppClient::onAltBHeld() {
    m_altBHoldTriggered = true;
    lockApp();
}

void WhatsAppClient::showPrivacyInstructionsIfNeeded(const QString &mode) {
    QSettings settings("WhatsAppWebClient", "WhatsAppWebClient");
    if (settings.value("hide_privacy_instructions", false).toBool()) {
        return;
    }
    PrivacyInstructionDialog dialog(this, mode);
    dialog.exec();
}

void WhatsAppClient::toggleQuickPrivacy() {
    if (m_lockOverlay && m_lockOverlay->isLocked()) {
        return;
    }

    m_quickPrivacyMode = !m_quickPrivacyMode;
    if (m_quickPrivacyMode) {
        applyNativeBlur(18);
        QTimer::singleShot(150, this, [this]() {
            showPrivacyInstructionsIfNeeded("privacy");
        });
    } else {
        removeNativeBlur();
    }
}

void WhatsAppClient::lockApp() {
    show();
    activateWindow();
    m_quickPrivacyMode = false;
    if (m_lockOverlay) {
        m_lockOverlay->lock();
    }
    QTimer::singleShot(150, this, [this]() {
        showPrivacyInstructionsIfNeeded("lock");
    });
}

void WhatsAppClient::onAppLocked() {
    applyNativeBlur(24);
}

void WhatsAppClient::onAppUnlocked() {
    removeNativeBlur();
    m_quickPrivacyMode = false;
    m_browser->setFocus();
}

void WhatsAppClient::applyNativeBlur(int radius) {
    if (m_browser && m_browser->graphicsEffect()) {
        m_browser->setGraphicsEffect(nullptr);
    }
    if (!m_browser || !m_browser->page()) {
        return;
    }

    QString js = QString(R"JS(
        (function() {
            var overlay = document.getElementById('wa-privacy-blur-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'wa-privacy-blur-overlay';
                document.body.appendChild(overlay);
            }
            if (overlay) {
                overlay.style.cssText = 'position: fixed !important; ' +
                    'top: -50px !important; left: -50px !important; ' +
                    'right: -50px !important; bottom: -50px !important; ' +
                    'backdrop-filter: blur(%1px) !important; ' +
                    '-webkit-backdrop-filter: blur(%1px) !important; ' +
                    'background: rgba(11, 20, 26, 0.35) !important; ' +
                    'z-index: 999999 !important; ' +
                    'pointer-events: all !important; ' +
                    'user-select: none !important;';
            }
            var oldStyle = document.getElementById('wa-privacy-blur-style');
            if (oldStyle) {
                oldStyle.remove();
            }
        })();
    )JS").arg(radius);

    m_browser->page()->runJavaScript(js);
}

void WhatsAppClient::removeNativeBlur() {
    if (m_browser && m_browser->graphicsEffect()) {
        m_browser->setGraphicsEffect(nullptr);
    }
    if (!m_browser || !m_browser->page()) {
        return;
    }

    QString js = R"JS(
        (function() {
            var overlay = document.getElementById('wa-privacy-blur-overlay');
            if (overlay) {
                overlay.remove();
            }
            var oldStyle = document.getElementById('wa-privacy-blur-style');
            if (oldStyle) {
                oldStyle.remove();
            }
        })();
    )JS";

    m_browser->page()->runJavaScript(js);
}

void WhatsAppClient::openPinConfig() {
    PinConfigDialog dialog(this);
    dialog.exec();
}

void WhatsAppClient::toggleDndMode(bool checked) {
    m_dndMode = checked;
    if (m_browser && m_browser->page()) {
        m_browser->page()->setAudioMuted(m_dndMode);
    }
}

