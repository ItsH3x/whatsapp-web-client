#ifndef NOTIFICATION_MANAGER_H
#define NOTIFICATION_MANAGER_H

#include <QObject>
#include <QString>
#include <QStringList>
#include <QHash>
#include <QVariantMap>

class NotificationManager : public QObject
{
    Q_OBJECT

public:
    explicit NotificationManager(QObject *parent = nullptr);
    ~NotificationManager() override;

    void sendNotification(const QString &title, const QString &body, const QString &iconPath = QString());

signals:
    void replyReceived(const QString &chatTitle, const QString &text);
    void actionDefaultInvoked(const QString &chatTitle);

private slots:
    void onNotificationReplied(uint id, const QString &text);
    void onActionInvoked(uint id, const QString &action);
    void onNotificationClosed(uint id, uint reason);

private:
    QHash<QString, uint> m_chatToId;
    QHash<uint, QString> m_notifMap;
};

#endif // NOTIFICATION_MANAGER_H
