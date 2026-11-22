#include "whatsapp_window.h"

#include <QApplication>
#include <QColor>
#include <QRegularExpression>
#include <QSettings>
#include <QTimer>

namespace {

QColor parseCssColorString(const QString &raw) {
    const QString s = raw.trimmed();
    if (s.isEmpty()) {
        return QColor();
    }
    if (s.startsWith(QLatin1Char('#'))) {
        return QColor(s);
    }
    static const QRegularExpression rgbRe(QStringLiteral(R"(^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3}))"));
    const QRegularExpressionMatch m = rgbRe.match(s);
    if (m.hasMatch()) {
        return QColor(m.captured(1).toInt(), m.captured(2).toInt(), m.captured(3).toInt());
    }
    return QColor();
}

} // namespace

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

void WhatsAppClient::syncLockOverlayAccent() {
    if (!m_lockOverlay || !m_browser || !m_browser->page()) {
        return;
    }
    const QString js = QStringLiteral(R"JS(
        (function() {
            var root = document.documentElement;
            if (!root) return '';
            var cs = window.getComputedStyle(root);
            var accent = (window.__waAppliedDynamicAccent || cs.getPropertyValue('--wa-dynamic-accent') || '').trim();
            var fg = (cs.getPropertyValue('--wa-dynamic-accent-fg') || '').trim();
            return accent + '|' + fg;
        })();
    )JS");
    m_browser->page()->runJavaScript(js, [this](const QVariant &res) {
        if (!m_lockOverlay) {
            return;
        }
        const QString packed = res.toString();
        if (packed.isEmpty()) {
            return;
        }
        const QStringList parts = packed.split(QLatin1Char('|'));
        const QColor accent = parseCssColorString(parts.value(0));
        const QColor fg = parseCssColorString(parts.value(1));
        if (accent.isValid()) {
            m_lockOverlay->setAccentColors(accent, fg);
        }
    });
}

void WhatsAppClient::lockApp() {
    show();
    activateWindow();
    m_quickPrivacyMode = false;
    ensureLockOverlay();
    syncLockOverlayAccent();
    if (m_lockOverlay) {
        m_lockOverlay->lock();
    }
    QTimer::singleShot(150, this, [this]() {
        showPrivacyInstructionsIfNeeded("lock");
    });
}

void WhatsAppClient::onAppLocked() {
    syncLockOverlayAccent();
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

