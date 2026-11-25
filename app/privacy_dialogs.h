#ifndef PRIVACY_DIALOGS_H
#define PRIVACY_DIALOGS_H

#include <QDialog>
#include <QPoint>
#include <QString>

class QCheckBox;
class QFrame;
class QLineEdit;
class QMouseEvent;
class QPaintEvent;
class QPushButton;
class QWidget;

/**
 * Dialogo instructivo que explica como usar los atajos de teclado Alt+B
 * para privacidad y bloqueo.
 */
class PrivacyInstructionDialog : public QDialog {
    Q_OBJECT

public:
    explicit PrivacyInstructionDialog(QWidget *parent = nullptr, const QString &mode = QStringLiteral("privacy"));
    ~PrivacyInstructionDialog() override = default;

public slots:
    void accept() override;

protected:
    void paintEvent(QPaintEvent *event) override;
    void mousePressEvent(QMouseEvent *event) override;
    void mouseMoveEvent(QMouseEvent *event) override;

private:
    QString m_mode;
    QCheckBox *m_chkDontShow = nullptr;
    QPushButton *m_btnOk = nullptr;
    QPoint m_dragPosition;
};

/**
 * Dialogo para configurar, cambiar o quitar el PIN de seguridad.
 */
class PinConfigDialog : public QDialog {
    Q_OBJECT

public:
    explicit PinConfigDialog(QWidget *parent = nullptr);
    ~PinConfigDialog() override = default;

public slots:
    void savePin();
    void removePin();

protected:
    void mousePressEvent(QMouseEvent *event) override;
    void mouseMoveEvent(QMouseEvent *event) override;

private:
    void initUi();

    QFrame *m_container = nullptr;
    QLineEdit *m_txtCurrent = nullptr;
    QLineEdit *m_txtNew = nullptr;
    QLineEdit *m_txtConfirm = nullptr;
    QPushButton *m_btnSave = nullptr;
    QPushButton *m_btnRemove = nullptr;
    QPushButton *m_btnCancel = nullptr;
    QPoint m_dragPosition;
};

#endif // PRIVACY_DIALOGS_H
