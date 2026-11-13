#include "notification_manager.h"

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
}

void NotificationManager::sendNotification(const QString &title, const QString &body, const QString &iconPath)
{
    QDBusMessage msg = QDBusMessage::createMethodCall(
        QStringLiteral("org.freedesktop.Notifications"),
        QStringLiteral("/org/freedesktop/Notifications"),
        QStringLiteral("org.freedesktop.Notifications"),
        QStringLiteral("Notify")
    );

    const uint replacesId = m_chatToId.value(title, 0);
    const QString appIcon = iconPath.isEmpty() ? QStringLiteral("whatsapp") : iconPath;
    const QStringList actions = {
        QStringLiteral("inline-reply"),
        QStringLiteral("Responder"),
        QStringLiteral("default"),
        QStringLiteral("Abrir")
    };

    QVariantMap hints;
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

    QDBusReply<uint> reply = QDBusConnection::sessionBus().call(msg);
    if (reply.isValid()) {
        const uint newId = reply.value();
        if (replacesId != 0 && replacesId != newId) {
            m_notifMap.remove(replacesId);
        }
        m_chatToId.insert(title, newId);
        m_notifMap.insert(newId, title);
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
