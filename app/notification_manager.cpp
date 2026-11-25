#include "notification_manager.h"

#include <QDebug>
#include <QtDBus/QDBusConnection>
#include <QtDBus/QDBusMessage>
#include <QtDBus/QDBusReply>
#include <QtDBus/QDBusArgument>

NotificationManager::NotificationManager(QObject *parent)
    : QObject(parent)
{
    QDBusConnection bus = QDBusConnection::sessionBus();

    bus.connect(
        QStringLiteral("org.freedesktop.Notifications"),
        QStringLiteral("/org/freedesktop/Notifications"),
        QStringLiteral("org.freedesktop.Notifications"),
        QStringLiteral("NotificationReplied"),
        this,
        SLOT(onNotificationReplied(uint,QString))
    );

    bus.connect(
        QStringLiteral("org.freedesktop.Notifications"),
        QStringLiteral("/org/freedesktop/Notifications"),
        QStringLiteral("org.freedesktop.Notifications"),
        QStringLiteral("ActionInvoked"),
        this,
        SLOT(onActionInvoked(uint,QString))
    );

    bus.connect(
        QStringLiteral("org.freedesktop.Notifications"),
        QStringLiteral("/org/freedesktop/Notifications"),
        QStringLiteral("org.freedesktop.Notifications"),
        QStringLiteral("NotificationClosed"),
        this,
        SLOT(onNotificationClosed(uint,uint))
    );
}

NotificationManager::~NotificationManager()
{
    QDBusConnection bus = QDBusConnection::sessionBus();

    bus.disconnect(
        QStringLiteral("org.freedesktop.Notifications"),
        QStringLiteral("/org/freedesktop/Notifications"),
        QStringLiteral("org.freedesktop.Notifications"),
        QStringLiteral("NotificationReplied"),
        this,
        SLOT(onNotificationReplied(uint,QString))
    );

    bus.disconnect(
        QStringLiteral("org.freedesktop.Notifications"),
        QStringLiteral("/org/freedesktop/Notifications"),
        QStringLiteral("org.freedesktop.Notifications"),
        QStringLiteral("ActionInvoked"),
        this,
        SLOT(onActionInvoked(uint,QString))
    );

    bus.disconnect(
        QStringLiteral("org.freedesktop.Notifications"),
        QStringLiteral("/org/freedesktop/Notifications"),
        QStringLiteral("org.freedesktop.Notifications"),
        QStringLiteral("NotificationClosed"),
        this,
        SLOT(onNotificationClosed(uint,uint))
    );
}

void NotificationManager::sendNotification(const QString &title, const QString &body, const QString &iconPath)
{
    QDBusConnection bus = QDBusConnection::sessionBus();

    // En KDE Plasma 6 (bug #513275), reemplazar una notificacion ya expirada usando
    // replaces_id actualiza el historial en silencio sin mostrar un popup nuevo.
    // Cerrar la notificacion previa del mismo chat y emitir replaces_id = 0 evita
    // duplicados en el historial y garantiza un popup visible en cada mensaje.
    const uint previousId = m_chatToId.take(title);
    if (previousId != 0) {
        m_notifMap.remove(previousId);
        QDBusMessage closeMsg = QDBusMessage::createMethodCall(
            QStringLiteral("org.freedesktop.Notifications"),
            QStringLiteral("/org/freedesktop/Notifications"),
            QStringLiteral("org.freedesktop.Notifications"),
            QStringLiteral("CloseNotification")
        );
        closeMsg << previousId;
        bus.call(closeMsg);
    }

    QDBusMessage msg = QDBusMessage::createMethodCall(
        QStringLiteral("org.freedesktop.Notifications"),
        QStringLiteral("/org/freedesktop/Notifications"),
        QStringLiteral("org.freedesktop.Notifications"),
        QStringLiteral("Notify")
    );

    const uint replacesId = 0;
    const QString appIcon = iconPath.isEmpty() ? QStringLiteral("whatsapp") : iconPath;
    const QStringList actions = {
        QStringLiteral("inline-reply"),
        QStringLiteral("Responder"),
        QStringLiteral("default"),
        QStringLiteral("Abrir")
    };

    QVariantMap hints;
    hints.insert(QStringLiteral("desktop-entry"), QStringLiteral("whatsapp-web"));
    hints.insert(QStringLiteral("x-kde-reply-action"), QStringLiteral("inline-reply"));
    hints.insert(QStringLiteral("transient"), false);
    hints.insert(QStringLiteral("resident"), true);

    const qint32 expireTimeout = 5000;

    msg << QStringLiteral("WhatsApp Web")
        << replacesId
        << appIcon
        << title
        << body
        << actions
        << hints
        << expireTimeout;

    QDBusReply<uint> reply = bus.call(msg);
    if (reply.isValid()) {
        const uint newId = reply.value();
        m_chatToId.insert(title, newId);
        m_notifMap.insert(newId, title);
    } else {
        qWarning() << "NotificationManager: D-Bus Notify failed:" << reply.error().message();
    }
}

void NotificationManager::onNotificationReplied(uint id, const QString &text)
{
    auto it = m_notifMap.constFind(id);
    if (it != m_notifMap.constEnd()) {
        emit replyReceived(it.value(), text);
    }
}

void NotificationManager::onActionInvoked(uint id, const QString &action)
{
    if (action == QStringLiteral("default")) {
        auto it = m_notifMap.constFind(id);
        if (it != m_notifMap.constEnd()) {
            emit actionDefaultInvoked(it.value());
        }
    }
}

void NotificationManager::onNotificationClosed(uint id, uint reason)
{
    Q_UNUSED(reason);
    const QString chatTitle = m_notifMap.take(id);
    if (!chatTitle.isEmpty() && m_chatToId.value(chatTitle, 0) == id) {
        m_chatToId.remove(chatTitle);
    }
}
