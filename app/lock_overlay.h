#ifndef LOCK_OVERLAY_H
#define LOCK_OVERLAY_H

#include <QColor>
#include <QString>
#include <QWidget>

class QLineEdit;
class QLabel;
class QPushButton;
class QFrame;
class QPropertyAnimation;
class QPaintEvent;
class QKeyEvent;
class QMouseEvent;
class QWheelEvent;
class QContextMenuEvent;
class QEvent;

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
    void setAccentColors(const QColor &accent, const QColor &accentFg = QColor());

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
    void applyAccentStyles();

    bool m_isLocked = false;
    QFrame *m_pillFrame = nullptr;
    QLabel *m_lblTitle = nullptr;
    QLineEdit *m_txtPin = nullptr;
    QPushButton *m_btnUnlock = nullptr;
    QLabel *m_lblStatus = nullptr;
    QPropertyAnimation *m_anim = nullptr;
    QColor m_accentColor = QColor(0x00, 0xa8, 0x84);
    QColor m_accentFgColor = QColor(0xff, 0xff, 0xff);

    static const QString s_pillStyleNormal;
    static const QString s_pillStyleError;
};

#endif // LOCK_OVERLAY_H
