#ifndef LOCK_OVERLAY_H
#define LOCK_OVERLAY_H

#include <QDialog>
#include <QWidget>
#include <QString>
#include <QPoint>

class QLineEdit;
class QLabel;
class QPushButton;
class QCheckBox;
class QFrame;
class QPropertyAnimation;
class QPaintEvent;
class QKeyEvent;
class QMouseEvent;
class QWheelEvent;
class QContextMenuEvent;
class QEvent;

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

/**
 * Overlay de bloqueo de pantalla completa que intercepta todos los eventos
 * y muestra una capsula flotante para introducir el PIN censurado.
 */
class LockOverlay : public QWidget {
    Q_OBJECT

public:
    explicit LockOverlay(QWidget *parent = nullptr);
    ~LockOverlay() override = default;

    void lock();
    void unlock();
    bool isLocked() const;
    QLineEdit* pinInput() const;

    void shakePill();
    void shake_pill();

public slots:
    void submitPin();
    void submit_pin();
    void setErrorStatus(const QString &message);
    void set_error_status(const QString &message);

signals:
    void unlocked();
    void locked();

protected:
    void paintEvent(QPaintEvent *event) override;
    void keyPressEvent(QKeyEvent *event) override;
    void keyReleaseEvent(QKeyEvent *event) override;
    void mousePressEvent(QMouseEvent *event) override;
    void mouseReleaseEvent(QMouseEvent *event) override;
    void mouseDoubleClickEvent(QMouseEvent *event) override;
    void mouseMoveEvent(QMouseEvent *event) override;
    void wheelEvent(QWheelEvent *event) override;
    void contextMenuEvent(QContextMenuEvent *event) override;
    bool eventFilter(QObject *watched, QEvent *event) override;

private slots:
    void onPinChanged(const QString &text);

private:
    void initUi();

    bool m_isLocked = false;
    QFrame *m_pillFrame = nullptr;
    QLabel *m_lblTitle = nullptr;
    QLineEdit *m_txtPin = nullptr;
    QPushButton *m_btnUnlock = nullptr;
    QLabel *m_lblStatus = nullptr;
    QPropertyAnimation *m_anim = nullptr;

    static const QString s_pillStyleNormal;
    static const QString s_pillStyleError;
};

#endif // LOCK_OVERLAY_H
