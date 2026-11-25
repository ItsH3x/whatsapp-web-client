#include "privacy_dialogs.h"
#include "config_manager.h"

#include <QCheckBox>
#include <QColor>
#include <QFrame>
#include <QGraphicsDropShadowEffect>
#include <QHBoxLayout>
#include <QIntValidator>
#include <QLabel>
#include <QLineEdit>
#include <QMessageBox>
#include <QMouseEvent>
#include <QPaintEvent>
#include <QPainter>
#include <QPushButton>
#include <QSettings>
#include <QStyle>
#include <QStyleOption>
#include <QVBoxLayout>

// ============================================================================
// PrivacyInstructionDialog Implementation
// ============================================================================

PrivacyInstructionDialog::PrivacyInstructionDialog(QWidget *parent, const QString &mode)
    : QDialog(parent)
    , m_mode(mode)
{
    setWindowFlags(Qt::FramelessWindowHint | Qt::Dialog);
    setAttribute(Qt::WA_TranslucentBackground, true);
    setAttribute(Qt::WA_DeleteOnClose, true);
    setFixedWidth(460);

    setStyleSheet(QStringLiteral(R"(
        QDialog {
            background-color: #111b21;
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 14px;
        }
        QLabel {
            color: #e9edef;
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
        }
        QCheckBox {
            color: #8696a0;
            font-size: 13px;
            spacing: 8px;
        }
        QCheckBox::indicator {
            width: 18px;
            height: 18px;
            border: 1.5px solid #8696a0;
            border-radius: 4px;
            background: transparent;
        }
        QCheckBox::indicator:checked {
            background-color: #00a884;
            border-color: #00a884;
        }
        QPushButton#btnOk {
            background-color: #00a884;
            color: #ffffff;
            font-weight: 700;
            font-size: 13px;
            border: none;
            border-radius: 6px;
            padding: 8px 24px;
            min-width: 80px;
        }
        QPushButton#btnOk:hover {
            background-color: #02906f;
        }
        QPushButton#btnOk:focus {
            border: 2px solid #ffffff;
        }
    )"));

    auto *layout = new QVBoxLayout(this);
    layout->setContentsMargins(24, 22, 24, 20);
    layout->setSpacing(14);

    QString titleText = (mode == QStringLiteral("privacy"))
        ? QStringLiteral("Modo Privacidad activado")
        : QStringLiteral("Bloqueo de app activado");

    auto *lblTitle = new QLabel(
        QStringLiteral("<h3 style='margin:0; color:#00a884; font-size:16px;'>") + titleText + QStringLiteral("</h3>"),
        this
    );
    layout->addWidget(lblTitle);

    QString msgHtml = QStringLiteral(R"(
        <p style='color:#e9edef; font-size:13px; line-height:1.5; margin:0;'>
        Puedes controlar rapidamente estas funciones usando tu teclado:
        </p>
        <div style='background:rgba(255,255,255,0.06); padding:10px 14px; border-radius:8px; margin-top:4px;'>
            <p style='margin:0 0 6px 0; font-size:13px; color:#e9edef;'>
                <b style='color:#00a884;'>Pulsar Alt + B:</b> Activa o desactiva el <i>Modo Privacidad</i> (desenfoque rapido sin PIN).
            </p>
            <p style='margin:0; font-size:13px; color:#e9edef;'>
                <b style='color:#00a884;'>Mantener Alt + B:</b> Bloquea la app con tu <i>PIN de seguridad</i>.
            </p>
        </div>
    )");

    auto *lblMsg = new QLabel(msgHtml, this);
    lblMsg->setWordWrap(true);
    layout->addWidget(lblMsg);

    m_chkDontShow = new QCheckBox(QStringLiteral("No volver a mostrar este mensaje"), this);
    layout->addWidget(m_chkDontShow);

    auto *btnLayout = new QHBoxLayout();
    btnLayout->addStretch();

    m_btnOk = new QPushButton(QStringLiteral("OK"), this);
    m_btnOk->setObjectName(QStringLiteral("btnOk"));
    m_btnOk->setDefault(true);
    m_btnOk->setCursor(Qt::PointingHandCursor);
    connect(m_btnOk, &QPushButton::clicked, this, &PrivacyInstructionDialog::accept);

    btnLayout->addWidget(m_btnOk);
    layout->addLayout(btnLayout);

    m_btnOk->setFocus();
}

void PrivacyInstructionDialog::accept() {
    if (m_chkDontShow && m_chkDontShow->isChecked()) {
        QSettings settings(QStringLiteral("WhatsAppWebClient"), QStringLiteral("WhatsAppWebClient"));
        settings.setValue(QStringLiteral("hide_privacy_instructions"), true);
    }
    QDialog::accept();
}

void PrivacyInstructionDialog::paintEvent(QPaintEvent *event) {
    Q_UNUSED(event);
    QStyleOption opt;
    opt.initFrom(this);
    QPainter p(this);
    style()->drawPrimitive(QStyle::PE_Widget, &opt, &p, this);
}

void PrivacyInstructionDialog::mousePressEvent(QMouseEvent *event) {
    if (event->button() == Qt::LeftButton) {
        m_dragPosition = event->globalPosition().toPoint() - frameGeometry().topLeft();
        event->accept();
    } else {
        QDialog::mousePressEvent(event);
    }
}

void PrivacyInstructionDialog::mouseMoveEvent(QMouseEvent *event) {
    if (event->buttons() & Qt::LeftButton) {
        move(event->globalPosition().toPoint() - m_dragPosition);
        event->accept();
    } else {
        QDialog::mouseMoveEvent(event);
    }
}

// ============================================================================
// PinConfigDialog Implementation
// ============================================================================

PinConfigDialog::PinConfigDialog(QWidget *parent)
    : QDialog(parent)
{
    initUi();
}

void PinConfigDialog::initUi() {
    setWindowFlags(Qt::FramelessWindowHint | Qt::Dialog);
    setAttribute(Qt::WA_TranslucentBackground, true);
    setFixedWidth(400);

    auto *rootLayout = new QVBoxLayout(this);
    rootLayout->setContentsMargins(12, 12, 12, 12);

    m_container = new QFrame(this);
    m_container->setObjectName(QStringLiteral("dialogContainer"));

    auto *shadow = new QGraphicsDropShadowEffect(this);
    shadow->setBlurRadius(30);
    shadow->setColor(QColor(0, 0, 0, 180));
    shadow->setOffset(0, 8);
    m_container->setGraphicsEffect(shadow);

    m_container->setStyleSheet(QStringLiteral(R"(
        QFrame#dialogContainer {
            background-color: #111b21;
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 14px;
        }
        QLabel {
            color: #e9edef;
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
            font-size: 13px;
        }
        QLineEdit {
            background-color: rgba(0, 0, 0, 0.55);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 8px;
            color: #ffffff;
            font-size: 16px;
            letter-spacing: 4px;
            padding: 6px 12px;
        }
        QLineEdit:focus {
            border: 1.5px solid #00a884;
            background-color: rgba(0, 0, 0, 0.75);
        }
        QPushButton#btnSave {
            background-color: #00a884;
            color: #ffffff;
            font-weight: 700;
            font-size: 13px;
            border: none;
            border-radius: 6px;
            padding: 8px 18px;
            min-width: 80px;
        }
        QPushButton#btnSave:hover {
            background-color: #02906f;
        }
        QPushButton#btnRemove {
            background-color: #da373c;
            color: #ffffff;
            font-weight: 600;
            font-size: 13px;
            border: none;
            border-radius: 6px;
            padding: 8px 14px;
        }
        QPushButton#btnRemove:hover {
            background-color: #c02e34;
        }
        QPushButton#btnCancel {
            background-color: transparent;
            color: #8696a0;
            font-weight: 600;
            font-size: 13px;
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 6px;
            padding: 8px 16px;
        }
        QPushButton#btnCancel:hover {
            background-color: rgba(255, 255, 255, 0.05);
            color: #e9edef;
        }
    )"));

    auto *layout = new QVBoxLayout(m_container);
    layout->setContentsMargins(24, 22, 24, 20);
    layout->setSpacing(12);

    bool hasPin = ConfigManager::hasPin();

    QString titleText = hasPin
        ? QStringLiteral("Cambiar PIN de seguridad")
        : QStringLiteral("Configurar PIN de seguridad");

    auto *lblTitle = new QLabel(
        QStringLiteral("<h3 style='margin:0; color:#00a884; font-size:16px;'>") + titleText + QStringLiteral("</h3>"),
        m_container
    );
    layout->addWidget(lblTitle);

    if (hasPin) {
        layout->addWidget(new QLabel(QStringLiteral("PIN actual:"), m_container));
        m_txtCurrent = new QLineEdit(m_container);
        m_txtCurrent->setEchoMode(QLineEdit::Password);
        m_txtCurrent->setMaxLength(6);
        m_txtCurrent->setValidator(new QIntValidator(0, 999999, this));
        m_txtCurrent->setPlaceholderText(QStringLiteral("····"));
        layout->addWidget(m_txtCurrent);
    }

    layout->addWidget(new QLabel(QStringLiteral("Nuevo PIN (4-6 digitos):"), m_container));
    m_txtNew = new QLineEdit(m_container);
    m_txtNew->setEchoMode(QLineEdit::Password);
    m_txtNew->setMaxLength(6);
    m_txtNew->setValidator(new QIntValidator(0, 999999, this));
    m_txtNew->setPlaceholderText(QStringLiteral("····"));
    layout->addWidget(m_txtNew);

    layout->addWidget(new QLabel(QStringLiteral("Confirmar nuevo PIN:"), m_container));
    m_txtConfirm = new QLineEdit(m_container);
    m_txtConfirm->setEchoMode(QLineEdit::Password);
    m_txtConfirm->setMaxLength(6);
    m_txtConfirm->setValidator(new QIntValidator(0, 999999, this));
    m_txtConfirm->setPlaceholderText(QStringLiteral("····"));
    layout->addWidget(m_txtConfirm);

    connect(m_txtConfirm, &QLineEdit::returnPressed, this, &PinConfigDialog::savePin);

    auto *actionsLayout = new QHBoxLayout();
    actionsLayout->setSpacing(8);

    m_btnCancel = new QPushButton(QStringLiteral("Cancelar"), m_container);
    m_btnCancel->setObjectName(QStringLiteral("btnCancel"));
    m_btnCancel->setCursor(Qt::PointingHandCursor);
    connect(m_btnCancel, &QPushButton::clicked, this, &QDialog::reject);
    actionsLayout->addWidget(m_btnCancel);

    if (hasPin) {
        m_btnRemove = new QPushButton(QStringLiteral("Quitar PIN"), m_container);
        m_btnRemove->setObjectName(QStringLiteral("btnRemove"));
        m_btnRemove->setCursor(Qt::PointingHandCursor);
        connect(m_btnRemove, &QPushButton::clicked, this, &PinConfigDialog::removePin);
        actionsLayout->addWidget(m_btnRemove);
    }

    actionsLayout->addStretch();

    m_btnSave = new QPushButton(QStringLiteral("Guardar PIN"), m_container);
    m_btnSave->setObjectName(QStringLiteral("btnSave"));
    m_btnSave->setDefault(true);
    m_btnSave->setCursor(Qt::PointingHandCursor);
    connect(m_btnSave, &QPushButton::clicked, this, &PinConfigDialog::savePin);
    actionsLayout->addWidget(m_btnSave);

    layout->addLayout(actionsLayout);
    rootLayout->addWidget(m_container);

    if (m_txtCurrent) {
        m_txtCurrent->setFocus();
    } else {
        m_txtNew->setFocus();
    }
}

void PinConfigDialog::savePin() {
    if (m_txtCurrent) {
        QString current = m_txtCurrent->text().trimmed();
        if (!ConfigManager::verifyPin(current)) {
            QMessageBox::warning(this, QStringLiteral("Error"), QStringLiteral("El PIN actual es incorrecto."));
            return;
        }
    }

    QString newPin = m_txtNew->text().trimmed();
    QString confirmPin = m_txtConfirm->text().trimmed();

    if (newPin.length() < 4) {
        QMessageBox::warning(this, QStringLiteral("Error"), QStringLiteral("El nuevo PIN debe tener al menos 4 digitos."));
        return;
    }

    if (newPin != confirmPin) {
        QMessageBox::warning(this, QStringLiteral("Error"), QStringLiteral("El nuevo PIN y su confirmacion no coinciden."));
        return;
    }

    ConfigManager::setPin(newPin);
    QMessageBox::information(this, QStringLiteral("Guardado"), QStringLiteral("El PIN de seguridad se ha guardado correctamente."));
    accept();
}

void PinConfigDialog::removePin() {
    if (m_txtCurrent) {
        QString current = m_txtCurrent->text().trimmed();
        if (!ConfigManager::verifyPin(current)) {
            QMessageBox::warning(this, QStringLiteral("Error"), QStringLiteral("El PIN actual es incorrecto."));
            return;
        }
    }

    ConfigManager::setPin(QString());
    QMessageBox::information(this, QStringLiteral("PIN eliminado"), QStringLiteral("El PIN de seguridad ha sido desactivado."));
    accept();
}

void PinConfigDialog::mousePressEvent(QMouseEvent *event) {
    if (event->button() == Qt::LeftButton) {
        m_dragPosition = event->globalPosition().toPoint() - frameGeometry().topLeft();
        event->accept();
    } else {
        QDialog::mousePressEvent(event);
    }
}

void PinConfigDialog::mouseMoveEvent(QMouseEvent *event) {
    if (event->buttons() & Qt::LeftButton) {
        move(event->globalPosition().toPoint() - m_dragPosition);
        event->accept();
    } else {
        QDialog::mouseMoveEvent(event);
    }
}
