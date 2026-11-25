#include "lock_overlay.h"
#include "config_manager.h"

#include <QContextMenuEvent>
#include <QEasingCurve>
#include <QFrame>
#include <QGraphicsDropShadowEffect>
#include <QHBoxLayout>
#include <QIntValidator>
#include <QKeyEvent>
#include <QLabel>
#include <QLineEdit>
#include <QMouseEvent>
#include <QPainter>
#include <QPropertyAnimation>
#include <QPushButton>
#include <QSettings>
#include <QTimer>
#include <QVBoxLayout>
#include <QWheelEvent>
#include <algorithm>
#include <cmath>

// ============================================================================
// LockOverlay Implementation
// ============================================================================

const QString LockOverlay::s_pillStyleNormal = QStringLiteral(R"(
    QFrame#pillFrame {
        background: qlineargradient(
            x1: 0, y1: 0, x2: 1, y2: 1,
            stop: 0 rgba(26, 33, 42, 0.94),
            stop: 1 rgba(16, 21, 28, 0.96)
        );
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 28px;
    }
)");

const QString LockOverlay::s_pillStyleError = QStringLiteral(R"(
    QFrame#pillFrame {
        background: qlineargradient(
            x1: 0, y1: 0, x2: 1, y2: 1,
            stop: 0 rgba(45, 22, 28, 0.96),
            stop: 1 rgba(25, 15, 18, 0.98)
        );
        border: 1.5px solid #ff453a;
        border-radius: 28px;
    }
)");

namespace {

double srgbChannelToLinear(int channel) {
    const double v = static_cast<double>(channel) / 255.0;
    return v <= 0.03928 ? (v / 12.92) : std::pow((v + 0.055) / 1.055, 2.4);
}

double relativeLuminance(const QColor &c) {
    return 0.2126 * srgbChannelToLinear(c.red())
         + 0.7152 * srgbChannelToLinear(c.green())
         + 0.0722 * srgbChannelToLinear(c.blue());
}

double contrastRatio(const QColor &c1, const QColor &c2) {
    const double l1 = relativeLuminance(c1);
    const double l2 = relativeLuminance(c2);
    const double hi = std::max(l1, l2);
    const double lo = std::min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
}

QColor computeLegibleButtonFg(const QColor &bg, const QColor &preferred) {
    const QColor darkFg(0x11, 0x1b, 0x21);
    const QColor lightFg(0xff, 0xff, 0xff);
    if (preferred.isValid() && contrastRatio(bg, preferred) >= 4.5) {
        return preferred;
    }
    return contrastRatio(bg, darkFg) >= contrastRatio(bg, lightFg) ? darkFg : lightFg;
}

} // namespace

LockOverlay::LockOverlay(QWidget *parent)
    : QWidget(parent)
    , m_isLocked(false)
{
    setAttribute(Qt::WA_NoSystemBackground, true);
    setFocusPolicy(Qt::StrongFocus);
    setVisible(false);

    QSettings settings(QStringLiteral("WhatsAppWebClient"), QStringLiteral("WhatsAppWebClient"));
    const QColor savedAccent(settings.value(QStringLiteral("last_accent_color")).toString());
    const QColor savedFg(settings.value(QStringLiteral("last_accent_fg")).toString());
    if (savedAccent.isValid()) {
        m_accentColor = savedAccent;
        m_accentFgColor = computeLegibleButtonFg(m_accentColor, savedFg);
    }

    if (parent) {
        parent->installEventFilter(this);
    }

    initUi();
}

void LockOverlay::initUi() {
    auto *mainLayout = new QVBoxLayout(this);
    mainLayout->setAlignment(Qt::AlignCenter);
    mainLayout->setContentsMargins(0, 0, 0, 0);

    m_pillFrame = new QFrame(this);
    m_pillFrame->setObjectName(QStringLiteral("pillFrame"));
    m_pillFrame->setFixedWidth(440);

    auto *shadow = new QGraphicsDropShadowEffect(this);
    shadow->setBlurRadius(45);
    shadow->setColor(QColor(0, 0, 0, 200));
    shadow->setOffset(0, 14);
    m_pillFrame->setGraphicsEffect(shadow);

    m_pillFrame->setStyleSheet(s_pillStyleNormal);

    auto *pillLayout = new QVBoxLayout(m_pillFrame);
    pillLayout->setContentsMargins(28, 22, 28, 22);
    pillLayout->setSpacing(14);

    // Cabecera de la pill: Titulo
    auto *headerLayout = new QHBoxLayout();
    headerLayout->setSpacing(10);

    m_lblTitle = new QLabel(QStringLiteral("WhatsApp bloqueado"), m_pillFrame);
    m_lblTitle->setStyleSheet(QStringLiteral(R"(
        color: #f0f2f5;
        font-size: 15px;
        font-weight: 600;
        background: transparent;
        letter-spacing: 0.5px;
    )"));

    headerLayout->addWidget(m_lblTitle);
    headerLayout->addStretch();
    pillLayout->addLayout(headerLayout);

    // Fila de Entrada: Input de PIN censurado + Boton Desbloquear
    auto *inputLayout = new QHBoxLayout();
    inputLayout->setSpacing(12);

    m_txtPin = new QLineEdit(m_pillFrame);
    m_txtPin->setEchoMode(QLineEdit::Password);
    m_txtPin->setMaxLength(6);
    m_txtPin->setAlignment(Qt::AlignCenter);
    m_txtPin->setPlaceholderText(QStringLiteral("····"));
    m_txtPin->setValidator(new QIntValidator(0, 999999, this));

    connect(m_txtPin, &QLineEdit::textChanged, this, &LockOverlay::onPinChanged);
    connect(m_txtPin, &QLineEdit::returnPressed, this, &LockOverlay::submitPin);

    m_btnUnlock = new QPushButton(QStringLiteral("Desbloquear"), m_pillFrame);
    m_btnUnlock->setObjectName(QStringLiteral("btnUnlock"));
    m_btnUnlock->setFixedHeight(42);
    m_btnUnlock->setMinimumWidth(105);
    m_btnUnlock->setCursor(Qt::PointingHandCursor);
    connect(m_btnUnlock, &QPushButton::clicked, this, &LockOverlay::submitPin);

    applyAccentStyles();

    inputLayout->addWidget(m_txtPin, 1);
    inputLayout->addWidget(m_btnUnlock);
    pillLayout->addLayout(inputLayout);

    // Etiqueta de estado / error
    m_lblStatus = new QLabel(QString(), m_pillFrame);
    m_lblStatus->setAlignment(Qt::AlignCenter);
    m_lblStatus->setStyleSheet(QStringLiteral(R"(
        color: #8696a0;
        font-size: 12px;
        background: transparent;
    )"));
    pillLayout->addWidget(m_lblStatus);

    mainLayout->addWidget(m_pillFrame);
}

void LockOverlay::applyAccentStyles() {
    const QColor accent = m_accentColor.isValid() ? m_accentColor : QColor(0x00, 0xa8, 0x84);
    const QColor fg = computeLegibleButtonFg(accent, m_accentFgColor);
    const QColor hoverColor = accent.lightnessF() > 0.72 ? accent.darker(112) : accent.lighter(112);
    const QColor pressedColor = accent.darker(118);

    if (m_txtPin) {
        m_txtPin->setStyleSheet(QStringLiteral(R"(
            QLineEdit {
                background-color: rgba(0, 0, 0, 0.55);
                border: 1px solid rgba(255, 255, 255, 0.15);
                border-radius: 20px;
                color: #ffffff;
                font-size: 22px;
                font-weight: bold;
                letter-spacing: 6px;
                padding: 6px 16px;
                min-height: 28px;
            }
            QLineEdit:focus {
                border: 1.5px solid %1;
                background-color: rgba(0, 0, 0, 0.75);
            }
        )").arg(accent.name()));
    }

    if (m_btnUnlock) {
        m_btnUnlock->setStyleSheet(QStringLiteral(R"(
            QPushButton {
                background-color: %1;
                color: %2;
                font-size: 13px;
                font-weight: bold;
                border: none;
                border-radius: 21px;
                padding: 0 16px;
            }
            QPushButton:hover {
                background-color: %3;
            }
            QPushButton:pressed {
                background-color: %4;
            }
        )").arg(accent.name(), fg.name(), hoverColor.name(), pressedColor.name()));
    }
}

void LockOverlay::setAccentColors(const QColor &accent, const QColor &accentFg) {
    if (!accent.isValid()) {
        return;
    }
    const QColor resolvedFg = computeLegibleButtonFg(accent, accentFg);
    if (accent == m_accentColor && resolvedFg == m_accentFgColor) {
        return;
    }
    m_accentColor = accent;
    m_accentFgColor = resolvedFg;

    QSettings settings(QStringLiteral("WhatsAppWebClient"), QStringLiteral("WhatsAppWebClient"));
    settings.setValue(QStringLiteral("last_accent_color"), m_accentColor.name());
    settings.setValue(QStringLiteral("last_accent_fg"), m_accentFgColor.name());

    applyAccentStyles();
}

void LockOverlay::paintEvent(QPaintEvent *event) {
    Q_UNUSED(event);
    QPainter painter(this);
    painter.fillRect(rect(), QColor(0, 0, 0, 45));
}

void LockOverlay::onPinChanged(const QString &text) {
    if (ConfigManager::hasPin() && text.length() == 4) {
        submitPin();
    }
}

void LockOverlay::submitPin() {
    QString enteredPin = m_txtPin->text().trimmed();
    if (enteredPin.isEmpty()) {
        return;
    }

    if (!ConfigManager::hasPin()) {
        if (enteredPin.length() < 4) {
            setErrorStatus(QStringLiteral("El PIN debe tener al menos 4 digitos"));
            shakePill();
            return;
        }
        ConfigManager::setPin(enteredPin);
        m_lblStatus->setStyleSheet(QStringLiteral("color: %1; font-size: 12px; background: transparent;").arg(m_accentColor.name()));
        m_lblStatus->setText(QStringLiteral("PIN configurado correctamente."));
        QTimer::singleShot(600, this, &LockOverlay::unlock);
        return;
    }

    if (ConfigManager::verifyPin(enteredPin)) {
        unlock();
    } else {
        setErrorStatus(QStringLiteral("PIN incorrecto. Intentalo de nuevo."));
        shakePill();
    }
}

void LockOverlay::submit_pin() {
    submitPin();
}

void LockOverlay::setErrorStatus(const QString &message) {
    m_lblStatus->setStyleSheet(QStringLiteral("color: #ff453a; font-size: 12px; font-weight: 500; background: transparent;"));
    m_lblStatus->setText(message);
    m_pillFrame->setStyleSheet(s_pillStyleError);
    m_txtPin->selectAll();
}

void LockOverlay::set_error_status(const QString &message) {
    setErrorStatus(message);
}

void LockOverlay::shakePill() {
    QPoint originalPos = m_pillFrame->pos();
    if (!m_anim) {
        m_anim = new QPropertyAnimation(m_pillFrame, "pos", this);
    }
    m_anim->stop();
    m_anim->setDuration(350);
    m_anim->setEasingCurve(QEasingCurve::InOutSine);

    int x = originalPos.x();
    int y = originalPos.y();
    m_anim->setKeyValueAt(0.0, QPoint(x, y));
    m_anim->setKeyValueAt(0.15, QPoint(x - 9, y));
    m_anim->setKeyValueAt(0.35, QPoint(x + 9, y));
    m_anim->setKeyValueAt(0.55, QPoint(x - 6, y));
    m_anim->setKeyValueAt(0.75, QPoint(x + 6, y));
    m_anim->setKeyValueAt(1.0, QPoint(x, y));

    disconnect(m_anim, &QPropertyAnimation::finished, nullptr, nullptr);
    connect(m_anim, &QPropertyAnimation::finished, this, [this]() {
        m_pillFrame->setStyleSheet(s_pillStyleNormal);
    });
    m_anim->start();
}

void LockOverlay::shake_pill() {
    shakePill();
}

void LockOverlay::lock() {
    m_isLocked = true;
    ConfigManager::setAppLocked(true);
    m_txtPin->clear();
    m_pillFrame->setStyleSheet(s_pillStyleNormal);

    if (!ConfigManager::hasPin()) {
        m_lblTitle->setText(QStringLiteral("Crea tu PIN de seguridad"));
        m_lblStatus->setStyleSheet(QStringLiteral("color: #8696a0; font-size: 12px; background: transparent;"));
        m_lblStatus->setText(QStringLiteral("Ingresa 4 digitos para proteger tu sesion"));
    } else {
        m_lblTitle->setText(QStringLiteral("WhatsApp bloqueado"));
        m_lblStatus->setStyleSheet(QStringLiteral("color: #8696a0; font-size: 12px; background: transparent;"));
        m_lblStatus->setText(QStringLiteral("Introduce tu PIN para desbloquear"));
    }

    if (parentWidget()) {
        setGeometry(parentWidget()->rect());
    }
    setVisible(true);
    raise();
    m_txtPin->setFocus();
    emit locked();
}

void LockOverlay::unlock() {
    m_isLocked = false;
    ConfigManager::setAppLocked(false);
    m_txtPin->clear();
    m_lblStatus->setText(QString());
    setVisible(false);
    emit unlocked();
}

bool LockOverlay::isLocked() const {
    return m_isLocked;
}

QLineEdit* LockOverlay::pinInput() const {
    return m_txtPin;
}

void LockOverlay::keyPressEvent(QKeyEvent *event) {
    if (!m_isLocked) {
        QWidget::keyPressEvent(event);
        return;
    }
    if (m_txtPin && !m_txtPin->hasFocus()) {
        m_txtPin->setFocus();
    }
    QWidget::keyPressEvent(event);
}

void LockOverlay::keyReleaseEvent(QKeyEvent *event) {
    if (!m_isLocked) {
        QWidget::keyReleaseEvent(event);
        return;
    }
    event->accept();
}

void LockOverlay::mousePressEvent(QMouseEvent *event) {
    event->accept();
}

void LockOverlay::mouseReleaseEvent(QMouseEvent *event) {
    event->accept();
}

void LockOverlay::mouseDoubleClickEvent(QMouseEvent *event) {
    event->accept();
}

void LockOverlay::mouseMoveEvent(QMouseEvent *event) {
    event->accept();
}

void LockOverlay::wheelEvent(QWheelEvent *event) {
    event->accept();
}

void LockOverlay::contextMenuEvent(QContextMenuEvent *event) {
    event->accept();
}

bool LockOverlay::eventFilter(QObject *watched, QEvent *event) {
    if (watched == parentWidget() && event->type() == QEvent::Resize) {
        if (parentWidget()) {
            setGeometry(parentWidget()->rect());
        }
    }
    return QWidget::eventFilter(watched, event);
}
