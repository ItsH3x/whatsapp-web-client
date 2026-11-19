#ifndef WHATSAPP_WINDOW_H
#define WHATSAPP_WINDOW_H

#include <QMainWindow>
#include <QVariant>
#include <functional>
#include <QDialog>
#include <QWebEnginePage>
#include <QWebEnginePermission>
#include <QWebEngineView>
#include <QWebEngineProfile>
#include <QWebEngineNotification>
#include <QWebEngineDownloadRequest>
#include <QSystemTrayIcon>
#include <QMenu>
#include <QAction>
#include <QTimer>
#include <QList>
#include <QSet>
#include <QUrl>
#include <QIcon>
#include <QCloseEvent>
#include <QResizeEvent>
#include <QWheelEvent>
#include <QShowEvent>
#include <QHideEvent>
#include <QKeyEvent>
#include <QCheckBox>
#include <QPushButton>
#include <QLabel>
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QSettings>
#include <memory>

#include "config_manager.h"
#include "notification_manager.h"
#include "lock_overlay.h"
#include "whatsapp_page.h"

struct RecentChat {
    QString name;
    QString lastMsg;
};

struct DownloadRecord {
    QString fileName;
    QString path;
    QString sizeMb;
    QString time;
};

class WhatsAppClient : public QMainWindow {
    Q_OBJECT
public:
    explicit WhatsAppClient(QWidget *parent = nullptr);
    ~WhatsAppClient() override;

    void handleWhatsAppUrl(const QString &url);

public slots:
    void openChat(const QString &chatName);
    void sendWhatsAppMessage(const QString &chatName, const QString &text);
    void showPrivacyInstructionsIfNeeded(const QString &mode = "privacy");
    void toggleQuickPrivacy();
    void lockApp();
    void openPinConfig();
    void toggleDndMode(bool checked);
    void zoomIn();
    void zoomOut();
    void zoomReset();
    void toggleSidebarCompact();

protected:
    bool eventFilter(QObject *obj, QEvent *event) override;
    void closeEvent(QCloseEvent *event) override;
    void resizeEvent(QResizeEvent *event) override;
    void wheelEvent(QWheelEvent *event) override;
    void showEvent(QShowEvent *event) override;
    void hideEvent(QHideEvent *event) override;

private slots:
    void initWebEngine();
    void initDeferredServices();
    void grantPermission(QWebEnginePermission permission);
    void handleDownload(QWebEngineDownloadRequest *download);
    void onDownloadFinished(QWebEngineDownloadRequest *download);
    void onPageLoaded(bool ok);
    void onAltBHeld();
    void onAppLocked();
    void onAppUnlocked();
    void buildTrayMenu();
    void trayActivated(QSystemTrayIcon::ActivationReason reason);
    void scrapeRecentChats();
    void onChatsScraped(const QString &result);
    void initChatHelpers();
    void switchToChatByIndex(int index);
    void navigateChatByOffset(int offset);

private:
    void handleNotification(std::unique_ptr<QWebEngineNotification> notification);
    void ensureLockOverlay();
    void ensureDownloadDir();
    void setupZoom();
    void setupChatShortcuts();
    void setupPrivacyShortcut();
    bool isPrivacyActive() const;
    void applyNativeBlur(int radius);
    void removeNativeBlur();
    void showChatBadges();
    void hideChatBadges();
    void updateRecentChat(const QString &name, const QString &message);
    void showDownloadNotification(const QString &fileName, const QString &filePath, const QString &sizeMb);
    QString getInitChatHelpersJs() const;
    void runChatJs(const QString &body, std::function<void(const QVariant &)> callback = nullptr, bool retried = false);
    QString getReadReceiptBlockerJs() const;
    QString getSidebarEnhancementsJs() const;
    void setupWebScripts();

    QWebEngineView *m_browser;
    QWebEngineProfile *m_profile;
    WhatsAppPage *m_page;
    LockOverlay *m_lockOverlay;
    NotificationManager *m_notificationManager;
    QSystemTrayIcon *m_trayIcon;
    QMenu *m_trayMenu;

    bool m_dndMode;
    bool m_quickPrivacyMode;
    bool m_altBDown;
    bool m_altBHoldTriggered;
    QTimer *m_altBHoldTimer;

    int m_wheelAccumulatedDelta;
    int m_currentChatIndex;
    bool m_altKeyDown;

    QUrl m_initialUrl;
    QString m_downloadDir;
    QList<DownloadRecord> m_sessionDownloads;
    QSet<QWebEngineDownloadRequest*> m_activeDownloads;
    QList<RecentChat> m_recentChats;
};

#endif // WHATSAPP_WINDOW_H
