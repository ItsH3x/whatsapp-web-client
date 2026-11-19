#include "whatsapp_window.h"

#include <QCoreApplication>
#include <QDesktopServices>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QTime>
#include <QUrl>

void WhatsAppClient::handleNotification(std::unique_ptr<QWebEngineNotification> notification) {
    if (m_dndMode) {
        return;
    }

    bool isLocked = (m_lockOverlay && m_lockOverlay->isLocked());
    QString title = notification->title();
    QString body;
    if (isLocked) {
        body = "Nuevo mensaje (WhatsApp bloqueado)";
    } else {
        body = notification->message().replace('\n', ' ');
    }

    QString iconPath;
    QImage iconImg = notification->icon();
    if (!iconImg.isNull()) {
        QString tempDir = QDir::tempPath() + "/wa_icons";
        QDir().mkpath(tempDir);
        QString safeTitle;
        for (const QChar &c : title) {
            if (c.isLetterOrNumber() || c == ' ' || c == '.' || c == '_' || c == '-') {
                safeTitle.append(c);
            }
        }
        if (safeTitle.isEmpty()) {
            safeTitle = "notification_icon";
        }
        iconPath = QString("%1/%2.png").arg(tempDir, safeTitle);
        iconImg.save(iconPath, "PNG");
    }

    updateRecentChat(title, body);

    if (m_notificationManager) {
        m_notificationManager->sendNotification(title, body, iconPath);
    }
}

void WhatsAppClient::handleDownload(QWebEngineDownloadRequest *download) {
    QString suggested = download->suggestedFileName();
    if (suggested.isEmpty()) {
        suggested = download->downloadFileName();
    }
    if (suggested.isEmpty()) {
        suggested = "download";
    }

    QFileInfo initialInfo(m_downloadDir + "/" + suggested);
    QString base = initialInfo.completeBaseName();
    QString ext = initialInfo.suffix();
    if (!ext.isEmpty()) {
        ext = "." + ext;
    }

    QString savePath = m_downloadDir + "/" + suggested;
    int counter = 1;
    while (QFile::exists(savePath)) {
        savePath = QString("%1/%2 (%3)%4").arg(m_downloadDir, base, QString::number(counter), ext);
        counter++;
    }

    QFileInfo finalInfo(savePath);
    m_activeDownloads.insert(download);
    download->setDownloadDirectory(m_downloadDir);
    download->setDownloadFileName(finalInfo.fileName());
    download->accept();

    connect(download, &QWebEngineDownloadRequest::isFinishedChanged, this, [this, download]() {
        onDownloadFinished(download);
    });
}

void WhatsAppClient::onDownloadFinished(QWebEngineDownloadRequest *download) {
    if (!download->isFinished()) {
        return;
    }

    m_activeDownloads.remove(download);

    QString fileName = download->downloadFileName();
    QString filePath = download->downloadDirectory() + "/" + fileName;

    QString sizeMb = "?";
    QFileInfo fi(filePath);
    if (fi.exists()) {
        double mb = static_cast<double>(fi.size()) / (1024.0 * 1024.0);
        sizeMb = QString::number(mb, 'f', 1);
    }

    QString timeStr = QTime::currentTime().toString("HH:mm");

    DownloadRecord record;
    record.fileName = fileName;
    record.path = filePath;
    record.sizeMb = sizeMb;
    record.time = timeStr;
    m_sessionDownloads.append(record);

    showDownloadNotification(fileName, filePath, sizeMb);
}

void WhatsAppClient::showDownloadNotification(const QString &fileName, const QString &filePath, const QString &sizeMb) {
    Q_UNUSED(filePath);
    if (m_dndMode) {
        return;
    }
    m_trayIcon->showMessage(
        "Descarga completada",
        QString("%1 (%2 MB)").arg(fileName, sizeMb),
        QSystemTrayIcon::Information,
        4000
    );
}

void WhatsAppClient::buildTrayMenu() {
    m_trayMenu->clear();

    if (m_recentChats.isEmpty()) {
        scrapeRecentChats();
    }

    if (!m_recentChats.isEmpty()) {
        QMenu *chatsMenu = m_trayMenu->addMenu("Chats recientes");
        for (const RecentChat &chat : m_recentChats) {
            QString label = chat.name;
            if (!chat.lastMsg.isEmpty()) {
                label += QString("  ·  %1").arg(chat.lastMsg);
            }
            QAction *action = chatsMenu->addAction(label);
            QString chatName = chat.name;
            connect(action, &QAction::triggered, this, [this, chatName]() {
                openChat(chatName);
            });
        }
        m_trayMenu->addSeparator();
    }

    if (!m_sessionDownloads.isEmpty()) {
        QMenu *downloadsMenu = m_trayMenu->addMenu(QString("Descargas (%1)").arg(m_sessionDownloads.size()));
        int start = qMax(0, m_sessionDownloads.size() - 15);
        for (int i = m_sessionDownloads.size() - 1; i >= start; --i) {
            const DownloadRecord &dl = m_sessionDownloads[i];
            QString label = QString("%1  (%2 MB · %3)").arg(dl.fileName, dl.sizeMb, dl.time);
            QAction *dlAction = downloadsMenu->addAction(label);
            QString dlPath = dl.path;
            connect(dlAction, &QAction::triggered, this, [dlPath]() {
                QDesktopServices::openUrl(QUrl::fromLocalFile(dlPath));
            });
        }

        downloadsMenu->addSeparator();
        QAction *openFolderAction = downloadsMenu->addAction("Abrir carpeta de descargas");
        QString dir = m_downloadDir;
        connect(openFolderAction, &QAction::triggered, this, [dir]() {
            QDesktopServices::openUrl(QUrl::fromLocalFile(dir));
        });

        m_trayMenu->addSeparator();
    }

    QAction *showAction = m_trayMenu->addAction("Mostrar");
    connect(showAction, &QAction::triggered, this, &WhatsAppClient::show);

    QAction *dndAction = m_trayMenu->addAction("Modo no molestar");
    dndAction->setCheckable(true);
    dndAction->setChecked(m_dndMode);
    connect(dndAction, &QAction::triggered, this, &WhatsAppClient::toggleDndMode);

    QAction *privacyAction = m_trayMenu->addAction("Modo privacidad");
    connect(privacyAction, &QAction::triggered, this, &WhatsAppClient::toggleQuickPrivacy);

    QAction *lockAction = m_trayMenu->addAction("Bloquear app");
    connect(lockAction, &QAction::triggered, this, &WhatsAppClient::lockApp);

    QAction *pinConfigAction = m_trayMenu->addAction("Configurar PIN");
    connect(pinConfigAction, &QAction::triggered, this, &WhatsAppClient::openPinConfig);

    bool isLocked = (m_lockOverlay && m_lockOverlay->isLocked());
    if (!isLocked) {
        QAction *quitAction = m_trayMenu->addAction("Salir");
        connect(quitAction, &QAction::triggered, qApp, &QCoreApplication::quit);
    }
}

void WhatsAppClient::trayActivated(QSystemTrayIcon::ActivationReason reason) {
    if (reason == QSystemTrayIcon::Trigger) {
        if (isHidden()) {
            show();
            activateWindow();
        } else {
            hide();
        }
    }
}

void WhatsAppClient::updateRecentChat(const QString &name, const QString &message) {
    if (name.trimmed().isEmpty()) return;
    QString cleanName = name.trimmed();

    for (int i = 0; i < m_recentChats.size(); ++i) {
        if (m_recentChats[i].name == cleanName) {
            m_recentChats.removeAt(i);
            break;
        }
    }

    RecentChat chat;
    chat.name = cleanName;
    chat.lastMsg = message.trimmed().left(50);
    m_recentChats.prepend(chat);
    if (m_recentChats.size() > 10) {
        m_recentChats = m_recentChats.mid(0, 10);
    }
}

