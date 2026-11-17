#include "whatsapp_window.h"

#include <QApplication>
#include <QDesktopServices>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>
#include <QLineEdit>
#include <QStandardPaths>
#include <QWebEngineSettings>
#include <QWebEngineScript>
#include <QWebEngineScriptCollection>
#include <QTime>
#include <QKeySequence>

// --- WhatsAppPage ---

WhatsAppPage::WhatsAppPage(QWebEngineProfile *profile, QObject *parent)
    : QWebEnginePage(profile, parent)
{
}

WhatsAppPage::WhatsAppPage(QObject *parent)
    : QWebEnginePage(parent)
{
}

bool WhatsAppPage::acceptNavigationRequest(const QUrl &url, NavigationType type, bool isMainFrame) {
    if (type == NavigationTypeLinkClicked && isMainFrame) {
        QString host = url.host();
        if (!host.isEmpty() && !host.contains("whatsapp.com") && !host.contains("whatsapp.net")) {
            QDesktopServices::openUrl(url);
            return false;
        }
    }
    return QWebEnginePage::acceptNavigationRequest(url, type, isMainFrame);
}

QWebEnginePage *WhatsAppPage::createWindow(QWebEnginePage::WebWindowType type) {
    Q_UNUSED(type);
    QWebEnginePage *tempPage = new QWebEnginePage(profile(), this);
    connect(tempPage, &QWebEnginePage::urlChanged, this, [this, tempPage](const QUrl &url) {
        handleNewWindowUrl(url, tempPage);
    });
    return tempPage;
}

void WhatsAppPage::handleNewWindowUrl(const QUrl &url, QWebEnginePage *tempPage) {
    if (url.isValid() && (url.scheme() == "http" || url.scheme() == "https")) {
        QDesktopServices::openUrl(url);
    }
    tempPage->deleteLater();
}

// --- WhatsAppClient ---

namespace {

inline bool isPureLeftAltModifier(Qt::KeyboardModifiers mods) {
    return (mods & Qt::AltModifier) && !(mods & Qt::GroupSwitchModifier);
}

inline bool isLeftAltKeyEvent(const QKeyEvent *ke) {
    return ke != nullptr
        && ke->key() == Qt::Key_Alt
        && !(ke->modifiers() & Qt::GroupSwitchModifier)
        && ke->nativeScanCode() != 108u;
}

inline bool isAltGrKeyEvent(const QKeyEvent *ke) {
    return ke != nullptr
        && (ke->key() == Qt::Key_AltGr
            || ke->key() == Qt::Key_Mode_switch
            || static_cast<bool>(ke->modifiers() & Qt::GroupSwitchModifier)
            || (ke->key() == Qt::Key_Alt && ke->nativeScanCode() == 108u));
}

} // namespace

WhatsAppClient::WhatsAppClient(QWidget *parent)
    : QMainWindow(parent)
    , m_browser(nullptr)
    , m_profile(nullptr)
    , m_page(nullptr)
    , m_lockOverlay(nullptr)
    , m_notificationManager(nullptr)
    , m_trayIcon(nullptr)
    , m_trayMenu(nullptr)
    , m_dndMode(false)
    , m_quickPrivacyMode(false)
    , m_altBDown(false)
    , m_altBHoldTriggered(false)
    , m_altBHoldTimer(nullptr)
    , m_wheelAccumulatedDelta(0)
    , m_currentChatIndex(-1)
    , m_altKeyDown(false)
{
    setWindowTitle("WhatsApp Web");
    resize(1024, 768);

    // Icono de la aplicacion y de la bandeja del sistema
    const QStringList iconCandidates = {
        QDir::homePath() + "/.local/share/whatsapp-web-client/whatsapp.svg",
        QDir::homePath() + "/.local/share/icons/hicolor/scalable/apps/whatsapp-web-client.svg",
        QCoreApplication::applicationDirPath() + "/whatsapp.svg",
        QDir::currentPath() + "/whatsapp.svg",
        QStringLiteral("/usr/share/whatsapp-web-client/whatsapp.svg"),
        QStringLiteral("/usr/share/pixmaps/whatsapp-web-client.svg"),
        QStringLiteral("/usr/share/pixmaps/whatsapp.svg")
    };
    QIcon fallbackIcon;
    for (const QString &path : iconCandidates) {
        if (QFile::exists(path)) {
            fallbackIcon = QIcon(path);
            break;
        }
    }
    QIcon appIcon = QIcon::fromTheme(QStringLiteral("whatsapp-web-client"), fallbackIcon);
    if (!appIcon.isNull()) {
        setWindowIcon(appIcon);
    }

    // Configurar QWebEngineView y QWebEngineProfile
    m_browser = new QWebEngineView(this);
    m_browser->settings()->setAttribute(QWebEngineSettings::ScrollAnimatorEnabled, true);
    m_browser->settings()->setAttribute(QWebEngineSettings::Accelerated2dCanvasEnabled, true);
    m_browser->settings()->setAttribute(QWebEngineSettings::WebGLEnabled, true);

    m_profile = new QWebEngineProfile("WhatsAppProfile", this);

    // Idioma del sistema
    QByteArray langEnv = qgetenv("LANG");
    if (langEnv.isEmpty()) {
        langEnv = "en_US.UTF-8";
    }
    QString langStr = QString::fromUtf8(langEnv).section('.', 0, 0).replace('_', '-');
    QString langBase = langStr.section('-', 0, 0);
    QString acceptLang = QString("%1,%2;q=0.9,en-US;q=0.8,en;q=0.7").arg(langStr, langBase);
    m_profile->setHttpAcceptLanguage(acceptLang);

    // User-Agent de Chrome moderno en Linux
    m_profile->setHttpUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");

    // Almacenamiento persistente
    QString storagePath = QDir::homePath() + "/.local/share/WhatsAppWebClient";
    QDir().mkpath(storagePath);
    m_profile->setPersistentStoragePath(storagePath);
    m_profile->setPersistentCookiesPolicy(QWebEngineProfile::ForcePersistentCookies);

    // Limite de cache HTTP en disco (80 MB)
    m_profile->setHttpCacheType(QWebEngineProfile::DiskHttpCache);
    m_profile->setHttpCacheMaximumSize(80 * 1024 * 1024);

    // Corrector ortografico (solo si existen diccionarios .bdic disponibles)
    QStringList dictDirs = {
        QCoreApplication::applicationDirPath() + "/qtwebengine_dictionaries",
        QStringLiteral("/usr/share/qt6/qtwebengine_dictionaries")
    };
    const QByteArray envDictPath = qgetenv("QTWEBENGINE_DICTIONARIES_PATH");
    if (!envDictPath.isEmpty()) {
        dictDirs.prepend(QString::fromLocal8Bit(envDictPath));
    }
    bool hasBdic = false;
    for (const QString &dirPath : dictDirs) {
        QDir d(dirPath);
        if (d.exists() && !d.entryList({"*.bdic"}, QDir::Files).isEmpty()) {
            hasBdic = true;
            break;
        }
    }
    if (hasBdic) {
        m_profile->setSpellCheckEnabled(true);
        m_profile->setSpellCheckLanguages({"es-ES", "en-US"});
    } else {
        m_profile->setSpellCheckEnabled(false);
    }

    // Inyectar controlador de privacidad para confirmaciones de lectura
    setupReadReceiptScript();

    // Configurar pagina personalizada y widget central
    m_page = new WhatsAppPage(m_profile, m_browser);
    m_browser->setPage(m_page);
    setCentralWidget(m_browser);

    // Permisos de notificaciones, audio y video
    connect(m_page, &QWebEnginePage::permissionRequested, this, &WhatsAppClient::grantPermission);

    // Presentador de notificaciones
    m_profile->setNotificationPresenter([this](std::unique_ptr<QWebEngineNotification> notif) {
        handleNotification(std::move(notif));
    });

    // Gestor de descargas (localizacion dinamica segun idioma del sistema)
    QString baseDownloadDir = QStandardPaths::writableLocation(QStandardPaths::DownloadLocation);
    if (baseDownloadDir.trimmed().isEmpty()) {
        baseDownloadDir = QDir::homePath() + "/Downloads";
    }
    m_downloadDir = baseDownloadDir + "/WhatsApp";
    QDir().mkpath(m_downloadDir);
    connect(m_profile, &QWebEngineProfile::downloadRequested, this, &WhatsAppClient::handleDownload);

    // Conectar carga completada para inicializar helpers de chat
    connect(m_page, &QWebEnginePage::loadFinished, this, &WhatsAppClient::onPageLoaded);

    // Gestor de notificaciones nativas DBus
    m_notificationManager = new NotificationManager(this);
    connect(m_notificationManager, &NotificationManager::replyReceived, this, &WhatsAppClient::sendWhatsAppMessage);
    connect(m_notificationManager, &NotificationManager::actionDefaultInvoked, this, &WhatsAppClient::openChat);

    // Cargar WhatsApp Web
    m_browser->setUrl(QUrl("https://web.whatsapp.com"));

    // Bandeja del sistema
    m_trayIcon = new QSystemTrayIcon(this);
    if (!appIcon.isNull()) {
        m_trayIcon->setIcon(appIcon);
    }
    m_trayMenu = new QMenu(this);
    m_trayIcon->setContextMenu(m_trayMenu);
    connect(m_trayMenu, &QMenu::aboutToShow, this, &WhatsAppClient::buildTrayMenu);
    connect(m_trayIcon, &QSystemTrayIcon::activated, this, &WhatsAppClient::trayActivated);
    m_trayIcon->show();

    // Controles de zoom
    setupZoom();

    // Atajos de cambio de chat (Alt+1..9, Alt+0)
    setupChatShortcuts();

    // Estado inicial
    m_dndMode = false;

    // Overlay de bloqueo
    m_lockOverlay = new LockOverlay(this);
    connect(m_lockOverlay, &LockOverlay::locked, this, &WhatsAppClient::onAppLocked);
    connect(m_lockOverlay, &LockOverlay::unlocked, this, &WhatsAppClient::onAppUnlocked);

    // Atajo de privacidad y bloqueo (Alt+B)
    setupPrivacyShortcut();

    // Restaurar estado de bloqueo si persistia activo
    if (ConfigManager::hasPin() && ConfigManager::isAppLocked()) {
        applyNativeBlur(24);
        m_lockOverlay->lock();
    }
}

WhatsAppClient::~WhatsAppClient() {
    if (qApp) {
        qApp->removeEventFilter(this);
    }
}

void WhatsAppClient::grantPermission(QWebEnginePermission permission) {
    permission.grant();
}

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

void WhatsAppClient::closeEvent(QCloseEvent *event) {
    if (m_altKeyDown) {
        m_altKeyDown = false;
        m_wheelAccumulatedDelta = 0;
        hideChatBadges();
    }
    event->ignore();
    hide();
}

void WhatsAppClient::hideEvent(QHideEvent *event) {
    if (m_altKeyDown) {
        m_altKeyDown = false;
        m_wheelAccumulatedDelta = 0;
        hideChatBadges();
    }
    QMainWindow::hideEvent(event);
    if (m_browser && m_browser->page()) {
        // Reducir consumo de recursos al ocultar
    }
}

void WhatsAppClient::showEvent(QShowEvent *event) {
    QMainWindow::showEvent(event);
    if (!isPureLeftAltModifier(QApplication::keyboardModifiers())) {
        m_altKeyDown = false;
        m_wheelAccumulatedDelta = 0;
        hideChatBadges();
    }
    if (m_browser && m_browser->page()) {
        m_browser->page()->setLifecycleState(QWebEnginePage::LifecycleState::Active);
    }
    if (m_browser) {
        m_browser->installEventFilter(this);
        if (m_browser->focusProxy()) {
            m_browser->focusProxy()->installEventFilter(this);
        }
        for (QObject *child : m_browser->children()) {
            if (child->isWidgetType()) {
                child->installEventFilter(this);
            }
        }
    }
}

void WhatsAppClient::resizeEvent(QResizeEvent *event) {
    QMainWindow::resizeEvent(event);
    if (m_lockOverlay) {
        m_lockOverlay->setGeometry(rect());
    }
}

void WhatsAppClient::wheelEvent(QWheelEvent *event) {
    Qt::KeyboardModifiers mods = event->modifiers();
    Qt::KeyboardModifiers appMods = QApplication::keyboardModifiers();
    bool hasAltGr = (mods & Qt::GroupSwitchModifier) || (appMods & Qt::GroupSwitchModifier);
    bool sysAlt = !hasAltGr && (isPureLeftAltModifier(mods) || isPureLeftAltModifier(appMods));
    if (m_altKeyDown && hasAltGr) {
        m_altKeyDown = false;
        m_wheelAccumulatedDelta = 0;
        hideChatBadges();
    }
    bool altPressed = (m_altKeyDown || sysAlt) && !hasAltGr;

    if (altPressed) {
        int delta = event->angleDelta().y();
        if (delta == 0) {
            delta = event->angleDelta().x();
        }
        if (delta == 0 && !event->pixelDelta().isNull()) {
            delta = event->pixelDelta().y();
            if (delta == 0) {
                delta = event->pixelDelta().x();
            }
        }
        if (delta > 0) {
            navigateChatByOffset(-1);
        } else if (delta < 0) {
            navigateChatByOffset(1);
        }
        event->accept();
        return;
    }
    if ((mods & Qt::ControlModifier) || (appMods & Qt::ControlModifier)) {
        int delta = event->angleDelta().y();
        if (delta > 0) {
            zoomIn();
        } else if (delta < 0) {
            zoomOut();
        }
        event->accept();
    } else {
        QMainWindow::wheelEvent(event);
    }
}

void WhatsAppClient::setupPrivacyShortcut() {
    m_quickPrivacyMode = false;
    m_altBDown = false;
    m_altBHoldTriggered = false;

    m_altBHoldTimer = new QTimer(this);
    m_altBHoldTimer->setSingleShot(true);
    m_altBHoldTimer->setInterval(500);
    connect(m_altBHoldTimer, &QTimer::timeout, this, &WhatsAppClient::onAltBHeld);

    if (qApp) {
        qApp->installEventFilter(this);
    }
}

bool WhatsAppClient::isPrivacyActive() const {
    if (m_quickPrivacyMode) {
        return true;
    }
    if (m_lockOverlay && m_lockOverlay->isLocked()) {
        return true;
    }
    return false;
}

bool WhatsAppClient::eventFilter(QObject *obj, QEvent *event) {
    if (QApplication::activeModalWidget() != nullptr) {
        if (m_altKeyDown) {
            m_altKeyDown = false;
            m_wheelAccumulatedDelta = 0;
            hideChatBadges();
        }
        return QMainWindow::eventFilter(obj, event);
    }

    QEvent::Type etype = event->type();

    // Solo la desactivacion real de la ventana/aplicacion oculta los badges.
    if ((etype == QEvent::WindowDeactivate && obj == this) || etype == QEvent::ApplicationDeactivate) {
        m_wheelAccumulatedDelta = 0;
        if (m_altKeyDown) {
            m_altKeyDown = false;
            hideChatBadges();
        }
    }

    if (etype == QEvent::MouseButtonPress && m_altKeyDown) {
        if (!isPureLeftAltModifier(QApplication::keyboardModifiers())) {
            m_altKeyDown = false;
            m_wheelAccumulatedDelta = 0;
            hideChatBadges();
        }
    }

    if (etype == QEvent::Wheel) {
        if (m_lockOverlay && m_lockOverlay->isLocked()) {
            return true;
        }
        if (m_quickPrivacyMode) {
            return true;
        }

        auto *wheelEv = static_cast<QWheelEvent *>(event);
        Qt::KeyboardModifiers mods = wheelEv->modifiers();
        Qt::KeyboardModifiers appMods = QApplication::keyboardModifiers();
        bool hasAltGr = (mods & Qt::GroupSwitchModifier) || (appMods & Qt::GroupSwitchModifier);
        bool sysAlt = !hasAltGr && (isPureLeftAltModifier(mods) || isPureLeftAltModifier(appMods));
        if (m_altKeyDown && hasAltGr) {
            m_altKeyDown = false;
            m_wheelAccumulatedDelta = 0;
            hideChatBadges();
        }
        bool altPressed = (m_altKeyDown || sysAlt) && !hasAltGr;

        if (altPressed) {
            static quint64 lastWheelTimestamp = 0;
            const quint64 wheelTimestamp = wheelEv->timestamp();
            if (wheelTimestamp != 0 && wheelTimestamp == lastWheelTimestamp) {
                wheelEv->accept();
                return true;
            }
            if (wheelTimestamp != 0) {
                lastWheelTimestamp = wheelTimestamp;
            }

            int delta = wheelEv->angleDelta().y();
            if (delta == 0) {
                delta = wheelEv->angleDelta().x();
            }
            if (delta == 0 && !wheelEv->pixelDelta().isNull()) {
                delta = wheelEv->pixelDelta().y();
                if (delta == 0) {
                    delta = wheelEv->pixelDelta().x();
                }
            }

            if (delta != 0) {
                if ((delta > 0 && m_wheelAccumulatedDelta < 0) || (delta < 0 && m_wheelAccumulatedDelta > 0)) {
                    m_wheelAccumulatedDelta = 0;
                }

                m_wheelAccumulatedDelta += delta;
                const int stepThreshold = 40;

                if (m_wheelAccumulatedDelta >= stepThreshold) {
                    m_wheelAccumulatedDelta = 0;
                    navigateChatByOffset(-1); // Rueda arriba -> Chat anterior
                } else if (m_wheelAccumulatedDelta <= -stepThreshold) {
                    m_wheelAccumulatedDelta = 0;
                    navigateChatByOffset(1);  // Rueda abajo -> Chat siguiente
                }
            }
            wheelEv->accept();
            return true;
        }

        if ((mods & Qt::ControlModifier) || (appMods & Qt::ControlModifier)) {
            int delta = wheelEv->angleDelta().y();
            if (delta > 0) {
                zoomIn();
            } else if (delta < 0) {
                zoomOut();
            }
            wheelEv->accept();
            return true;
        }
    }

    if (etype == QEvent::KeyPress) {
        auto *keyEvent = static_cast<QKeyEvent *>(event);
        if (keyEvent->key() == Qt::Key_B && isPureLeftAltModifier(keyEvent->modifiers())) {
            if (keyEvent->isAutoRepeat()) {
                return true;
            }

            m_altKeyDown = false;
            hideChatBadges();

            if (m_lockOverlay && m_lockOverlay->isLocked()) {
                if (m_lockOverlay->pinInput()) {
                    m_lockOverlay->pinInput()->setFocus();
                } else {
                    m_lockOverlay->setFocus();
                }
                return true;
            }

            m_altBDown = true;
            m_altBHoldTriggered = false;
            m_altBHoldTimer->start();
            return true;
        }

        if (isAltGrKeyEvent(keyEvent)) {
            if (m_altKeyDown) {
                m_altKeyDown = false;
                m_wheelAccumulatedDelta = 0;
                hideChatBadges();
            }
        } else if (isLeftAltKeyEvent(keyEvent) && !keyEvent->isAutoRepeat()) {
            // El mismo KeyPress llega a varios filtros (qApp, m_browser, focusProxy, hijos):
            // solo la primera transicion a "presionado" muestra los badges.
            if (!m_altKeyDown) {
                m_altKeyDown = true;
                if (!isPrivacyActive()) {
                    showChatBadges();
                }
            }
        } else if (m_altKeyDown &&
                   !isLeftAltKeyEvent(keyEvent) &&
                   !isPureLeftAltModifier(keyEvent->modifiers())) {
            m_altKeyDown = false;
            m_wheelAccumulatedDelta = 0;
            hideChatBadges();
        }
    } else if (etype == QEvent::KeyRelease) {
        auto *keyEvent = static_cast<QKeyEvent *>(event);
        if (m_altBDown && (keyEvent->key() == Qt::Key_B || keyEvent->key() == Qt::Key_Alt || isAltGrKeyEvent(keyEvent))) {
            if (keyEvent->isAutoRepeat()) {
                return true;
            }

            if (m_altBHoldTimer->isActive()) {
                m_altBHoldTimer->stop();
                toggleQuickPrivacy();
            }

            m_altBDown = false;
            m_altBHoldTriggered = false;
            if (keyEvent->key() == Qt::Key_Alt || isAltGrKeyEvent(keyEvent)) {
                m_wheelAccumulatedDelta = 0;
                if (m_altKeyDown) {
                    m_altKeyDown = false;
                    hideChatBadges();
                }
            }
            return true;
        }

        if ((keyEvent->key() == Qt::Key_Alt || isAltGrKeyEvent(keyEvent)) && !keyEvent->isAutoRepeat()) {
            if (m_altKeyDown) {
                m_altKeyDown = false;
                m_wheelAccumulatedDelta = 0;
                hideChatBadges();
            } else if (isLeftAltKeyEvent(keyEvent)) {
                m_wheelAccumulatedDelta = 0;
            }
        }
    }

    if (m_quickPrivacyMode) {
        switch (etype) {
        case QEvent::KeyPress:
        case QEvent::KeyRelease:
        case QEvent::MouseButtonPress:
        case QEvent::MouseButtonRelease:
        case QEvent::MouseButtonDblClick:
        case QEvent::MouseMove:
        case QEvent::Wheel:
        case QEvent::ContextMenu:
        case QEvent::InputMethod:
        case QEvent::ShortcutOverride:
            return true;
        default:
            break;
        }
    }

    return QMainWindow::eventFilter(obj, event);
}

void WhatsAppClient::onAltBHeld() {
    m_altBHoldTriggered = true;
    lockApp();
}

void WhatsAppClient::showPrivacyInstructionsIfNeeded(const QString &mode) {
    QSettings settings("WhatsAppWebClient", "WhatsAppWebClient");
    if (settings.value("hide_privacy_instructions", false).toBool()) {
        return;
    }
    PrivacyInstructionDialog dialog(this, mode);
    dialog.exec();
}

void WhatsAppClient::toggleQuickPrivacy() {
    if (m_lockOverlay && m_lockOverlay->isLocked()) {
        return;
    }

    m_quickPrivacyMode = !m_quickPrivacyMode;
    if (m_quickPrivacyMode) {
        applyNativeBlur(18);
        QTimer::singleShot(150, this, [this]() {
            showPrivacyInstructionsIfNeeded("privacy");
        });
    } else {
        removeNativeBlur();
    }
}

void WhatsAppClient::lockApp() {
    show();
    activateWindow();
    m_quickPrivacyMode = false;
    if (m_lockOverlay) {
        m_lockOverlay->lock();
    }
    QTimer::singleShot(150, this, [this]() {
        showPrivacyInstructionsIfNeeded("lock");
    });
}

void WhatsAppClient::onAppLocked() {
    applyNativeBlur(24);
}

void WhatsAppClient::onAppUnlocked() {
    removeNativeBlur();
    m_quickPrivacyMode = false;
    m_browser->setFocus();
}

void WhatsAppClient::applyNativeBlur(int radius) {
    if (m_browser && m_browser->graphicsEffect()) {
        m_browser->setGraphicsEffect(nullptr);
    }
    if (!m_browser || !m_browser->page()) {
        return;
    }

    QString js = QString(R"JS(
        (function() {
            var overlay = document.getElementById('wa-privacy-blur-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'wa-privacy-blur-overlay';
                document.body.appendChild(overlay);
            }
            if (overlay) {
                overlay.style.cssText = 'position: fixed !important; ' +
                    'top: -50px !important; left: -50px !important; ' +
                    'right: -50px !important; bottom: -50px !important; ' +
                    'backdrop-filter: blur(%1px) !important; ' +
                    '-webkit-backdrop-filter: blur(%1px) !important; ' +
                    'background: rgba(11, 20, 26, 0.35) !important; ' +
                    'z-index: 999999 !important; ' +
                    'pointer-events: all !important; ' +
                    'user-select: none !important;';
            }
            var oldStyle = document.getElementById('wa-privacy-blur-style');
            if (oldStyle) {
                oldStyle.remove();
            }
        })();
    )JS").arg(radius);

    m_browser->page()->runJavaScript(js);
}

void WhatsAppClient::removeNativeBlur() {
    if (m_browser && m_browser->graphicsEffect()) {
        m_browser->setGraphicsEffect(nullptr);
    }
    if (!m_browser || !m_browser->page()) {
        return;
    }

    QString js = R"JS(
        (function() {
            var overlay = document.getElementById('wa-privacy-blur-overlay');
            if (overlay) {
                overlay.remove();
            }
            var oldStyle = document.getElementById('wa-privacy-blur-style');
            if (oldStyle) {
                oldStyle.remove();
            }
        })();
    )JS";

    m_browser->page()->runJavaScript(js);
}

void WhatsAppClient::openPinConfig() {
    PinConfigDialog dialog(this);
    dialog.exec();
}

void WhatsAppClient::toggleDndMode(bool checked) {
    m_dndMode = checked;
    if (m_browser && m_browser->page()) {
        m_browser->page()->setAudioMuted(m_dndMode);
    }
}

void WhatsAppClient::setupChatShortcuts() {
    for (int i = 0; i < 10; ++i) {
        QAction *action = new QAction(this);
        action->setShortcut(QKeySequence(QString("Alt+%1").arg(i)));
        int chatIndex = (i == 0) ? 9 : (i - 1);
        connect(action, &QAction::triggered, this, [this, chatIndex]() {
            switchToChatByIndex(chatIndex);
        });
        addAction(action);
    }

    // Atajo para alternar el modo compacto de la barra lateral (Alt+M)
    QAction *toggleCompactAction = new QAction(this);
    toggleCompactAction->setShortcut(QKeySequence("Alt+M"));
    connect(toggleCompactAction, &QAction::triggered, this, &WhatsAppClient::toggleSidebarCompact);
    addAction(toggleCompactAction);
}

QString WhatsAppClient::getInitChatHelpersJs() const {
    return QString::fromUtf8(R"JS(
(function() {
    // 1. Inyectar estilos CSS para scrollbar y badges de atajos
    if (!document.getElementById('wa-alt-badge-styles')) {
        var style = document.createElement('style');
        style.id = 'wa-alt-badge-styles';
        style.textContent = `
            ::-webkit-scrollbar { width: 6px !important; height: 6px !important; }
            ::-webkit-scrollbar-track { background: transparent !important; }
            ::-webkit-scrollbar-thumb { background: rgba(128, 128, 128, 0.25) !important; border-radius: 3px !important; }
            ::-webkit-scrollbar-thumb:hover { background: rgba(128, 128, 128, 0.45) !important; }
            .wa-alt-badge {
                position: absolute !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                width: 20px !important;
                height: 20px !important;
                line-height: 1 !important;
                text-align: center !important;
                font-size: 11px !important;
                font-weight: 800 !important;
                font-family: 'Segoe UI', system-ui, -apple-system, sans-serif !important;
                color: #ffffff !important;
                background: #00a884 !important;
                border: 2px solid #ffffff !important;
                border-radius: 50% !important;
                pointer-events: none !important;
                z-index: 999999 !important;
                box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5) !important;
                box-sizing: border-box !important;
                padding: 0 0 2px 0 !important;
                margin: 0 !important;
                animation: wa-badge-pop 0.1s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important;
            }
            @keyframes wa-badge-pop {
                0% { transform: scale(0.3); opacity: 0; }
                100% { transform: scale(1); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }

    // 2. Funcion para obtener chats validos ignorando completamente la pestana de Archivados
    // y capturando todas las conversaciones visibles (fijadas, propias y normales) en su orden visual exacto.
    window.__waGetValidChats = function(skipViewportFilter) {
        if (window.__waEnsurePaneListeners) {
            window.__waEnsurePaneListeners();
        }
        var pane = document.getElementById('pane-side');
        if (!pane) return [];
        var paneRect = pane.getBoundingClientRect();

        var rawList = [];

        // Estrategia A: Filas accesibles con role="row" o role="listitem"
        var roleNodes = pane.querySelectorAll('[role="row"], [role="listitem"]');
        for (var r = 0; r < roleNodes.length; r++) {
            var node = roleNodes[r];
            var h = node.offsetHeight || node.getBoundingClientRect().height;
            // Descartar contenedores globales y elementos vacios (altura tipica de fila: 40px a 140px)
            if (h >= 40 && h <= 140) {
                if (rawList.indexOf(node) === -1) {
                    rawList.push(node);
                }
            }
        }

        // Estrategia B: Celdas de la lista virtualizada con transform translateY o translate3d
        var virtualNodes = pane.querySelectorAll('div[style*="translateY"], div[style*="translate3d"]');
        for (var v = 0; v < virtualNodes.length; v++) {
            var vNode = virtualNodes[v];
            var vh = vNode.offsetHeight || vNode.getBoundingClientRect().height;
            if (vh >= 40 && vh <= 140) {
                var semRow = vNode.querySelector('[role="row"], [role="listitem"]') || vNode;
                if (rawList.indexOf(semRow) === -1 && rawList.indexOf(vNode) === -1) {
                    rawList.push(semRow);
                }
            }
        }

        // Estrategia C: Fallback para estructuras con cell-frame-container
        if (!rawList.length) {
            var cellFrames = pane.querySelectorAll('div[data-testid="cell-frame-container"]');
            for (var c = 0; c < cellFrames.length; c++) {
                var cf = cellFrames[c];
                var row = cf.closest('[role="row"], [role="listitem"]') || cf;
                if (rawList.indexOf(row) === -1) {
                    rawList.push(row);
                }
            }
        }

        // Deduplicacion jerarquica (evitar que un contenedor padre y su hijo figuren a la vez)
        var dedupedList = [];
        for (var i = 0; i < rawList.length; i++) {
            var item = rawList[i];
            var isContained = false;
            for (var j = 0; j < rawList.length; j++) {
                if (i !== j && rawList[j].contains(item)) {
                    isContained = true;
                    break;
                }
            }
            if (!isContained && dedupedList.indexOf(item) === -1) {
                dedupedList.push(item);
            }
        }

        var validChats = [];
        for (var k = 0; k < dedupedList.length; k++) {
            var el = dedupedList[k];

            // Deteccion de chat anclado / fijado (pin):
            // Si contiene el icono de fijado, es obligatoriamente un chat valido y NUNCA debe descartarse como archivado
            var isPinned = el.querySelector('span[data-icon*="pin"], [data-testid*="pin"]') !== null;

            if (!isPinned) {
                // Filtrar si es la fila de Archivados por icono de archivado
                var hasArchiveIcon = el.querySelector('span[data-icon*="archive"], [data-testid*="archive"]') !== null;
                if (hasArchiveIcon) {
                    continue;
                }

                // Filtrar por texto si coincide con Archivados/Archived/Arquivadas
                var titleEl = el.querySelector('span[title], div[data-testid="cell-frame-title"] span, span[dir="auto"]');
                var title = titleEl ? (titleEl.getAttribute('title') || titleEl.innerText || titleEl.textContent || '').trim().toLowerCase() : '';
                if (/^(archivados|archived|arquivadas)/i.test(title)) {
                    continue;
                }

                var fullText = (el.innerText || el.textContent || '').trim().toLowerCase();
                if (/^(archivados|archived|arquivadas)(\s*\d+)?$/i.test(fullText)) {
                    continue;
                }
            }

            // Verificar que contiene la estructura minima de un chat real (avatar o contenido de texto)
            var hasChatContent = el.querySelector('img') || 
                                 el.querySelector('svg') || 
                                 el.querySelector('span[data-icon]') ||
                                 el.querySelector('span[title]') || 
                                 el.querySelector('span[dir="auto"]') ||
                                 el.querySelector('div[data-testid*="cell-frame"]');
            if (!hasChatContent) {
                continue;
            }

            if (!skipViewportFilter && paneRect.height > 0) {
                var elRect = el.getBoundingClientRect();
                var centerY = elRect.top + (elRect.height / 2);
                if (centerY < paneRect.top || centerY > paneRect.bottom) {
                    continue;
                }
            }

            validChats.push(el);
        }

        // Ordenar visualmente de arriba a abajo por coordenada Y para que el primer chat visible sea siempre el indice 0
        validChats.sort(function(a, b) {
            return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
        });

        return validChats;
    };

    // 3. Funcion para mostrar badges sobre la esquina de la foto de perfil sin depender de cell-frame-container
    window.__waShowAltBadges = function() {
        // Reutiliza los badges existentes: solo crea (con animacion) los que faltan,
        // actualiza posicion/etiqueta de los ya visibles y elimina los sobrantes.
        var validChats = window.__waGetValidChats();
        var count = Math.min(validChats.length, 10);
        var keep = [];

        for (var i = 0; i < count; i++) {
            var keyLabel = (i < 9) ? String(i + 1) : '0';
            var chatRow = validChats[i];

            var rowRect = chatRow.getBoundingClientRect();
            if (!rowRect.width || !rowRect.height) continue;

            var candidate = null;

            // 1. Imagen de perfil directa en cualquier parte de la fila
            var imgs = chatRow.querySelectorAll('img');
            for (var m = 0; m < imgs.length; m++) {
                var imgRect = imgs[m].getBoundingClientRect();
                if (imgRect.width >= 30 && imgRect.height >= 30) {
                    candidate = imgs[m];
                    break;
                }
            }

            // 2. Anillo de historia o boton de avatar circular
            if (!candidate) {
                var buttons = chatRow.querySelectorAll('div[role="button"]');
                for (var b = 0; b < buttons.length; b++) {
                    var btnRect = buttons[b].getBoundingClientRect();
                    // El avatar siempre esta ubicado en el tercio izquierdo de la fila
                    if (btnRect.width >= 35 && btnRect.height >= 35 && (btnRect.left - rowRect.left) < 75) {
                        candidate = buttons[b];
                        break;
                    }
                }
            }

            // 3. Icono o SVG de avatar (contactos o chats propios sin foto de perfil personalizada)
            if (!candidate) {
                var icons = chatRow.querySelectorAll('span[data-icon="default-user"], span[data-icon="community-outline"], span[data-icon*="avatar"], span[data-icon*="default-"], span[data-icon*="channel"], span[data-icon*="newsletter"], svg');
                for (var ic = 0; ic < icons.length; ic++) {
                    var icRect = icons[ic].getBoundingClientRect();
                    if ((icRect.left - rowRect.left) < 75 && icRect.width >= 20) {
                        var pDiv = icons[ic].closest('div');
                        if (pDiv && chatRow.contains(pDiv) && pDiv.getBoundingClientRect().width >= 30) {
                            candidate = pDiv;
                        } else {
                            candidate = icons[ic];
                        }
                        break;
                    }
                }
            }

            // 4. Busqueda por dimensiones tipicas de avatar en la columna izquierda
            if (!candidate) {
                var descendants = chatRow.querySelectorAll('div, span');
                for (var d = 0; d < descendants.length; d++) {
                    var rect = descendants[d].getBoundingClientRect();
                    if (rect.width >= 35 && rect.width <= 65 && rect.height >= 35 && rect.height <= 65 && (rect.left - rowRect.left) < 75) {
                        candidate = descendants[d];
                        break;
                    }
                }
            }

            var cx, cy;
            var candRadius = 24.5;
            if (candidate) {
                var candRect = candidate.getBoundingClientRect();
                cx = (candRect.left - rowRect.left) + (candRect.width / 2);
                cy = (candRect.top - rowRect.top) + (candRect.height / 2);
                candRadius = Math.min(candRect.width, candRect.height) / 2;
            } else {
                // Fallback geometrico: en modo compacto se centra en rowRect.width / 2; en modo normal cx = 36.5
                cx = (rowRect.width <= 85) ? (rowRect.width / 2) : 36.5;
                cy = rowRect.height / 2;
            }

            var badgeTop = Math.round(cy - candRadius - 3);
            var badgeLeft = Math.round(cx - candRadius - 3);

            // Clamping estricto para evitar recorte en los limites de la fila 0 de #pane-side
            badgeTop = Math.max(2, badgeTop);
            badgeLeft = Math.max(2, badgeLeft);

            if (getComputedStyle(chatRow).position === 'static') {
                chatRow.style.position = 'relative';
            }
            if (chatRow.style.getPropertyValue('overflow') !== 'visible' ||
                chatRow.style.getPropertyPriority('overflow') !== 'important') {
                chatRow.style.setProperty('overflow', 'visible', 'important');
            }

            var badge = null;
            for (var cb = 0; cb < chatRow.children.length; cb++) {
                if (chatRow.children[cb].classList && chatRow.children[cb].classList.contains('wa-alt-badge')) {
                    badge = chatRow.children[cb];
                    break;
                }
            }
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'wa-alt-badge';
                chatRow.appendChild(badge);
            }
            if (badge.textContent !== keyLabel) badge.textContent = keyLabel;
            var topStr = badgeTop + 'px';
            var leftStr = badgeLeft + 'px';
            if (badge.style.top !== topStr) badge.style.top = topStr;
            if (badge.style.left !== leftStr) badge.style.left = leftStr;
            keep.push(badge);
        }

        document.querySelectorAll('.wa-alt-badge').forEach(function(el) {
            if (keep.indexOf(el) === -1) el.remove();
        });
    };

    // 4. Funcion para ocultar badges
    window.__waHideAltBadges = function() {
        document.querySelectorAll('.wa-alt-badge').forEach(function(el) { el.remove(); });
    };

    // 5. Funcion unificada de seleccion y clic simulado 100% compatible con React 18
    window.__waSelectChatElement = function(target, preserveSeenState) {
        if (!target) return;

        var isAlreadySelected = (target.getAttribute && target.getAttribute('aria-selected') === 'true') ||
                                (target.querySelector && target.querySelector('[aria-selected="true"]') !== null);
        if (!preserveSeenState && !window.__waMarkingSeenActive && !isAlreadySelected && window.__waCancelTemporarySeen) {
            window.__waCancelTemporarySeen();
        }

        // Priorizar el texto del nombre del chat (span[title], div[data-testid="cell-frame-title"], span[dir="auto"])
        // verificando que sea visible; si no es visible (como en modo compacto), clicar el contenedor de la fila
        var clickCandidate = target.querySelector('span[title]') || 
                              target.querySelector('div[data-testid="cell-frame-title"] span') || 
                              target.querySelector('div[data-testid="cell-frame-title"]') || 
                              target.querySelector('span[dir="auto"]') || 
                              target.querySelector('[role="gridcell"]:not(:first-child)');

        var clickTarget = target;
        if (clickCandidate) {
            var cRect = clickCandidate.getBoundingClientRect();
            var cStyle = window.getComputedStyle(clickCandidate);
            if (cRect.width > 0 && cRect.height > 0 && cStyle.display !== 'none' && cStyle.visibility !== 'hidden') {
                clickTarget = clickCandidate;
            }
        }

        var rect = clickTarget.getBoundingClientRect();
        var clientX = Math.round(rect.left + (rect.width > 0 ? rect.width / 2 : 10));
        var clientY = Math.round(rect.top + (rect.height > 0 ? rect.height / 2 : 10));

        var commonOpts = {
            bubbles: true,
            cancelable: true,
            view: window,
            composed: true,
            clientX: clientX,
            clientY: clientY,
            screenX: clientX,
            screenY: clientY
        };

        var downOpts = Object.assign({}, commonOpts, { button: 0, buttons: 1 });
        if (window.PointerEvent) {
            clickTarget.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, downOpts, {
                pointerId: 1,
                pointerType: 'mouse',
                isPrimary: true
            })));
        }
        clickTarget.dispatchEvent(new MouseEvent('mousedown', downOpts));

        if (typeof target.focus === 'function') {
            try { target.focus(); } catch (e) {}
        }

        var upOpts = Object.assign({}, commonOpts, { button: 0, buttons: 0 });
        if (window.PointerEvent) {
            clickTarget.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, upOpts, {
                pointerId: 1,
                pointerType: 'mouse',
                isPrimary: true
            })));
        }
        clickTarget.dispatchEvent(new MouseEvent('mouseup', upOpts));
        clickTarget.dispatchEvent(new MouseEvent('click', upOpts));

        if (typeof clickTarget.click === 'function') {
            try { clickTarget.click(); } catch (e) {}
        }

        if (typeof target.scrollIntoView === 'function') {
            target.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        }

        if (!preserveSeenState && !window.__waMarkingSeenActive && typeof window.__waScheduleReadOnlyChatCheck === 'function') {
            window.__waScheduleReadOnlyChatCheck();
        }
    };

    // 6. Obtener el indice del chat seleccionado actualmente
    window.__waGetCurrentChatIndex = function(includeAllMounted) {
        var validChats = (window.__waGetValidChats) ? window.__waGetValidChats(!!includeAllMounted) : [];
        if (!validChats.length) return -1;

        // 1. Prioridad: atributo aria-selected en la fila o sus hijos
        for (var i = 0; i < validChats.length; i++) {
            var row = validChats[i];
            if (row.getAttribute('aria-selected') === 'true' || 
                row.querySelector('[aria-selected="true"]') !== null) {
                return i;
            }
        }

        // 2. Coincidencia por titulo activo en el header de #main (con normalizacion de sufijos como Tu/You)
        var mainHeader = document.querySelector('#main header');
        if (mainHeader) {
            var titleEl = mainHeader.querySelector('span[title]') || 
                          mainHeader.querySelector('div[data-testid="conversation-info-header"] span[title]') ||
                          mainHeader.querySelector('div[role="button"] span[dir="auto"]') ||
                          mainHeader.querySelector('span[dir="auto"]');
            if (titleEl) {
                var rawActiveTitle = (titleEl.getAttribute('title') || titleEl.innerText || titleEl.textContent || '').trim().toLowerCase();
                var activeTitle = rawActiveTitle.replace(/\s*\((tú|you|tu)\)\s*/gi, '').trim();
                if (activeTitle) {
                    for (var j = 0; j < validChats.length; j++) {
                        var rTitle = validChats[j].querySelector('span[title]') || 
                                     validChats[j].querySelector('div[data-testid="cell-frame-title"] span') || 
                                     validChats[j].querySelector('span[dir="auto"]');
                        if (rTitle) {
                            var rawChatTitle = (rTitle.getAttribute('title') || rTitle.innerText || rTitle.textContent || '').trim().toLowerCase();
                            var chatTitle = rawChatTitle.replace(/\s*\((tú|you|tu)\)\s*/gi, '').trim();
                            if (chatTitle && (chatTitle === activeTitle || rawChatTitle === rawActiveTitle)) {
                                return j;
                            }
                        }
                    }
                }
            }
        }

        // 3. Fallback al indice cacheado
        if (typeof window.__waCurrentChatIndex === 'number' && 
            window.__waCurrentChatIndex >= 0 && 
            window.__waCurrentChatIndex < validChats.length) {
            return window.__waCurrentChatIndex;
        }

        return -1;
    };

    // 7. Navegacion secuencial por chats (+1 abajo, -1 arriba)
    window.__waNavigateChat = function(offset) {
        var validChats = (window.__waGetValidChats) ? window.__waGetValidChats(true) : [];
        if (!validChats.length) return -1;

        var currentIndex = window.__waGetCurrentChatIndex(true);
        var targetIndex = 0;

        if (currentIndex === -1) {
            targetIndex = (offset > 0) ? 0 : 0;
        } else {
            targetIndex = currentIndex + offset;
            if (targetIndex < 0) {
                targetIndex = 0;
            } else if (targetIndex >= validChats.length) {
                targetIndex = validChats.length - 1;
            }
        }

        if (targetIndex === currentIndex && currentIndex !== -1) {
            if (window.__waShowAltBadges && window.__waAltKeyDown) {
                window.__waShowAltBadges();
            }
            return targetIndex;
        }

        window.__waCurrentChatIndex = targetIndex;
        window.__waHasRepliedInCurrentChat = false;
        window.__waMarkingSeenActive = false;
        if (window.__waCancelTemporarySeen) {
            window.__waCancelTemporarySeen();
        }

        var target = validChats[targetIndex];
        if (target && window.__waSelectChatElement) {
            window.__waSelectChatElement(target);
        }

        if (window.__waShowAltBadges && window.__waAltKeyDown) {
            window.__waShowAltBadges();
            setTimeout(function() { if (window.__waAltKeyDown && window.__waShowAltBadges) window.__waShowAltBadges(); }, 90);
            setTimeout(function() { if (window.__waAltKeyDown && window.__waShowAltBadges) window.__waShowAltBadges(); }, 240);
        }

        return targetIndex;
    };

    // 7b. Busqueda de chat por nombre con scroll progresivo sobre la lista virtualizada de #pane-side
    window.__waFindChatTimer = null;
    window.__waFindAndOpenChat = function(targetName, onFoundCallback) {
        if (window.__waFindChatTimer) {
            clearTimeout(window.__waFindChatTimer);
            window.__waFindChatTimer = null;
        }

        var norm = function(s) {
            return (s || '')
                .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
                .replace(/\s*\((tú|you|tu)\)\s*/gi, '')
                .trim()
                .toLowerCase();
        };
        var wanted = norm(targetName);
        if (!wanted) return -1;

        var matchRow = function(row) {
            var candidates = row.querySelectorAll('span[title], div[data-testid="cell-frame-title"] span, [role="gridcell"] span[dir="auto"], span[dir="auto"]');
            for (var c = 0; c < candidates.length; c++) {
                var el = candidates[c];
                var attrTitle = el.getAttribute('title');
                if (attrTitle && norm(attrTitle) === wanted) {
                    return true;
                }
                var txt = (el.textContent || '').trim();
                if (txt && norm(txt) === wanted) {
                    return true;
                }
            }
            var rowTitle = row.getAttribute('title');
            return rowTitle ? norm(rowTitle) === wanted : false;
        };

        var tryFindInDom = function() {
            var chats = window.__waGetValidChats ? window.__waGetValidChats(true) : [];
            for (var i = 0; i < chats.length; i++) {
                if (matchRow(chats[i])) {
                    window.__waCurrentChatIndex = i;
                    return chats[i];
                }
            }
            var fallbackRows = document.querySelectorAll('#pane-side [role="row"], #pane-side [role="listitem"]');
            for (var j = 0; j < fallbackRows.length; j++) {
                if (matchRow(fallbackRows[j])) {
                    return fallbackRows[j];
                }
            }
            return null;
        };

        var immediate = tryFindInDom();
        if (immediate) {
            window.__waSelectChatElement(immediate);
            if (typeof onFoundCallback === 'function') {
                onFoundCallback(immediate);
            }
            return 1;
        }

        var pane = document.getElementById('pane-side');
        if (!pane) {
            return -1;
        }
        var scrollBox = pane;
        if (scrollBox.scrollHeight <= scrollBox.clientHeight) {
            var descendants = pane.querySelectorAll('div');
            for (var sc = 0; sc < descendants.length; sc++) {
                if (descendants[sc].scrollHeight > descendants[sc].clientHeight + 20 && descendants[sc].clientHeight > 100) {
                    scrollBox = descendants[sc];
                    break;
                }
            }
        }
        if (scrollBox.scrollHeight <= scrollBox.clientHeight) {
            return -1;
        }

        var originalScrollTop = scrollBox.scrollTop;
        var maxSteps = 25;
        var stepCount = 0;
        var stepSize = Math.max(250, Math.floor(scrollBox.clientHeight * 0.75));
        var maxScroll = Math.max(0, scrollBox.scrollHeight - scrollBox.clientHeight);

        if (originalScrollTop > 0) {
            scrollBox.scrollTop = 0;
        } else {
            scrollBox.scrollTop = Math.min(stepSize, maxScroll);
        }
        stepCount = 1;

        var stepSearch = function() {
            window.__waFindChatTimer = null;
            var hit = tryFindInDom();
            if (hit) {
                window.__waSelectChatElement(hit);
                if (typeof onFoundCallback === 'function') {
                    onFoundCallback(hit);
                }
                return;
            }

            var curMaxScroll = Math.max(0, scrollBox.scrollHeight - scrollBox.clientHeight);
            if (scrollBox.scrollTop >= curMaxScroll - 2 || stepCount >= maxSteps) {
                scrollBox.scrollTop = originalScrollTop;
                return;
            }

            var curStep = Math.max(250, Math.floor(scrollBox.clientHeight * 0.75));
            var nextScroll = Math.min(scrollBox.scrollTop + curStep, curMaxScroll);
            if (nextScroll <= scrollBox.scrollTop) {
                scrollBox.scrollTop = originalScrollTop;
                return;
            }

            scrollBox.scrollTop = nextScroll;
            stepCount++;
            window.__waFindChatTimer = setTimeout(stepSearch, 60);
        };

        window.__waFindChatTimer = setTimeout(stepSearch, 60);
        return 0;
    };

    // 8. Escuchadores directos de teclado y rueda dentro de la ventana web
    if (!window.__waAltListenersAttached) {
        window.__waAltListenersAttached = true;
        window.__waAltKeyDown = false;
        window.__waLastWheelNavTime = 0;

        function handleWheel(e) {
            var isAltGr = (e.getModifierState && e.getModifierState('AltGraph')) || (e.altKey && e.ctrlKey);
            if (isAltGr && window.__waAltKeyDown) {
                window.__waAltKeyDown = false;
                if (window.__waHideAltBadges) {
                    window.__waHideAltBadges();
                }
            }
            var isAlt = !isAltGr && (e.altKey || window.__waAltKeyDown);
            if (isAlt) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                var now = Date.now();
                if (now - window.__waLastWheelNavTime < 100) {
                    return;
                }

                var delta = e.deltaY;
                if (delta === 0 && e.deltaX !== 0) {
                    delta = e.deltaX;
                }

                if (delta < 0) {
                    window.__waLastWheelNavTime = now;
                    window.__waNavigateChat(-1);
                } else if (delta > 0) {
                    window.__waLastWheelNavTime = now;
                    window.__waNavigateChat(1);
                }
            }
        }
        window.__waHandleWheel = handleWheel;

        window.__waEnsurePaneListeners = function() {
            var pane = document.getElementById('pane-side');
            if (!pane) return;
            if (!pane.__waWheelAttached) {
                pane.__waWheelAttached = true;
                pane.addEventListener('wheel', window.__waHandleWheel, { passive: false, capture: true });
            }
            if (!pane.__waScrollBadgeAttached) {
                pane.__waScrollBadgeAttached = true;
                var badgeRaf = false;
                pane.addEventListener('scroll', function() {
                    if (!window.__waAltKeyDown || badgeRaf) return;
                    badgeRaf = true;
                    window.requestAnimationFrame(function() {
                        badgeRaf = false;
                        if (window.__waAltKeyDown && window.__waShowAltBadges) {
                            window.__waShowAltBadges();
                        }
                    });
                }, { passive: true });
            }
            if (!pane.__waBadgeObserver && window.MutationObserver) {
                var isBadgeNode = function(node) {
                    return node && node.nodeType === 1 && node.classList && node.classList.contains('wa-alt-badge');
                };
                var isOnlyBadgeMutation = function(m) {
                    if (m.type === 'attributes') {
                        return isBadgeNode(m.target);
                    }
                    if (m.type === 'characterData') {
                        return isBadgeNode(m.target && m.target.parentNode);
                    }
                    if (m.type === 'childList') {
                        if (isBadgeNode(m.target)) {
                            return true;
                        }
                        for (var a = 0; a < m.addedNodes.length; a++) {
                            if (!isBadgeNode(m.addedNodes[a])) {
                                return false;
                            }
                        }
                        for (var r = 0; r < m.removedNodes.length; r++) {
                            if (!isBadgeNode(m.removedNodes[r])) {
                                return false;
                            }
                        }
                        return true;
                    }
                    return false;
                };
                pane.__waBadgeObserver = new MutationObserver(function(mutations) {
                    if (!window.__waAltKeyDown) return;
                    var hasRelevant = false;
                    for (var i = 0; i < mutations.length; i++) {
                        if (!isOnlyBadgeMutation(mutations[i])) {
                            hasRelevant = true;
                            break;
                        }
                    }
                    if (!hasRelevant || pane.__waBadgeMutRaf) return;
                    pane.__waBadgeMutRaf = true;
                    window.requestAnimationFrame(function() {
                        pane.__waBadgeMutRaf = false;
                        if (window.__waAltKeyDown && window.__waShowAltBadges) {
                            window.__waShowAltBadges();
                        }
                    });
                });
                pane.__waBadgeObserver.observe(pane, {
                    childList: true,
                    subtree: true,
                    attributes: true
                });
            }
        };

        window.addEventListener('keydown', function(e) {
            var isAltGrEvent = e.key === 'AltGraph' ||
                               e.key === 'ISO_Level3_Shift' ||
                               e.code === 'AltRight' ||
                               e.location === 2 ||
                               (e.getModifierState && e.getModifierState('AltGraph'));
            if (isAltGrEvent) {
                if (window.__waAltKeyDown) {
                    window.__waAltKeyDown = false;
                    window.__waHideAltBadges();
                }
                return;
            }
            if (e.key === 'Alt' &&
                e.code !== 'AltRight' &&
                e.location !== 2 &&
                !(e.getModifierState && e.getModifierState('AltGraph'))) {
                // Solo se marca el estado: C++ (eventFilter) es el unico que muestra los badges,
                // evitando una segunda reconstruccion por la misma pulsacion.
                window.__waAltKeyDown = true;
            }
        }, true);

        window.addEventListener('keyup', function(e) {
            if (e.key === 'Alt' || e.key === 'AltGraph' || e.code === 'AltRight') {
                window.__waAltKeyDown = false;
                window.__waHideAltBadges();
            }
        }, true);

        if (!window.__waGlobalScrollBadgeAttached) {
            window.__waGlobalScrollBadgeAttached = true;
            var globalBadgeScrollRaf = false;
            window.addEventListener('scroll', function() {
                if (!window.__waAltKeyDown || globalBadgeScrollRaf) return;
                globalBadgeScrollRaf = true;
                window.requestAnimationFrame(function() {
                    globalBadgeScrollRaf = false;
                    if (window.__waAltKeyDown && window.__waShowAltBadges) {
                        window.__waShowAltBadges();
                    }
                });
            }, { passive: true, capture: true });
        }

        window.addEventListener('wheel', handleWheel, { passive: false, capture: true });
        document.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    }
    if (window.__waEnsurePaneListeners) {
        window.__waEnsurePaneListeners();
    }
})();
)JS");
}

void WhatsAppClient::initChatHelpers() {
    if (m_browser && m_browser->page()) {
        m_browser->page()->runJavaScript(getInitChatHelpersJs());
    }
}

void WhatsAppClient::switchToChatByIndex(int index) {
    if (m_lockOverlay && m_lockOverlay->isLocked()) {
        return;
    }

    m_currentChatIndex = index;

    runChatJs(QStringLiteral(R"JS(
        var validChats = window.__waGetValidChats();
        if (validChats.length > %1) {
            var target = validChats[%1];
            window.__waCurrentChatIndex = %1;
            window.__waHasRepliedInCurrentChat = false;
            window.__waMarkingSeenActive = false;
            if (window.__waCancelTemporarySeen) {
                window.__waCancelTemporarySeen();
            }
            window.__waSelectChatElement(target);
            if (window.__waAltKeyDown) {
                window.__waShowAltBadges();
            }
        }
        return %1;
    )JS").arg(index));
}

// Ejecuta un cuerpo JS que depende de los helpers de chat sin re-inyectar el bloque completo
// de getInitChatHelpersJs() en cada atajo. Si los helpers aun no existen (p. ej. tras recargar),
// se inyectan una sola vez y se reintenta.
void WhatsAppClient::runChatJs(const QString &body, std::function<void(const QVariant &)> callback, bool retried) {
    if (!m_browser || !m_browser->page()) {
        return;
    }
    const QString wrapped = QStringLiteral("(function(){ if (!window.__waGetValidChats || !window.__waSelectChatElement || !window.__waNavigateChat || !window.__waShowAltBadges || !window.__waFindAndOpenChat) { return '__wa_need_init__'; }\n")
                            + body + QStringLiteral("\n})();");
    m_browser->page()->runJavaScript(wrapped, [this, body, callback, retried](const QVariant &result) {
        if (result.toString() == QLatin1String("__wa_need_init__")) {
            if (!retried && m_browser && m_browser->page()) {
                m_browser->page()->runJavaScript(getInitChatHelpersJs());
                runChatJs(body, callback, true);
            }
            return;
        }
        if (callback) {
            callback(result);
        }
    });
}

void WhatsAppClient::navigateChatByOffset(int offset) {
    if (m_lockOverlay && m_lockOverlay->isLocked()) {
        return;
    }
    if (m_quickPrivacyMode) {
        return;
    }

    runChatJs(QStringLiteral("window.__waAltKeyDown = true; return window.__waNavigateChat(%1);").arg(offset),
              [this](const QVariant &result) {
        bool ok = false;
        int idx = result.toInt(&ok);
        if (ok && idx >= 0) {
            m_currentChatIndex = idx;
        }
    });
}

void WhatsAppClient::showChatBadges() {
    if (isPrivacyActive()) {
        return;
    }

    runChatJs(QStringLiteral("window.__waAltKeyDown = true; window.__waShowAltBadges(); return 0;"));
}

void WhatsAppClient::hideChatBadges() {
    QString js = R"JS(
    window.__waAltKeyDown = false;
    if (window.__waHideAltBadges) {
        window.__waHideAltBadges();
    } else {
        document.querySelectorAll('.wa-alt-badge').forEach(function(el) { el.remove(); });
    }
    )JS";

    if (m_browser && m_browser->page()) {
        m_browser->page()->runJavaScript(js);
    }
}

void WhatsAppClient::onPageLoaded(bool ok) {
    if (!ok) {
        return;
    }
    if (!isPureLeftAltModifier(QApplication::keyboardModifiers())) {
        m_altKeyDown = false;
        m_wheelAccumulatedDelta = 0;
    }
    if (m_browser) {
        m_browser->installEventFilter(this);
        if (m_browser->focusProxy()) {
            m_browser->focusProxy()->installEventFilter(this);
        }
        for (QObject *child : m_browser->children()) {
            if (child->isWidgetType()) {
                child->installEventFilter(this);
            }
        }
    }
    if (isPrivacyActive()) {
        applyNativeBlur(m_lockOverlay && m_lockOverlay->isLocked() ? 24 : 18);
    }
    if (m_browser && m_browser->page()) {
        m_browser->page()->runJavaScript(getReadReceiptBlockerJs());
        m_browser->page()->runJavaScript(getSidebarEnhancementsJs());
    }
    QTimer::singleShot(1500, this, [this]() {
        if (m_browser && m_browser->page()) {
            m_browser->page()->runJavaScript(getSidebarEnhancementsJs());
        }
    });
    QTimer::singleShot(2500, this, &WhatsAppClient::initChatHelpers);
    QTimer::singleShot(4000, this, &WhatsAppClient::scrapeRecentChats);
}

void WhatsAppClient::scrapeRecentChats() {
    initChatHelpers();
    QString js = R"JS(
    (function() {
        var chats = [];
        var validChats = (window.__waGetValidChats) ? window.__waGetValidChats() : [];
        if (!validChats.length) {
            var pane = document.getElementById('pane-side');
            if (!pane) return JSON.stringify(chats);
            validChats = pane.querySelectorAll('[role="row"], [role="listitem"]');
        }
        
        var count = Math.min(validChats.length, 10);
        for (var i = 0; i < count; i++) {
            var row = validChats[i];
            var titleEl = row.querySelector('span[title]') || row.querySelector('span[dir="auto"]');
            var lastMsgEl = row.querySelector('span[data-testid="last-msg-status"]') ||
                            row.querySelector('span.matched-text') ||
                            row.querySelector('div[data-testid="cell-frame-secondary"] span span') ||
                            row.querySelector('[role="gridcell"]:last-child span');
            if (titleEl) {
                var nameText = titleEl.getAttribute('title') || titleEl.textContent || '';
                if (nameText.trim()) {
                    chats.push({
                        name: nameText.trim(),
                        lastMsg: lastMsgEl ? lastMsgEl.textContent.substring(0, 50).trim() : ''
                    });
                }
            }
        }
        return JSON.stringify(chats);
    })();
    )JS";

    if (m_browser && m_browser->page()) {
        m_browser->page()->runJavaScript(js, [this](const QVariant &result) {
            onChatsScraped(result.toString());
        });
    }
}

void WhatsAppClient::onChatsScraped(const QString &result) {
    if (result.isEmpty()) return;
    QJsonDocument doc = QJsonDocument::fromJson(result.toUtf8());
    if (doc.isArray()) {
        QJsonArray arr = doc.array();
        m_recentChats.clear();
        for (const QJsonValue &val : arr) {
            if (val.isObject()) {
                QJsonObject obj = val.toObject();
                RecentChat chat;
                chat.name = obj.value("name").toString();
                chat.lastMsg = obj.value("lastMsg").toString();
                m_recentChats.append(chat);
            }
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

void WhatsAppClient::setupZoom() {
    QAction *zoomInAction = new QAction(this);
    zoomInAction->setShortcuts({QKeySequence("Ctrl++"), QKeySequence("Ctrl+=")});
    connect(zoomInAction, &QAction::triggered, this, &WhatsAppClient::zoomIn);
    addAction(zoomInAction);

    QAction *zoomOutAction = new QAction(this);
    zoomOutAction->setShortcut(QKeySequence("Ctrl+-"));
    connect(zoomOutAction, &QAction::triggered, this, &WhatsAppClient::zoomOut);
    addAction(zoomOutAction);

    QAction *zoomResetAction = new QAction(this);
    zoomResetAction->setShortcut(QKeySequence("Ctrl+0"));
    connect(zoomResetAction, &QAction::triggered, this, &WhatsAppClient::zoomReset);
    addAction(zoomResetAction);
}

void WhatsAppClient::zoomIn() {
    if (m_browser) {
        qreal currentZoom = m_browser->zoomFactor();
        m_browser->setZoomFactor(currentZoom + 0.1);
    }
}

void WhatsAppClient::zoomOut() {
    if (m_browser) {
        qreal currentZoom = m_browser->zoomFactor();
        m_browser->setZoomFactor(qMax(0.2, currentZoom - 0.1));
    }
}

void WhatsAppClient::zoomReset() {
    if (m_browser) {
        m_browser->setZoomFactor(1.0);
    }
}

void WhatsAppClient::handleWhatsAppUrl(const QString &url) {
    if (url.contains("chat") && url.contains("code=")) {
        QString afterCode = url.section("code=", 1, 1);
        QString code = afterCode.section('&', 0, 0);
        QString webUrl = QString("https://web.whatsapp.com/accept?code=%1").arg(code);
        if (m_browser && m_browser->page()) {
            m_browser->page()->runJavaScript(QString("window.location.href = '%1';").arg(webUrl));
        }
    } else if (url.contains("send") && url.contains("?")) {
        QString query = url.section('?', 1);
        QString webUrl = QString("https://web.whatsapp.com/send?%1").arg(query);
        if (m_browser && m_browser->page()) {
            m_browser->page()->runJavaScript(QString("window.location.href = '%1';").arg(webUrl));
        }
    }
}

void WhatsAppClient::openChat(const QString &chatName) {
    show();
    activateWindow();

    QJsonArray arr;
    arr.append(chatName);
    QString jsonChat = QString::fromUtf8(QJsonDocument(arr).toJson(QJsonDocument::Compact));
    jsonChat = jsonChat.mid(1, jsonChat.length() - 2);

    QString js = QString(R"JS(
        var targetName = %1;
        if (window.__waCancelTemporarySeen) {
            window.__waCancelTemporarySeen();
        }
        return window.__waFindAndOpenChat(targetName, function() {
            if (window.__waScheduleReadOnlyChatCheck) {
                window.__waScheduleReadOnlyChatCheck();
            }
        });
    )JS").arg(jsonChat);

    runChatJs(js);
}

void WhatsAppClient::sendWhatsAppMessage(const QString &chatName, const QString &text) {
    QJsonArray arrChat;
    arrChat.append(chatName);
    QString jsonChat = QString::fromUtf8(QJsonDocument(arrChat).toJson(QJsonDocument::Compact));
    jsonChat = jsonChat.mid(1, jsonChat.length() - 2);

    QJsonArray arrText;
    arrText.append(text);
    QString jsonText = QString::fromUtf8(QJsonDocument(arrText).toJson(QJsonDocument::Compact));
    jsonText = jsonText.mid(1, jsonText.length() - 2);

    QString js = QString(R"JS(
        var targetChat = %1;
        var msgText = %2;
        return window.__waFindAndOpenChat(targetChat, function() {
            var isVisible = function(el) {
                if (!el || !el.isConnected) return false;
                try {
                    var style = window.getComputedStyle(el);
                    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
                } catch (e) {}
                if (window.innerWidth > 0 && window.innerHeight > 0 && el.getBoundingClientRect) {
                    var rect = el.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                }
                return true;
            };

            var findComposer = function() {
                var selectors = [
                    '#main footer div[contenteditable="true"]',
                    '#main div[contenteditable="true"][data-tab="10"]',
                    '#main div[contenteditable="true"][role="textbox"]'
                ];
                for (var i = 0; i < selectors.length; i++) {
                    var matches = document.querySelectorAll(selectors[i]);
                    for (var j = 0; j < matches.length; j++) {
                        if (isVisible(matches[j])) {
                            return matches[j];
                        }
                    }
                }
                return null;
            };

            var findSendButton = function() {
                var roots = [];
                var footer = document.querySelector('#main footer');
                if (footer) roots.push(footer);
                roots.push(document);
                var selectors = [
                    'span[data-icon="wds-ic-send-filled"]',
                    'span[data-icon="send"]',
                    'span[data-testid="send"]',
                    'button[data-testid="compose-btn-send"]',
                    'button[data-tab="11"]',
                    'button[aria-label="Enviar"]',
                    'button[aria-label="Send"]'
                ];
                for (var r = 0; r < roots.length; r++) {
                    for (var s = 0; s < selectors.length; s++) {
                        var matches = roots[r].querySelectorAll(selectors[s]);
                        for (var j = 0; j < matches.length; j++) {
                            var btn = matches[j].closest('button, [role="button"]') || matches[j];
                            if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true' && isVisible(btn)) {
                                return btn;
                            }
                        }
                    }
                }
                return null;
            };

            var triggerSeen = function() {
                if (window.__waTriggerTemporarySeen) {
                    window.__waTriggerTemporarySeen();
                } else if (window.__waTriggerSeen) {
                    setTimeout(window.__waTriggerSeen, 200);
                    setTimeout(window.__waTriggerSeen, 600);
                } else {
                    window.__waMarkingSeenActive = false;
                }
            };

            var composerAttempts = 0;
            var maxComposerAttempts = 25;
            var pollComposer = function() {
                composerAttempts++;
                var composer = findComposer();
                if (!composer) {
                    if (composerAttempts < maxComposerAttempts) {
                        setTimeout(pollComposer, 100);
                    }
                    return;
                }

                window.__waMarkingSeenActive = true;
                composer.focus();
                try {
                    var range = document.createRange();
                    range.selectNodeContents(composer);
                    range.collapse(false);
                    var sel = window.getSelection();
                    if (sel) {
                        sel.removeAllRanges();
                        sel.addRange(range);
                    }
                } catch (e) {}

                document.execCommand('insertText', false, msgText);
                try {
                    composer.dispatchEvent(new InputEvent('input', {
                        bubbles: true,
                        inputType: 'insertText',
                        data: msgText
                    }));
                } catch (e) {}

                var sendAttempts = 0;
                var maxSendAttempts = 10;
                var pollSend = function() {
                    sendAttempts++;
                    var btn = findSendButton();
                    if (btn) {
                        btn.click();
                        triggerSeen();
                        return;
                    }
                    if (sendAttempts < maxSendAttempts) {
                        setTimeout(pollSend, 80);
                        return;
                    }
                    var remainingText = (composer.innerText || composer.textContent || '').replace(/[\u200B\uFEFF]/g, '').trim();
                    if (remainingText.length > 0) {
                        composer.dispatchEvent(new KeyboardEvent('keydown', {
                            key: 'Enter',
                            code: 'Enter',
                            keyCode: 13,
                            which: 13,
                            bubbles: true,
                            cancelable: true
                        }));
                        triggerSeen();
                    } else {
                        window.__waMarkingSeenActive = false;
                    }
                };
                setTimeout(pollSend, 80);
            };

            setTimeout(pollComposer, 100);
        });
    )JS").arg(jsonChat, jsonText);

    runChatJs(js);
}

QString WhatsAppClient::getReadReceiptBlockerJs() const {
    return QString::fromUtf8(R"JS(
(function() {
    'use strict';
    if (window.__waReadReceiptControllerInitialized) return;
    window.__waReadReceiptControllerInitialized = true;

    // Estado local: ventana activa momentanea de marcado de lectura
    window.__waMarkingSeenActive = false;
    window.__waHasRepliedInCurrentChat = false;

    var seenResetTimer = null;
    var readOnlyCheckTimer1 = null;
    var readOnlyCheckTimer2 = null;
    var lastContextRow = null;
    var lastContextRowTime = 0;

    var clearReadOnlyCheckTimers = function() {
        if (readOnlyCheckTimer1) {
            clearTimeout(readOnlyCheckTimer1);
            readOnlyCheckTimer1 = null;
        }
        if (readOnlyCheckTimer2) {
            clearTimeout(readOnlyCheckTimer2);
            readOnlyCheckTimer2 = null;
        }
    };

    // Interceptar hasFocus: WhatsApp Web solo envia confirmaciones de lectura (doble check azul)
    // cuando el documento reporta foco activo. Al devolver false de forma predeterminada,
    // se mantiene la lectura de mensajes en modo incognito (doble check gris para el remitente).
    var customHasFocus = function() {
        return !!window.__waMarkingSeenActive;
    };

    try {
        Document.prototype.hasFocus = customHasFocus;
    } catch (e) {}
    document.hasFocus = customHasFocus;

    var dispatchFocusEvents = function() {
        try {
            window.dispatchEvent(new FocusEvent('focus'));
            window.dispatchEvent(new Event('focus'));
            document.dispatchEvent(new Event('visibilitychange'));
        } catch (e) {}
    };

    // Cancelar cualquier ventana activa de marcado de lectura y volver a modo incognito
    window.__waCancelTemporarySeen = function() {
        if (seenResetTimer) {
            clearTimeout(seenResetTimer);
            seenResetTimer = null;
        }
        clearReadOnlyCheckTimers();
        window.__waMarkingSeenActive = false;
        window.__waHasRepliedInCurrentChat = false;
        try {
            window.dispatchEvent(new FocusEvent('blur'));
            window.dispatchEvent(new Event('blur'));
        } catch (e) {}
    };

    // Funcion central para forzar la emision de read receipts en WhatsApp Web sobre el chat activo
    window.__waTriggerSeenCore = function(skipRowReselect) {
        // 1. Notificar eventos de foco a nivel de ventana y documento
        dispatchFocusEvents();

        if (skipRowReselect) {
            return;
        }

        // 2. Re-despachar seleccion sobre el chat activo en la lista lateral (#pane-side)
        var activeRow = document.querySelector('#pane-side [aria-selected="true"]');
        if (!activeRow) {
            var header = document.querySelector('#main header');
            if (header) {
                var titleEl = header.querySelector('span[title]') || 
                              header.querySelector('div[data-testid="conversation-info-header"] span[title]') ||
                              header.querySelector('div[role="button"] span[dir="auto"]') ||
                              header.querySelector('span[dir="auto"]');
                var activeTitle = titleEl ? (titleEl.getAttribute('title') || titleEl.innerText || titleEl.textContent || '').trim().toLowerCase() : '';
                if (activeTitle) {
                    var allSpans = document.querySelectorAll('#pane-side span[title], #pane-side div[data-testid="cell-frame-title"] span, #pane-side span[dir="auto"]');
                    for (var i = 0; i < allSpans.length; i++) {
                        var text = (allSpans[i].getAttribute('title') || allSpans[i].innerText || allSpans[i].textContent || '').trim().toLowerCase();
                        if (text === activeTitle) {
                            activeRow = allSpans[i].closest('[role="row"], [role="listitem"]') || allSpans[i].closest('div[data-testid="cell-frame-container"]') || allSpans[i];
                            break;
                        }
                    }
                }
            }
        }

        if (activeRow) {
            if (window.__waSelectChatElement) {
                window.__waSelectChatElement(activeRow, true);
            } else {
                var clickTarget = activeRow.querySelector('div[data-testid="cell-frame-container"]') || activeRow;
                ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function(evtName) {
                    clickTarget.dispatchEvent(new MouseEvent(evtName, {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                        buttons: 1
                    }));
                });
            }
        }

        // 3. Restaurar foco en el campo de texto de #main solo si existe y no esta enfocado ya
        setTimeout(function() {
            var composer = document.querySelector('#main footer div[contenteditable="true"]') ||
                           document.querySelector('#main div[contenteditable="true"][data-tab="10"]');
            if (composer && document.activeElement !== composer) {
                composer.focus();
            }
        }, 50);
    };

    // Disparador temporal: habilita momentaneamente el marcado de los mensajes acumulados,
    // emite los eventos y se desactiva tras 1400 ms para que los mensajes que lleguen despues
    // sigan sin leerse (doble check gris) hasta que el usuario envie una nueva respuesta.
    window.__waTriggerTemporarySeen = function(skipRowReselect) {
        if (seenResetTimer) {
            clearTimeout(seenResetTimer);
            seenResetTimer = null;
        }
        clearReadOnlyCheckTimers();

        window.__waMarkingSeenActive = true;
        if (!skipRowReselect) {
            window.__waHasRepliedInCurrentChat = true;
        }

        // Emitir foco en t=0 para handlers sincronos (p. ej. "Marcar como leido" desde menu)
        dispatchFocusEvents();

        setTimeout(function() {
            if (window.__waTriggerSeenCore) window.__waTriggerSeenCore(!!skipRowReselect);
        }, 200);

        setTimeout(function() {
            if (window.__waTriggerSeenCore) window.__waTriggerSeenCore(!!skipRowReselect);
        }, 600);

        // Desactivar el estado de lectura tras una ventana de 1400 ms
        seenResetTimer = setTimeout(function() {
            window.__waMarkingSeenActive = false;
            window.__waHasRepliedInCurrentChat = false;
            seenResetTimer = null;
            try {
                window.dispatchEvent(new FocusEvent('blur'));
                window.dispatchEvent(new Event('blur'));
            } catch (e) {}
        }, 1400);
    };

    window.__waTriggerSeen = window.__waTriggerTemporarySeen;

    // Detecta estrictamente si la conversacion abierta en #main es de solo lectura (Comunidades / solo administradores / grupo cerrado)
    window.__waIsReadOnlyConversation = function() {
        var main = document.getElementById('main');
        if (!main) return false;
        var header = main.querySelector('header');
        if (!header) return false;
        var conversationBody = main.querySelector(
            '[data-testid="conversation-panel-messages"], [role="application"], [role="region"]'
        );
        if (!conversationBody) return false;

        var writableControl = main.querySelector(
            '[contenteditable="true"], [contenteditable="plaintext-only"], ' +
            '[role="textbox"], [data-tab="10"], textarea, ' +
            'footer [contenteditable], ' +
            '[data-icon="ptt"], [data-icon*="mic"], [data-testid*="ptt"], ' +
            '[data-icon="ptt-send"], [data-testid="ptt-send"], [data-testid="audio-send"], ' +
            '[data-icon="plus"], [data-icon="plus-rounded"], [data-icon="clip"], ' +
            '[data-icon="smiley"], [data-icon*="expressions"], ' +
            'button[data-testid="compose-btn-send"], [data-icon="wds-ic-send-filled"], [data-icon="send"]'
        );
        if (writableControl) return false;

        var bottomBar = main.querySelector('footer');
        if (!bottomBar) {
            var mainRect = main.getBoundingClientRect();
            if (mainRect.height > 0) {
                var children = main.children;
                for (var i = children.length - 1; i >= 0; i--) {
                    var child = children[i];
                    if (!child || child.tagName !== 'DIV' || child === header || child.contains(header)) {
                        continue;
                    }
                    var rect = child.getBoundingClientRect();
                    if (rect.width <= 0 || rect.height < 24 || rect.height > 130) {
                        continue;
                    }
                    var isAtBottom = (rect.top >= mainRect.top + mainRect.height * 0.4) &&
                        (rect.bottom >= mainRect.bottom - 32) &&
                        (rect.bottom <= mainRect.bottom + 16);
                    if (isAtBottom) {
                        bottomBar = child;
                        break;
                    }
                }
            }
        }
        if (!bottomBar) return false;

        if (bottomBar.querySelector('input, textarea, [contenteditable], [role="textbox"]')) {
            return false;
        }

        var readOnlySelector =
            '[data-testid*="read-only"], [data-testid*="only-admin"], [data-testid*="announcement"], ' +
            'span[data-icon*="announcement"], span[data-icon*="megaphone"]';
        var hasExplicitIndicator = (typeof bottomBar.matches === 'function' && bottomBar.matches(readOnlySelector)) ||
            bottomBar.querySelector(readOnlySelector) !== null;
        if (hasExplicitIndicator) {
            return true;
        }

        var bottomText = (bottomBar.innerText || bottomBar.textContent || '').trim();
        if (bottomText.length >= 10 && bottomText.length <= 260 &&
            /solo los administradores pueden enviar|only admins can send|only admins can post|apenas administradores podem enviar|no puedes enviar mensajes a este|you can't send messages to this|este grupo se cerr|this group has ended|solo quienes administran|only admins/i.test(bottomText)) {
            return true;
        }

        return false;
    };

    // Programa verificacion automatica a 450 ms y 950 ms tras abrir una conversacion
    window.__waScheduleReadOnlyChatCheck = function() {
        if (window.__waMarkingSeenActive) return;
        clearReadOnlyCheckTimers();

        readOnlyCheckTimer1 = setTimeout(function() {
            readOnlyCheckTimer1 = null;
            if (window.__waMarkingSeenActive || window.__waHasRepliedInCurrentChat) return;
            if (window.__waIsReadOnlyConversation && window.__waIsReadOnlyConversation()) {
                window.__waTriggerTemporarySeen();
            }
        }, 450);

        readOnlyCheckTimer2 = setTimeout(function() {
            readOnlyCheckTimer2 = null;
            if (window.__waMarkingSeenActive || window.__waHasRepliedInCurrentChat) return;
            if (window.__waIsReadOnlyConversation && window.__waIsReadOnlyConversation()) {
                window.__waTriggerTemporarySeen();
            }
        }, 950);
    };

    // Detecta la accion manual "Marcar como leido" / "Mark as read", excluyendo "no leido" / "unread"
    var isMarkAsReadMenuAction = function(target) {
        if (!target || !target.closest) return false;
        var item = target.closest(
            '[role="menuitem"], [role="option"], [data-animate-dropdown-item="true"], ' +
            'div[role="application"] li, div[role="application"] [role="button"], ' +
            'div[role="menu"] li, div[role="menu"] [role="button"], ' +
            'ul[role="menu"] li, ul[role="menu"] [role="button"], ' +
            'li[role="button"], li[tabindex]'
        );
        if (!item) {
            var fallback = target.closest('li, div[role="button"], button');
            if (fallback && !fallback.closest('#pane-side [role="row"], #pane-side [role="listitem"], #main')) {
                item = fallback;
            }
        }
        if (!item) return false;

        var iconEl = item.querySelector('[data-icon], [data-testid]');
        var dataIcon = ((item.getAttribute('data-icon') || '') + ' ' + (iconEl ? (iconEl.getAttribute('data-icon') || '') : '')).toLowerCase();
        var dataTestId = ((item.getAttribute('data-testid') || '') + ' ' + (iconEl ? (iconEl.getAttribute('data-testid') || '') : '')).toLowerCase();

        if (dataIcon.indexOf('unread') !== -1 || dataTestId.indexOf('unread') !== -1) {
            return false;
        }
        if (dataIcon.indexOf('mark-read') !== -1 || dataIcon.indexOf('mark_read') !== -1 ||
            dataTestId.indexOf('mark-read') !== -1 || dataTestId.indexOf('mark_read') !== -1) {
            return true;
        }

        var rawText = (item.innerText || item.textContent || item.getAttribute('aria-label') || '').trim();
        if (!rawText || rawText.length > 60) return false;

        var cleanText = (rawText.normalize ? rawText.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : rawText)
                        .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
                        .replace(/\s+/g, ' ')
                        .trim()
                        .toLowerCase();

        if (/\b(no\s+leid[oa]s?|unread|nao\s+lid[oa]s?|non\s+lu[es]?|non\s+lett[oi]|da\s+leggere|ungelesen|no\s+llegit[s]?)\b/.test(cleanText)) {
            return false;
        }

        return /^(marcar\s+(como\s+|todo\s+como\s+)?leid[oa]s?|mark\s+(all\s+)?as\s+read|marcar\s+(tudo\s+)?como\s+lid[oa]s?|marquer\s+(tout\s+)?comme\s+lu[es]?|segna\s+(tutto\s+)?come\s+(gia\s+)?lett[oi]|als\s+gelesen\s+markieren|marca\s+(tot\s+)?com\s+a\s+llegit[s]?)$/.test(cleanText);
    };

    var triggerManualMarkAsRead = function(onlyEnableFocus) {
        var skipRowReselect = false;
        if (lastContextRow && (Date.now() - lastContextRowTime) < 15000) {
            var isRowSelected = lastContextRow.getAttribute('aria-selected') === 'true' ||
                                lastContextRow.querySelector('[aria-selected="true"]') !== null;
            if (!isRowSelected) {
                skipRowReselect = true;
            }
        }
        if (onlyEnableFocus) {
            if (seenResetTimer) {
                clearTimeout(seenResetTimer);
            }
            window.__waMarkingSeenActive = true;
            dispatchFocusEvents();
            seenResetTimer = setTimeout(function() {
                window.__waMarkingSeenActive = false;
                window.__waHasRepliedInCurrentChat = false;
                seenResetTimer = null;
                try {
                    window.dispatchEvent(new FocusEvent('blur'));
                    window.dispatchEvent(new Event('blur'));
                } catch (e) {}
            }, 1400);
        } else {
            window.__waTriggerTemporarySeen(skipRowReselect);
        }
    };

    var recordPaneContextRow = function(event) {
        var target = event.target;
        if (!target || !target.closest) return;
        if (target.closest('#pane-side')) {
            var row = target.closest('[role="row"], [role="listitem"], div[data-testid="cell-frame-container"]');
            if (row) {
                lastContextRow = row;
                lastContextRowTime = Date.now();
            }
        }
    };
    document.addEventListener('contextmenu', recordPaneContextRow, true);
    document.addEventListener('pointerdown', recordPaneContextRow, true);
    document.addEventListener('mousedown', recordPaneContextRow, true);

    var handleManualReadPointerDown = function(event) {
        if (!event.isTrusted) return;
        if (isMarkAsReadMenuAction(event.target)) {
            triggerManualMarkAsRead(true);
        }
    };
    window.addEventListener('pointerdown', handleManualReadPointerDown, true);
    window.addEventListener('mousedown', handleManualReadPointerDown, true);

    // Al cambiar de chat mediante clic en #pane-side o panel de comunidades, reiniciar incognito y revisar solo lectura
    document.addEventListener('click', function(event) {
        if (!event.isTrusted) return;
        var target = event.target;
        if (!target) return;
        if (isMarkAsReadMenuAction(target)) {
            return;
        }
        if (target.closest('#pane-side')) {
            window.__waCancelTemporarySeen();
            if (window.__waScheduleReadOnlyChatCheck) {
                window.__waScheduleReadOnlyChatCheck();
            }
        } else if (target.closest('#side [role="listitem"], #side [role="row"], [data-wa-side-column="true"] [role="listitem"], [data-wa-side-column="true"] [role="row"]')) {
            if (window.__waScheduleReadOnlyChatCheck) {
                window.__waScheduleReadOnlyChatCheck();
            }
        }
    }, true);

    // Deteccion de envio por teclado (Enter en compositor/modal o sobre "Marcar como leido" en menu)
    window.addEventListener('keydown', function(event) {
        if ((event.key === 'Enter' || event.key === ' ') && isMarkAsReadMenuAction(event.target || document.activeElement)) {
            triggerManualMarkAsRead(false);
            return;
        }
        if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !event.isComposing) {
            var target = event.target;
            if (target && target.closest && target.closest('#side, #pane-side')) return;

            var popups = document.querySelectorAll(
                '#main [role="listbox"], [data-animate-modal-popup="true"] [role="listbox"], ' +
                '[data-testid*="mention-suggestion"], [data-testid*="mention-list"], ' +
                '[data-testid*="emoji-suggestion"], [data-testid*="autocomplete"], .wa-autocomplete'
            );
            for (var p = 0; p < popups.length; p++) {
                if (popups[p].offsetWidth > 0 && popups[p].offsetHeight > 0) {
                    return;
                }
            }

            var hasMediaSendBtn = function() {
                var icons = document.querySelectorAll(
                    'span[data-icon="wds-ic-send-filled"], span[data-icon*="send"], [data-testid*="send"]'
                );
                for (var i = 0; i < icons.length; i++) {
                    var ic = icons[i];
                    var btn = ic.closest('button, [role="button"]');
                    if (btn && !ic.closest('#main footer') && !ic.closest('#side') && (ic.offsetWidth > 0 || ic.offsetHeight > 0)) {
                        return true;
                    }
                }
                return false;
            };

            var editable = (target && target.closest) ? target.closest('[contenteditable="true"]') : null;
            if (!editable) {
                editable = document.querySelector('#main footer div[contenteditable="true"]') ||
                           document.querySelector('div[contenteditable="true"][data-tab="10"]');
            }
            var beforeText = editable ? (editable.innerText || editable.textContent || '').trim() : '';
            var mediaSendWasOpen = hasMediaSendBtn();

            if (beforeText.length > 0 || mediaSendWasOpen) {
                setTimeout(function() {
                    if (beforeText.length > 0 && editable && editable.isConnected) {
                        var afterText = (editable.innerText || editable.textContent || '').trim();
                        if (afterText.length === 0 || (mediaSendWasOpen && !hasMediaSendBtn())) {
                            window.__waTriggerTemporarySeen();
                        }
                    } else if (mediaSendWasOpen || (editable && !editable.isConnected)) {
                        window.__waTriggerTemporarySeen();
                    }
                }, 40);
            }
        }
    }, true);

    // Deteccion de envio por clic en el boton de enviar (audio/adjuntos/stickers/encuestas en cualquier idioma) o accion manual
    window.addEventListener('click', function(event) {
        if (!event.isTrusted) return;
        var target = event.target;
        if (!target || !target.closest) return;
        if (isMarkAsReadMenuAction(target)) {
            triggerManualMarkAsRead(false);
            return;
        }
        if (target.closest('#side, #pane-side')) return;
        var sendBtn = target.closest(
            'span[data-icon="wds-ic-send-filled"], span[data-icon*="send"], [data-icon*="send"], [data-testid*="send"], ' +
            'button[aria-label="Send"], button[aria-label="Enviar"], button[data-tab="11"], button[data-testid="compose-btn-send"], ' +
            'div[role="button"][aria-label="Send"], div[role="button"][aria-label="Enviar"], [role="button"][data-tab="11"], ' +
            '[data-icon="ptt-send"], [data-testid="ptt-send"], [data-testid="audio-send"], ' +
            '[data-testid="sticker"], [data-animate-picker="true"] [role="gridcell"], [data-testid="btn-create-poll"]'
        );
        if (!sendBtn) {
            var btnContainer = target.closest('button, [role="button"]');
            if (btnContainer) {
                sendBtn = btnContainer.querySelector(
                    'span[data-icon="wds-ic-send-filled"], span[data-icon*="send"], [data-icon*="send"], ' +
                    '[data-testid*="send"], [data-icon="ptt-send"], [data-testid="ptt-send"], [data-testid="audio-send"]'
                );
            }
        }
        var attrIcon = target.getAttribute('data-icon') || '';
        var attrTestId = target.getAttribute('data-testid') || '';
        if (sendBtn || attrIcon.indexOf('send') !== -1 || attrTestId.indexOf('send') !== -1) {
            window.__waTriggerTemporarySeen();
        }
    }, true);
})();
)JS");
}

void WhatsAppClient::setupReadReceiptScript() {
    if (!m_profile) return;

    QWebEngineScript script;
    script.setName(QStringLiteral("WAWebReadReceiptController"));
    script.setSourceCode(getReadReceiptBlockerJs());
    script.setInjectionPoint(QWebEngineScript::DocumentCreation);
    script.setWorldId(QWebEngineScript::MainWorld);
    script.setRunsOnSubFrames(false);

    m_profile->scripts()->insert(script);
}

void WhatsAppClient::toggleSidebarCompact() {
    if (m_browser && m_browser->page()) {
        m_browser->page()->runJavaScript(QStringLiteral("if (window.__waToggleSidebarCompact) { window.__waToggleSidebarCompact(); }"));
    }
}

QString WhatsAppClient::getSidebarEnhancementsJs() const {
    return QString::fromUtf8(R"JS(
(function() {
    'use strict';
    if (window.__waSidebarEnhancementsInitialized) return;
    window.__waSidebarEnhancementsInitialized = true;

    var STORAGE_KEY_WIDTH = 'wa_sidebar_width';
    var STORAGE_KEY_COMPACT = 'wa_sidebar_compact';
    var STORAGE_KEY_RIGHT_WIDTH = 'wa_right_panel_width';
    var MIN_WIDTH = 280;
    var DEFAULT_WIDTH = 360;
    var MIN_RIGHT_WIDTH = 220;
    var DEFAULT_RIGHT_WIDTH = 340;

    var isDragging = false;
    var currentSidebarWidth = getSavedWidth();
    var resizerElement = null;
    var rafPending = false;
    var targetClientX = 0;

    var isRightDragging = false;
    var rightResizerElement = null;
    var rightRafPending = false;
    var rightTargetClientX = 0;

    var cachedSideColumn = null;
    var cachedMainColumn = null;
    var cachedFlexContainer = null;

    var SVG_COLLAPSE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">' +
                       '<path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>' +
                       '</svg>';

    var SVG_EXPAND = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">' +
                     '<path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>' +
                     '</svg>';

    function injectStyles() {
        var existing = document.getElementById('wa-sidebar-enhancements-style');
        if (existing) {
            existing.remove();
        }
        var style = document.createElement('style');
        style.id = 'wa-sidebar-enhancements-style';
        style.textContent = `
            :root {
                --wa-sidebar-width: 360px;
                --wa-right-panel-width: 340px;
                --wa-resizer-hitbox-width: 8px;
                --wa-resizer-line-width: 2px;
                --wa-resizer-color-hover: #00a884;
                --wa-resizer-color-default: rgba(134, 150, 160, 0.25);
            }

            body.wa-sidebar-compact {
                --wa-sidebar-width: 70px !important;
            }

            /* Reseteo full-viewport y supresion de linea blanca superior */
            html,
            body {
                margin: 0 !important;
                padding: 0 !important;
                overflow: hidden !important;
                background-color: var(--background-default, #111b21) !important;
                border: none !important;
            }

            div.app-wrapper-web,
            .app-wrapper-web {
                top: 0 !important;
                left: 0 !important;
                width: 100vw !important;
                height: 100vh !important;
                max-width: 100vw !important;
                max-height: 100vh !important;
                margin: 0 !important;
                padding: 0 !important;
                border: none !important;
                border-radius: 0 !important;
                box-shadow: none !important;
                transform: none !important;
            }

            body::before,
            body::after,
            #app::before,
            #app::after,
            .app-wrapper-web::before,
            .app-wrapper-web::after {
                display: none !important;
                content: none !important;
                height: 0 !important;
                border: none !important;
            }

            .two,
            .three,
            #main,
            #main header,
            #side,
            #side header,
            [data-wa-main-column="true"],
            [data-wa-side-column="true"] {
                border-top: none !important;
                border-top-width: 0 !important;
                box-shadow: none !important;
            }

            #main header::before,
            #main header::after {
                border-top: none !important;
                box-shadow: none !important;
            }

            /* 1. Columna Lateral (#side) y su wrapper */
            #side,
            [data-wa-side-column="true"],
            .two > div:has(> #side),
            .three > div:has(> #side),
            .two > div:has(#side),
            .three > div:has(#side) {
                width: var(--wa-sidebar-width) !important;
                min-width: var(--wa-sidebar-width) !important;
                max-width: var(--wa-sidebar-width) !important;
                flex: 0 0 var(--wa-sidebar-width) !important;
                flex-basis: var(--wa-sidebar-width) !important;
                flex-grow: 0 !important;
                flex-shrink: 0 !important;
                box-sizing: border-box !important;
                position: relative !important;
            }

            [data-wa-side-column="true"] #side,
            [data-wa-side-column="true"] > div,
            .two > div:has(#side) #side,
            .two > div:has(#side) > div,
            .three > div:has(#side) #side,
            .three > div:has(#side) > div {
                width: 100% !important;
                min-width: 100% !important;
                max-width: 100% !important;
                flex: 1 1 auto !important;
            }

            /* 2. Columna de Conversacion (#main): SOLO el contenedor inmediato adyacente */
            #main,
            [data-wa-main-column="true"],
            [data-wa-side-column="true"] + div,
            .two > div:has(> #main),
            .three > div:has(> #main),
            .two > div:has(#main),
            .three > div:has(#main),
            .two > div:has(#side) + div,
            .three > div:has(#side) + div {
                flex: 1 1 0% !important;
                flex-grow: 1 !important;
                flex-shrink: 1 !important;
                min-width: 0 !important;
                width: auto !important;
                max-width: none !important;
                box-sizing: border-box !important;
            }

            [data-wa-main-column="true"] > #main,
            .two > div:has(#main) > #main,
            .three > div:has(#main) > #main {
                width: 100% !important;
                height: 100% !important;
                min-width: 0 !important;
                flex: 1 1 auto !important;
            }

            #main > div,
            #main [data-testid="conversation-panel-wrapper"],
            #main [role="region"],
            #main div[tabindex="-1"] {
                max-width: 100% !important;
                width: 100% !important;
                box-sizing: border-box !important;
            }

            /* 3. Neutralizacion de paneles auxiliares cerrados (.two, .three y contenedor flex),
                  uniformizacion de drawers izquierdos y configuracion de columna derecha */
            .two > div:not([data-wa-side-column="true"]):not([data-wa-main-column="true"]):not(:has(#side)):not(:has(#main)):empty,
            .three > div:not([data-wa-side-column="true"]):not([data-wa-main-column="true"]):not(:has(#side)):not(:has(#main)):empty,
            [data-wa-flex-container="true"] > *:not([data-wa-side-column="true"]):not([data-wa-main-column="true"]):not(:has(#side)):not(:has(#main)):empty {
                width: 0 !important;
                min-width: 0 !important;
                max-width: 0 !important;
                flex: 0 0 0px !important;
                border: none !important;
                display: none !important;
            }

            [data-wa-left-drawer="true"] {
                width: var(--wa-sidebar-width) !important;
                min-width: var(--wa-sidebar-width) !important;
                max-width: var(--wa-sidebar-width) !important;
                flex: 0 0 var(--wa-sidebar-width) !important;
                flex-basis: var(--wa-sidebar-width) !important;
                overflow: hidden !important;
                box-sizing: border-box !important;
                background-color: var(--panel-background-deep, var(--background-default, #111b21)) !important;
                border-right: 1px solid rgba(134, 150, 160, 0.22) !important;
            }

            [data-wa-left-drawer="true"] > div,
            [data-wa-left-drawer="true"] > span:has([data-animate-drawer-left="true"]),
            [data-wa-left-drawer="true"] [data-animate-drawer-left="true"],
            [data-wa-left-drawer="true"] [data-animate-drawer-left="true"] > div,
            #side [data-animate-drawer-left="true"],
            #side [data-animate-drawer-left="true"] > div,
            [data-wa-side-column="true"] [data-animate-drawer-left="true"],
            [data-wa-side-column="true"] [data-animate-drawer-left="true"] > div,
            [data-wa-side-column="true"] > span:has([data-animate-drawer-left="true"]),
            [data-wa-side-column="true"] div:has(> [data-animate-drawer-left="true"]),
            .two > div:has(#side) [data-animate-drawer-left="true"],
            .three > div:has(#side) [data-animate-drawer-left="true"] {
                width: 100% !important;
                min-width: 100% !important;
                max-width: 100% !important;
                box-sizing: border-box !important;
                overflow-x: hidden !important;
            }

            [data-wa-left-drawer="true"] [data-animate-drawer-left="true"],
            #side [data-animate-drawer-left="true"],
            [data-wa-side-column="true"] [data-animate-drawer-left="true"] {
                overflow: hidden !important;
                background-color: var(--panel-background-deep, var(--background-default, #111b21)) !important;
            }

            [data-wa-right-column="true"] {
                width: var(--wa-right-panel-width) !important;
                min-width: var(--wa-right-panel-width) !important;
                max-width: var(--wa-right-panel-width) !important;
                flex: 0 0 var(--wa-right-panel-width) !important;
                flex-basis: var(--wa-right-panel-width) !important;
                border-left: 1px solid rgba(134, 150, 160, 0.22) !important;
                box-sizing: border-box !important;
                overflow-x: hidden !important;
                position: relative !important;
            }

            [data-wa-right-column="true"] > div,
            [data-wa-right-column="true"] > span:has([data-animate-drawer-right="true"]),
            [data-wa-right-column="true"] [data-animate-drawer-right="true"],
            [data-wa-right-column="true"] [data-animate-drawer-right="true"] > div,
            [data-wa-right-column="true"] header,
            [data-wa-right-column="true"] section {
                width: 100% !important;
                min-width: 0 !important;
                max-width: 100% !important;
                box-sizing: border-box !important;
                overflow-x: hidden !important;
            }

            /* 4. Divisores / Splitters (lateral izquierdo y panel derecho) */
            body:not(.wa-sidebar-compact) [data-wa-side-column="true"] {
                border-right: 1px solid rgba(134, 150, 160, 0.22) !important;
            }

            #wa-custom-resizer,
            #wa-custom-right-resizer {
                position: fixed !important;
                top: 0 !important;
                bottom: 0 !important;
                width: var(--wa-resizer-hitbox-width) !important;
                margin-left: calc(var(--wa-resizer-hitbox-width) / -2) !important;
                cursor: col-resize !important;
                z-index: 1000 !important;
                background-color: transparent !important;
                user-select: none !important;
                -webkit-user-select: none !important;
                touch-action: none !important;
                display: none;
            }

            #wa-custom-resizer.is-resizing,
            #wa-custom-right-resizer.is-resizing {
                z-index: 99999 !important;
            }

            #wa-custom-resizer::after,
            #wa-custom-right-resizer::after {
                content: '' !important;
                position: absolute !important;
                top: 0 !important;
                bottom: 0 !important;
                left: calc(50% - (var(--wa-resizer-line-width) / 2)) !important;
                width: var(--wa-resizer-line-width) !important;
                background-color: transparent !important;
                transition: background-color 0.15s ease-in-out !important;
                pointer-events: none !important;
            }

            #wa-custom-resizer:hover::after,
            #wa-custom-resizer.is-resizing::after,
            #wa-custom-right-resizer:hover::after,
            #wa-custom-right-resizer.is-resizing::after {
                background-color: var(--wa-resizer-color-hover) !important;
            }

            html.wa-resizing-active,
            html.wa-resizing-active * {
                cursor: col-resize !important;
                user-select: none !important;
                -webkit-user-select: none !important;
                transition: none !important;
            }

            [data-animate-picker="true"],
            [data-animate-modal-popup="true"],
            [data-animate-dropdown-item="true"],
            [role="dialog"],
            [role="menu"],
            [role="alert"],
            [role="status"],
            [data-testid*="toast"],
            [data-animate-toast] {
                z-index: 2000 !important;
            }

            /* 5. Reglas del Modo Compacto (limitadas al subarbol de #side para no aplastar
               toasts/drawers que WhatsApp monta como hermanos de #side dentro de la columna) */
            body.wa-sidebar-compact #side,
            body.wa-sidebar-compact [data-wa-side-column="true"],
            body.wa-sidebar-compact .two > div:has(#side),
            body.wa-sidebar-compact .three > div:has(#side) {
                width: 70px !important;
                min-width: 70px !important;
                max-width: 70px !important;
                flex: 0 0 70px !important;
                flex-basis: 70px !important;
                overflow: hidden !important;
                overflow-x: hidden !important;
                border-right: none !important;
                border-right-width: 0 !important;
                box-shadow: none !important;
            }

            /* La columna lateral no recorta: los toasts pueden sobresalir sobre #main */
            body.wa-sidebar-compact [data-wa-side-column="true"],
            body.wa-sidebar-compact .two > div:has(#side),
            body.wa-sidebar-compact .three > div:has(#side) {
                overflow: visible !important;
                overflow-x: visible !important;
            }

            /* Toasts / snackbars de WhatsApp: ancho natural independiente de la barra */
            body.wa-sidebar-compact #app [data-wa-side-column="true"] [role="alert"],
            body.wa-sidebar-compact #app [data-wa-side-column="true"] [role="status"],
            body.wa-sidebar-compact #app [data-wa-side-column="true"] [data-testid*="toast"],
            body.wa-sidebar-compact #app [data-wa-side-column="true"] [data-animate-toast],
            body.wa-sidebar-compact #app [data-wa-side-column="true"] [role="alert"] div,
            body.wa-sidebar-compact #app [data-wa-side-column="true"] [role="status"] div,
            body.wa-sidebar-compact #app [data-wa-side-column="true"] [data-testid*="toast"] div {
                width: auto !important;
                min-width: max-content !important;
                max-width: 90vw !important;
                flex: 0 0 auto !important;
                overflow: visible !important;
                white-space: nowrap !important;
            }
            body.wa-sidebar-compact #app [data-wa-side-column="true"] [role="alert"],
            body.wa-sidebar-compact #app [data-wa-side-column="true"] [role="status"],
            body.wa-sidebar-compact #app [data-wa-side-column="true"] [data-testid*="toast"],
            body.wa-sidebar-compact #app [data-wa-side-column="true"] [data-animate-toast] {
                z-index: 99999 !important;
            }

            /* Linea vertical residual: capas hermanas (drawers/overlays cerrados o sin contenido real)
               del contenedor flex, incluso cuando .three esta presente. */
            [data-wa-flex-container="true"] > *:not([data-wa-main-column="true"]):not([data-wa-side-column="true"]):not([data-wa-left-drawer="true"]):not([data-wa-right-column="true"]):not(header):not(:has(header)):not(:has([role="alert"], [role="status"], [data-testid*="toast"], [data-animate-toast])) {
                border-right: none !important;
                border-left: none !important;
                box-shadow: none !important;
                max-width: var(--wa-sidebar-width, 30%) !important;
            }
            [data-wa-flex-container="true"] > *:not([data-wa-main-column="true"]):not([data-wa-side-column="true"]):not([data-wa-left-drawer="true"]):not([data-wa-right-column="true"]):not(header)::before,
            [data-wa-flex-container="true"] > *:not([data-wa-main-column="true"]):not([data-wa-side-column="true"]):not([data-wa-left-drawer="true"]):not([data-wa-right-column="true"]):not(header)::after,
            [data-wa-flex-container="true"]::before,
            [data-wa-flex-container="true"]::after {
                border: none !important;
                box-shadow: none !important;
            }
            [data-wa-flex-container="true"] > [data-wa-aux-empty="true"] {
                width: 0 !important;
                min-width: 0 !important;
                max-width: 0 !important;
                flex: 0 0 0px !important;
                border: none !important;
                box-shadow: none !important;
                overflow: hidden !important;
            }
            [data-wa-flex-container="true"] > *:not([data-wa-main-column="true"]):not([data-wa-side-column="true"]):not([data-wa-left-drawer="true"]):not([data-wa-right-column="true"]):empty {
                width: 0 !important;
                min-width: 0 !important;
                max-width: 0 !important;
                flex: 0 0 0px !important;
                border: none !important;
                display: none !important;
            }

            body.wa-sidebar-compact #side::before,
            body.wa-sidebar-compact #side::after,
            body.wa-sidebar-compact [data-wa-side-column="true"]::before,
            body.wa-sidebar-compact [data-wa-side-column="true"]::after,
            body.wa-sidebar-compact [data-wa-side-column="true"] *::before,
            body.wa-sidebar-compact [data-wa-side-column="true"] *::after,
            body.wa-sidebar-compact .two > div:has(#side)::before,
            body.wa-sidebar-compact .two > div:has(#side)::after,
            body.wa-sidebar-compact .three > div:has(#side)::before,
            body.wa-sidebar-compact .three > div:has(#side)::after {
                display: none !important;
                content: none !important;
                width: 0 !important;
                height: 0 !important;
                border: none !important;
            }

            body.wa-sidebar-compact [data-wa-main-column="true"],
            body.wa-sidebar-compact [data-wa-side-column="true"] + div,
            body.wa-sidebar-compact .two > div:has(#main),
            body.wa-sidebar-compact .three > div:has(#main),
            body.wa-sidebar-compact .two > div:has(#side) + div,
            body.wa-sidebar-compact .three > div:has(#side) + div {
                flex: 1 1 0% !important;
                flex-grow: 1 !important;
                flex-shrink: 1 !important;
                min-width: 0 !important;
                width: auto !important;
                max-width: none !important;
                border-left: none !important;
                border-left-width: 0 !important;
            }

            body.wa-sidebar-compact #main::before,
            body.wa-sidebar-compact #main::after,
            body.wa-sidebar-compact [data-wa-main-column="true"]::before,
            body.wa-sidebar-compact [data-wa-main-column="true"]::after {
                display: none !important;
                content: none !important;
                width: 0 !important;
                height: 0 !important;
                border: none !important;
            }

            body.wa-sidebar-compact #wa-custom-resizer,
            body.wa-sidebar-compact #wa-custom-resizer::before,
            body.wa-sidebar-compact #wa-custom-resizer::after {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
                pointer-events: none !important;
                width: 0 !important;
                height: 0 !important;
                left: -9999px !important;
                margin: 0 !important;
            }

            body.wa-sidebar-compact #side > div:not(#pane-side):not(:has(#pane-side)):not([role="alert"]):not([role="status"]):not([data-testid*="toast"]):not([data-animate-toast]):not(:has([role="alert"], [role="status"], [data-testid*="toast"], [data-animate-toast])),
            body.wa-sidebar-compact #side div:has(> #pane-side) > div:not(#pane-side):not(:has(#pane-side)):not([role="alert"]):not([role="status"]):not([data-testid*="toast"]):not([data-animate-toast]):not(:has([role="alert"], [role="status"], [data-testid*="toast"], [data-animate-toast])),
            body.wa-sidebar-compact #side [role="search"]:not(#pane-side):not(:has(#pane-side)):not(#pane-side *),
            body.wa-sidebar-compact #side div:has(input):not(#pane-side):not(:has(#pane-side)):not(#pane-side *),
            body.wa-sidebar-compact #side div:has([data-tab="3"]):not(#pane-side):not(:has(#pane-side)):not(#pane-side *),
            body.wa-sidebar-compact #side div:has(span[data-icon="search"]):not(#pane-side):not(:has(#pane-side)):not(#pane-side *),
            body.wa-sidebar-compact #side [data-testid="chat-list-search"]:not(#pane-side):not(:has(#pane-side)):not(#pane-side *) {
                display: none !important;
                height: 0 !important;
                min-height: 0 !important;
                max-height: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
                border: none !important;
                overflow: hidden !important;
                visibility: hidden !important;
            }

            body.wa-sidebar-compact #side [role="tablist"]:not(#pane-side):not(:has(#pane-side)):not(#pane-side *),
            body.wa-sidebar-compact #side div:has(> [role="tablist"]):not(#pane-side):not(:has(#pane-side)):not(#pane-side *),
            body.wa-sidebar-compact #side div:has(button[role="button"][value]):not(#pane-side):not(:has(#pane-side)):not(#pane-side *),
            body.wa-sidebar-compact #side button:has(span[data-icon="filter"]):not(#pane-side):not(:has(#pane-side)):not(#pane-side *),
            body.wa-sidebar-compact #side div:has(span[data-icon="filter"]):not(#pane-side):not(:has(#pane-side)):not(#pane-side *) {
                display: none !important;
                height: 0 !important;
                min-height: 0 !important;
                max-height: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
                border: none !important;
                overflow: hidden !important;
                visibility: hidden !important;
            }

            body.wa-sidebar-compact #side [data-testid="archived"]:not(#pane-side):not(:has(#pane-side)),
            body.wa-sidebar-compact #side [data-testid="archive"]:not(#pane-side):not(:has(#pane-side)),
            body.wa-sidebar-compact #side [aria-label*="Archiv"]:not(#pane-side):not(:has(#pane-side)),
            body.wa-sidebar-compact #side [aria-label*="archiv"]:not(#pane-side):not(:has(#pane-side)),
            body.wa-sidebar-compact #side div[role="listitem"]:has(span[data-icon*="archiv"]),
            body.wa-sidebar-compact #side div[role="row"]:has(span[data-icon*="archiv"]),
            body.wa-sidebar-compact #side button:has(span[data-icon*="archiv"]):not(#pane-side):not(:has(#pane-side)),
            body.wa-sidebar-compact #side div:has(> span[data-icon*="archiv"]):not(#pane-side):not(:has(#pane-side)),
            body.wa-sidebar-compact #side span[data-icon="archive"],
            body.wa-sidebar-compact #side span[data-icon="archived"],
            body.wa-sidebar-compact .wa-archived-row,
            body.wa-sidebar-compact #side [data-wa-compact-hide="true"] {
                display: none !important;
                height: 0 !important;
                min-height: 0 !important;
                max-height: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
                border: none !important;
                overflow: hidden !important;
                visibility: hidden !important;
            }

            body.wa-sidebar-compact [data-wa-side-column="true"],
            body.wa-sidebar-compact #side {
                height: 100% !important;
                max-height: 100vh !important;
                margin-top: 0 !important;
                padding-top: 0 !important;
            }

            body.wa-sidebar-compact [data-wa-side-column="true"] #side:has(#pane-side),
            body.wa-sidebar-compact [data-wa-side-column="true"] div:has(#pane-side),
            body.wa-sidebar-compact #side div:has(#pane-side),
            body.wa-sidebar-compact #pane-side {
                width: 70px !important;
                min-width: 70px !important;
                max-width: 70px !important;
                height: 100% !important;
                min-height: 0 !important;
                max-height: 100vh !important;
                flex: 1 1 auto !important;
                margin-top: 0 !important;
                padding-top: 0 !important;
                box-sizing: border-box !important;
                scrollbar-width: none !important;
            }

            body.wa-sidebar-compact #side div:has(#pane-side),
            body.wa-sidebar-compact #pane-side {
                overflow-x: hidden !important;
            }

            body.wa-sidebar-compact #pane-side::-webkit-scrollbar {
                width: 0px !important;
                display: none !important;
            }

            /* Filas y celdas del listado de chats en modo compacto */
            body.wa-sidebar-compact #pane-side [role="row"]:not([data-wa-compact-hide="true"]),
            body.wa-sidebar-compact #pane-side [role="listitem"]:not([data-wa-compact-hide="true"]) {
                width: 70px !important;
                max-width: 70px !important;
                min-width: 70px !important;
                padding: 0 !important;
                margin: 0 !important;
                display: flex !important;
                justify-content: center !important;
                align-items: center !important;
                box-sizing: border-box !important;
                overflow: visible !important;
            }

            body.wa-sidebar-compact #pane-side [role="row"]:not([data-wa-compact-hide="true"]) > div:not([role="gridcell"]):not([data-wa-avatar-col="true"]):not([data-wa-text-col="true"]):not([data-wa-compact-hide="true"]),
            body.wa-sidebar-compact #pane-side [role="listitem"]:not([data-wa-compact-hide="true"]) > div:not([role="gridcell"]):not([data-wa-avatar-col="true"]):not([data-wa-text-col="true"]):not([data-wa-compact-hide="true"]),
            body.wa-sidebar-compact #pane-side div[data-testid="cell-frame-container"]:not([role="row"]):not([role="listitem"]):not([data-wa-compact-hide="true"]),
            body.wa-sidebar-compact #pane-side div:has(> [data-wa-avatar-col="true"]):not([role="row"]):not([role="listitem"]) {
                width: 70px !important;
                max-width: 70px !important;
                min-width: 70px !important;
                height: 100% !important;
                padding: 0 !important;
                margin: 0 !important;
                display: flex !important;
                justify-content: center !important;
                align-items: center !important;
                box-sizing: border-box !important;
                overflow: visible !important;
                position: relative !important;
            }

            /* Ocultacion universal de texto, fecha, preview, badges nativos y chinchetas (preservando .wa-alt-badge) */
            body.wa-sidebar-compact #pane-side div[data-testid="cell-frame-container"] > :not(:first-child):not(.wa-alt-badge):not([data-wa-avatar-col="true"]):not(:has([data-wa-avatar-col="true"])),
            body.wa-sidebar-compact #pane-side [role="row"] > :not(:first-child):not(.wa-alt-badge):not([data-wa-avatar-col="true"]):not(:has([data-wa-avatar-col="true"])),
            body.wa-sidebar-compact #pane-side [role="listitem"] > :not(:first-child):not(.wa-alt-badge):not([data-wa-avatar-col="true"]):not(:has([data-wa-avatar-col="true"])),
            body.wa-sidebar-compact #pane-side [role="row"] > div > :not(:first-child):not(.wa-alt-badge):not([data-wa-avatar-col="true"]):not([data-wa-avatar-col="true"] *):not(:has([data-wa-avatar-col="true"])),
            body.wa-sidebar-compact #pane-side [role="listitem"] > div > :not(:first-child):not(.wa-alt-badge):not([data-wa-avatar-col="true"]):not([data-wa-avatar-col="true"] *):not(:has([data-wa-avatar-col="true"])),
            body.wa-sidebar-compact #pane-side [role="row"] div:has(> img) ~ *:not(.wa-alt-badge):not([data-wa-avatar-col="true"]):not([data-wa-avatar-col="true"] *),
            body.wa-sidebar-compact #pane-side [role="listitem"] div:has(> img) ~ *:not(.wa-alt-badge):not([data-wa-avatar-col="true"]):not([data-wa-avatar-col="true"] *),
            body.wa-sidebar-compact #pane-side [role="row"] div[role="button"] ~ *:not(.wa-alt-badge):not([data-wa-avatar-col="true"]):not([data-wa-avatar-col="true"] *),
            body.wa-sidebar-compact #pane-side [role="listitem"] div[role="button"] ~ *:not(.wa-alt-badge):not([data-wa-avatar-col="true"]):not([data-wa-avatar-col="true"] *),
            body.wa-sidebar-compact #pane-side [role="gridcell"]:not(:has(img)):not(:has(svg)),
            body.wa-sidebar-compact #pane-side [data-wa-text-col="true"],
            body.wa-sidebar-compact #pane-side :is([role="row"], [role="listitem"]) [data-wa-text-col="true"],
            body.wa-sidebar-compact #pane-side [data-wa-compact-hide="true"],
            body.wa-sidebar-compact #pane-side [data-testid="cell-frame-title"],
            body.wa-sidebar-compact #pane-side [data-testid="cell-frame-primary"],
            body.wa-sidebar-compact #pane-side [data-testid="cell-frame-secondary"],
            body.wa-sidebar-compact #pane-side [data-testid="last-msg-status"],
            body.wa-sidebar-compact #pane-side span[data-testid="chat-title"],
            body.wa-sidebar-compact #pane-side [data-icon*="pin"],
            body.wa-sidebar-compact #pane-side [data-testid="pinned"],
            body.wa-sidebar-compact #pane-side [data-testid="pin"],
            body.wa-sidebar-compact #pane-side [data-icon="unread-count"],
            body.wa-sidebar-compact #pane-side [data-testid="icon-unread-count"] {
                display: none !important;
                width: 0 !important;
                min-width: 0 !important;
                max-width: 0 !important;
                height: 0 !important;
                padding: 0 !important;
                margin: 0 !important;
                overflow: hidden !important;
                visibility: hidden !important;
                flex: 0 0 0px !important;
                opacity: 0 !important;
                pointer-events: none !important;
            }

            body.wa-sidebar-compact #pane-side .wa-alt-badge {
                display: flex !important;
                visibility: visible !important;
                opacity: 1 !important;
                width: 20px !important;
                height: 20px !important;
            }

            /* Columna del avatar: Dimension fija estricta de 49px x 49px centrada */
            body.wa-sidebar-compact #pane-side div[data-testid="cell-frame-container"] > :first-child:not(:has([data-wa-avatar-col="true"])),
            body.wa-sidebar-compact #pane-side [role="row"] > :first-child:not(:has([data-wa-avatar-col="true"])),
            body.wa-sidebar-compact #pane-side [role="listitem"] > :first-child:not(:has([data-wa-avatar-col="true"])),
            body.wa-sidebar-compact #pane-side [role="row"] > div > :first-child:not(:has([data-wa-avatar-col="true"])),
            body.wa-sidebar-compact #pane-side [role="listitem"] > div > :first-child:not(:has([data-wa-avatar-col="true"])),
            body.wa-sidebar-compact #pane-side [role="row"] > div > div > :first-child:not(:has([data-wa-avatar-col="true"])),
            body.wa-sidebar-compact #pane-side [role="listitem"] > div > div > :first-child:not(:has([data-wa-avatar-col="true"])),
            body.wa-sidebar-compact #pane-side [data-wa-avatar-col="true"],
            body.wa-sidebar-compact #pane-side :is([role="row"], [role="listitem"]) [data-wa-avatar-col="true"] {
                width: 49px !important;
                min-width: 49px !important;
                max-width: 49px !important;
                height: 49px !important;
                min-height: 49px !important;
                max-height: 49px !important;
                margin: 0 auto !important;
                padding: 0 !important;
                position: relative !important;
                display: flex !important;
                justify-content: center !important;
                align-items: center !important;
                flex: 0 0 49px !important;
                box-sizing: border-box !important;
                overflow: visible !important;
            }

            /* Envoltorios internos del avatar: neutralizacion de paddings nativos */
            body.wa-sidebar-compact #pane-side [role="row"] div:has(> img):not([data-wa-text-col="true"]):not([data-wa-text-col="true"] *),
            body.wa-sidebar-compact #pane-side [role="listitem"] div:has(> img):not([data-wa-text-col="true"]):not([data-wa-text-col="true"] *),
            body.wa-sidebar-compact #pane-side [role="row"] div:has(> span[data-icon]):not([data-wa-text-col="true"]):not([data-wa-text-col="true"] *),
            body.wa-sidebar-compact #pane-side [role="listitem"] div:has(> span[data-icon]):not([data-wa-text-col="true"]):not([data-wa-text-col="true"] *),
            body.wa-sidebar-compact #pane-side [data-wa-avatar-col="true"] div:has(> img),
            body.wa-sidebar-compact #pane-side [data-wa-avatar-col="true"] div:has(> span[data-icon]),
            body.wa-sidebar-compact #pane-side [data-wa-avatar-col="true"] div[role="button"],
            body.wa-sidebar-compact #pane-side [role="row"] span[data-icon="default-user"],
            body.wa-sidebar-compact #pane-side [role="row"] span[data-icon="default-group"],
            body.wa-sidebar-compact #pane-side [role="row"] span[data-icon="community-outline"],
            body.wa-sidebar-compact #pane-side :is([role="row"], [role="listitem"]) span[data-icon*="avatar-"],
            body.wa-sidebar-compact #pane-side :is([role="row"], [role="listitem"]) span[data-icon*="default-"],
            body.wa-sidebar-compact #pane-side :is([role="row"], [role="listitem"]) span[data-icon*="channel"],
            body.wa-sidebar-compact #pane-side :is([role="row"], [role="listitem"]) span[data-icon*="newsletter"],
            body.wa-sidebar-compact #pane-side [role="row"] div[role="button"],
            body.wa-sidebar-compact #pane-side [role="listitem"] div[role="button"],
            body.wa-sidebar-compact #pane-side div[data-testid="cell-frame-container"] div[role="button"],
            body.wa-sidebar-compact #pane-side div[data-testid="cell-frame-container"] div:has(> img) {
                width: 49px !important;
                min-width: 49px !important;
                max-width: 49px !important;
                height: 49px !important;
                min-height: 49px !important;
                max-height: 49px !important;
                margin: 0 auto !important;
                padding: 0 !important;
                display: flex !important;
                justify-content: center !important;
                align-items: center !important;
                flex-shrink: 0 !important;
                position: relative !important;
                box-sizing: border-box !important;
            }

            /* Imagen de perfil del avatar centrada y dimensionada */
            body.wa-sidebar-compact #pane-side [role="row"] img,
            body.wa-sidebar-compact #pane-side [role="listitem"] img,
            body.wa-sidebar-compact #pane-side [data-wa-avatar-col="true"] img,
            body.wa-sidebar-compact #pane-side div[data-testid="cell-frame-container"] img {
                width: 49px !important;
                min-width: 49px !important;
                max-width: 49px !important;
                height: 49px !important;
                min-height: 49px !important;
                max-height: 49px !important;
                object-fit: cover !important;
                display: block !important;
                margin: 0 auto !important;
                padding: 0 !important;
                box-sizing: border-box !important;
                flex-shrink: 0 !important;
            }

            /* Avatares circulares para chats estandar (usuarios y grupos) */
            body.wa-sidebar-compact #pane-side [role="row"]:not(:has([data-icon*="community"])) img,
            body.wa-sidebar-compact #pane-side [role="listitem"]:not(:has([data-icon*="community"])) img,
            body.wa-sidebar-compact #pane-side [role="row"]:not(:has([data-icon*="community"])) div[role="button"],
            body.wa-sidebar-compact #pane-side [role="listitem"]:not(:has([data-icon*="community"])) div[role="button"],
            body.wa-sidebar-compact #pane-side [data-wa-avatar-col="true"]:not(:has([data-icon*="community"])) img,
            body.wa-sidebar-compact #pane-side [data-wa-avatar-col="true"]:not(:has([data-icon*="community"])) div[role="button"],
            body.wa-sidebar-compact #pane-side [data-wa-avatar-col="true"]:not(:has([data-icon*="community"])) div:has(> img),
            body.wa-sidebar-compact #pane-side div[data-testid="cell-frame-container"]:not(:has([data-icon*="community"])) img {
                border-radius: 50% !important;
                overflow: hidden !important;
            }

            /* Iconos squircle (circulo cuadrado) para comunidades y canales */
            body.wa-sidebar-compact #pane-side :is([role="row"], [role="listitem"]):has([data-icon*="community"]) img,
            body.wa-sidebar-compact #pane-side :is([role="row"], [role="listitem"]):has([data-icon*="community"]) div[role="button"],
            body.wa-sidebar-compact #pane-side :is([role="row"], [role="listitem"]):has([data-icon*="community"]) div:has(> img),
            body.wa-sidebar-compact #pane-side [data-wa-avatar-col="true"]:has([data-icon*="community"]) img,
            body.wa-sidebar-compact #pane-side [data-wa-avatar-col="true"]:has([data-icon*="community"]) div[role="button"],
            body.wa-sidebar-compact #pane-side [data-wa-avatar-col="true"]:has([data-icon*="community"]) div:has(> img),
            body.wa-sidebar-compact #pane-side div[data-testid="cell-frame-container"]:has([data-icon*="community"]) img,
            body.wa-sidebar-compact #pane-side span[data-icon*="community"] svg,
            body.wa-sidebar-compact #pane-side span[data-icon*="community"] {
                border-radius: 30% !important;
                overflow: hidden !important;
            }

            /* Superposicion de aro SVG de historia o estado */
            body.wa-sidebar-compact #pane-side [role="row"] > :first-child svg:not([data-icon]):not(span[data-icon] svg),
            body.wa-sidebar-compact #pane-side [role="listitem"] > :first-child svg:not([data-icon]):not(span[data-icon] svg),
            body.wa-sidebar-compact #pane-side [data-wa-avatar-col="true"] svg:not([data-icon]):not(span[data-icon] svg),
            body.wa-sidebar-compact #pane-side div[data-testid="cell-frame-container"] > :first-child svg:not([data-icon]):not(span[data-icon] svg) {
                position: absolute !important;
                top: 50% !important;
                left: 50% !important;
                transform: translate(-50%, -50%) !important;
                margin: 0 auto !important;
                pointer-events: none !important;
                z-index: 2 !important;
            }

            /* Fallback para avatares vectoriales por defecto */
            body.wa-sidebar-compact #pane-side span[data-icon="default-user"] svg,
            body.wa-sidebar-compact #pane-side span[data-icon="default-group"] svg,
            body.wa-sidebar-compact #pane-side span[data-icon*="avatar-"] svg,
            body.wa-sidebar-compact #pane-side span[data-icon*="default-"] svg,
            body.wa-sidebar-compact #pane-side span[data-icon*="channel"] svg,
            body.wa-sidebar-compact #pane-side span[data-icon*="newsletter"] svg {
                position: static !important;
                transform: none !important;
                width: 49px !important;
                height: 49px !important;
                border-radius: 50% !important;
            }

            body.wa-sidebar-compact #pane-side span[data-icon="community-outline"] svg,
            body.wa-sidebar-compact #pane-side span[data-icon*="community"] svg {
                position: static !important;
                transform: none !important;
                width: 49px !important;
                height: 49px !important;
                border-radius: 30% !important;
            }

            body.wa-sidebar-compact #pane-side [role="row"][aria-selected="true"],
            body.wa-sidebar-compact #pane-side [role="listitem"][aria-selected="true"],
            body.wa-sidebar-compact #pane-side [role="row"]:has([aria-selected="true"]),
            body.wa-sidebar-compact #pane-side [role="listitem"]:has([aria-selected="true"]) {
                border-left: none !important;
                box-shadow: inset 3px 0 0 0 #00a884 !important;
                background: rgba(134, 150, 160, 0.15) !important;
            }

            .wa-compact-toggle-wrapper {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                margin: 0 4px !important;
                padding: 0 !important;
                vertical-align: middle !important;
            }

            body.wa-sidebar-compact #side header,
            body.wa-sidebar-compact [data-wa-side-column="true"] header,
            body.wa-sidebar-compact .wa-compact-toggle-wrapper,
            body.wa-sidebar-compact #side > :not(#pane-side):not(:has(#pane-side)):not([role="alert"]):not([role="status"]):not([data-testid*="toast"]):not([data-animate-toast]):not(:has([role="alert"], [role="status"], [data-testid*="toast"], [data-animate-toast])),
            body.wa-sidebar-compact [data-wa-side-column="true"] > :not(#side):not(#pane-side):not(:has(#side)):not(:has(#pane-side)):not([role="alert"]):not([role="status"]):not([data-testid*="toast"]):not([data-animate-toast]):not(:has([role="alert"], [role="status"], [data-testid*="toast"], [data-animate-toast])),
            body.wa-sidebar-compact [data-wa-side-column="true"] [data-wa-compact-hide="true"],
            body.wa-sidebar-compact #side [data-wa-compact-hide="true"] {
                display: none !important;
                width: 0 !important;
                min-width: 0 !important;
                max-width: 0 !important;
                height: 0 !important;
                min-height: 0 !important;
                max-height: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
                border: none !important;
                overflow: hidden !important;
                visibility: hidden !important;
                opacity: 0 !important;
                pointer-events: none !important;
            }

            .wa-compact-toggle-btn {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                width: 36px !important;
                height: 36px !important;
                border-radius: 50% !important;
                border: none !important;
                outline: none !important;
                background: transparent !important;
                color: var(--icon-fixed, #8696a0) !important;
                cursor: pointer !important;
                padding: 0 !important;
                margin: 0 auto !important;
                transition: background-color 0.15s ease, color 0.15s ease, transform 0.15s ease !important;
                user-select: none !important;
                -webkit-user-select: none !important;
            }

            .wa-compact-toggle-btn:hover {
                background-color: rgba(134, 150, 160, 0.15) !important;
                color: var(--icon-high-emphasis, #d1d7db) !important;
            }

            .wa-compact-toggle-btn:active {
                transform: scale(0.92) !important;
            }

            .wa-compact-toggle-btn svg {
                width: 20px !important;
                height: 20px !important;
                fill: currentColor !important;
                pointer-events: none !important;
            }
        `;
        document.head.appendChild(style);
    }

    function getMaxWidth() {
        return Math.floor(window.innerWidth * 0.5);
    }

    function getSavedWidth() {
        var saved = localStorage.getItem(STORAGE_KEY_WIDTH);
        var parsed = parseInt(saved, 10);
        if (isNaN(parsed) || parsed < MIN_WIDTH) {
            return DEFAULT_WIDTH;
        }
        var max = getMaxWidth();
        if (parsed > max) {
            return max;
        }
        return parsed;
    }

    function isCompactActive() {
        return document.body.classList.contains('wa-sidebar-compact');
    }

    function updateButtonAppearance(btn, isCompact) {
        if (!btn) return;
        btn.innerHTML = isCompact ? SVG_EXPAND : SVG_COLLAPSE;
        var label = isCompact ? 'Expandir barra lateral' : 'Minimizar barra lateral';
        btn.setAttribute('title', label);
        btn.setAttribute('aria-label', label);
    }

    function resolveLayoutContainers() {
        var side = document.querySelector('#side');
        if (!side) return null;

        var mainEl = document.querySelector('#main');
        var isCacheValid = cachedSideColumn && cachedSideColumn.isConnected &&
                           cachedFlexContainer && cachedFlexContainer.isConnected &&
                           cachedSideColumn.parentElement === cachedFlexContainer &&
                           (!mainEl || (cachedMainColumn && cachedMainColumn.isConnected && cachedMainColumn.contains(mainEl)));

        if (isCacheValid) {
            return {
                side: side,
                sideColumn: cachedSideColumn,
                mainColumn: cachedMainColumn,
                flexContainer: cachedFlexContainer
            };
        }

        var sideCol = side;
        var mainCol = null;
        var container = null;

        var curr = side;
        while (curr && curr !== document.body && curr !== document.documentElement) {
            var p = curr.parentElement;
            if (!p) break;

            var isMainWrapper = p.classList.contains('two') || 
                                p.classList.contains('three') || 
                                p.classList.contains('app-wrapper-web') ||
                                p.id === 'app' ||
                                (p.parentElement && p.parentElement.id === 'app');

            var pStyle = window.getComputedStyle(p);
            var isFlexRow = pStyle.display.indexOf('flex') !== -1 && 
                            (pStyle.flexDirection === 'row' || pStyle.flexDirection === '');
            var isGrid = pStyle.display.indexOf('grid') !== -1;

            if (isFlexRow || isGrid || isMainWrapper) {
                var mainEl = document.querySelector('#main');
                if (mainEl && p.contains(mainEl) && curr !== mainEl) {
                    container = p;
                    sideCol = curr;

                    var m = mainEl;
                    while (m && m.parentElement !== container) {
                        m = m.parentElement;
                    }
                    mainCol = m;
                    break;
                } else if (!mainEl && curr.nextElementSibling) {
                    container = p;
                    sideCol = curr;
                    mainCol = curr.nextElementSibling;
                    break;
                }
            }
            curr = p;
        }

        if (sideCol) {
            cachedSideColumn = sideCol;
            sideCol.setAttribute('data-wa-side-column', 'true');
        }
        if (mainCol) {
            cachedMainColumn = mainCol;
            mainCol.setAttribute('data-wa-main-column', 'true');
        }
        if (container) {
            cachedFlexContainer = container;
            container.setAttribute('data-wa-flex-container', 'true');
        }

        return {
            side: side,
            sideColumn: sideCol,
            mainColumn: mainCol,
            flexContainer: container
        };
    }

    function getMaxRightWidth() {
        var sideWidth = 70;
        if (!isCompactActive()) {
            var containers = resolveLayoutContainers();
            var sideCol = (containers && containers.sideColumn) ? containers.sideColumn : document.querySelector('#side');
            var rectW = sideCol ? Math.round(sideCol.getBoundingClientRect().width) : 0;
            sideWidth = rectW > 0 ? rectW : getSavedWidth();
        }
        return Math.max(MIN_RIGHT_WIDTH, Math.min(Math.floor(window.innerWidth * 0.5), window.innerWidth - sideWidth - 260));
    }

    function getSavedRightWidth() {
        var saved = localStorage.getItem(STORAGE_KEY_RIGHT_WIDTH);
        var parsed = parseInt(saved, 10);
        var base = (isNaN(parsed) || parsed < MIN_RIGHT_WIDTH) ? DEFAULT_RIGHT_WIDTH : parsed;
        var maxRight = getMaxRightWidth();
        return Math.max(MIN_RIGHT_WIDTH, Math.min(base, maxRight));
    }

    function applyRightColumnInlineWidth(rightCol, widthPx) {
        if (!rightCol) return;
        rightCol.style.setProperty('flex', '0 0 ' + widthPx + 'px', 'important');
        rightCol.style.setProperty('flex-basis', widthPx + 'px', 'important');
        rightCol.style.setProperty('flex-grow', '0', 'important');
        rightCol.style.setProperty('flex-shrink', '0', 'important');
        rightCol.style.setProperty('width', widthPx + 'px', 'important');
        rightCol.style.setProperty('min-width', widthPx + 'px', 'important');
        rightCol.style.setProperty('max-width', widthPx + 'px', 'important');
        rightCol.style.setProperty('overflow-x', 'hidden', 'important');
        rightCol.style.setProperty('border-left', '1px solid rgba(134, 150, 160, 0.22)', 'important');
    }

    function setRightPanelWidth(width, persist) {
        var maxRight = getMaxRightWidth();
        var numericWidth = (typeof width === 'number' && !isNaN(width)) ? width : DEFAULT_RIGHT_WIDTH;
        var clamped = Math.max(MIN_RIGHT_WIDTH, Math.min(Math.round(numericWidth), maxRight));

        document.documentElement.style.setProperty('--wa-right-panel-width', clamped + 'px');

        var rightCol = document.querySelector('[data-wa-right-column="true"]');
        if (rightCol) {
            applyRightColumnInlineWidth(rightCol, clamped);
        }

        if (persist) {
            localStorage.setItem(STORAGE_KEY_RIGHT_WIDTH, clamped.toString());
        }

        updateRightResizerPosition();
    }

    function clearAuxInlineStyles(el) {
        if (!el) return;
        el.style.removeProperty('flex');
        el.style.removeProperty('flex-basis');
        el.style.removeProperty('flex-grow');
        el.style.removeProperty('flex-shrink');
        el.style.removeProperty('width');
        el.style.removeProperty('min-width');
        el.style.removeProperty('max-width');
        el.style.removeProperty('overflow');
        el.style.removeProperty('overflow-x');
        el.style.removeProperty('border');
        el.style.removeProperty('border-left');
        el.style.removeProperty('border-right');
        el.style.removeProperty('background-color');
    }

    function syncAuxDrawers(container, sideCol, mainCol) {
        if (!container) return;
        var side = document.querySelector('#side');
        var mainEl = document.querySelector('#main');
        var sideRect = sideCol ? sideCol.getBoundingClientRect() : null;
        var targetSideW = isCompactActive() ? getSavedWidth() : (currentSidebarWidth || Math.round((sideRect && sideRect.width) || getSavedWidth()));
        var hasRightCol = false;
        var children = container.children;

        function clearStaleInnerDrawers(el) {
            var stale = el.querySelectorAll('[data-wa-left-drawer="true"]');
            for (var k = 0; k < stale.length; k++) {
                stale[k].removeAttribute('data-wa-left-drawer');
                clearAuxInlineStyles(stale[k]);
            }
        }

        for (var i = 0; i < children.length; i++) {
            var child = children[i];
            if (child === sideCol || child === mainCol ||
                (side && child.contains(side)) || (mainEl && child.contains(mainEl))) {
                continue;
            }

            var isStandaloneToast = !child.querySelector('header, section, [data-animate-drawer-left="true"], [data-animate-drawer-right="true"]') &&
                                    (child.matches('[role="alert"], [role="status"], [data-testid*="toast"], [data-animate-toast]') ||
                                     child.querySelector('[role="alert"], [role="status"], [data-testid*="toast"], [data-animate-toast]') !== null);
            if (isStandaloneToast) {
                if (child.hasAttribute('data-wa-left-drawer') || child.hasAttribute('data-wa-right-column') || child.hasAttribute('data-wa-aux-empty')) {
                    clearAuxInlineStyles(child);
                }
                child.removeAttribute('data-wa-left-drawer');
                child.removeAttribute('data-wa-right-column');
                child.removeAttribute('data-wa-aux-empty');
                clearStaleInnerDrawers(child);
                continue;
            }

            var hasRealContent = child.children.length > 0 &&
                                 (child.querySelector('header, section, [role="region"], [role="heading"], [data-animate-drawer-left="true"], [data-animate-drawer-right="true"], button, [role="button"]') !== null ||
                                  (child.innerText || '').trim().length > 0);
            var isAfterMain = mainCol ? !!(mainCol.compareDocumentPosition(child) & Node.DOCUMENT_POSITION_FOLLOWING) : false;
            if (child.querySelector('[data-animate-drawer-left="true"]') && !child.querySelector('[data-animate-drawer-right="true"]')) {
                isAfterMain = false;
            } else if (isAfterMain && mainCol) {
                var cR = child.getBoundingClientRect();
                var mR = mainCol.getBoundingClientRect();
                if (cR.width > 0 && mR.width > 0 && cR.left < mR.left + 20) {
                    isAfterMain = false;
                }
            }

            if (!hasRealContent) {
                child.removeAttribute('data-wa-left-drawer');
                child.removeAttribute('data-wa-right-column');
                clearStaleInnerDrawers(child);
                child.setAttribute('data-wa-aux-empty', 'true');
                child.style.removeProperty('background-color');
                child.style.removeProperty('border-left');
                child.style.removeProperty('border-right');
                child.style.removeProperty('overflow-x');
                child.style.setProperty('flex', '0 0 0px', 'important');
                child.style.setProperty('flex-grow', '0', 'important');
                child.style.setProperty('flex-shrink', '0', 'important');
                child.style.setProperty('width', '0px', 'important');
                child.style.setProperty('min-width', '0px', 'important');
                child.style.setProperty('max-width', '0px', 'important');
                child.style.setProperty('border', 'none', 'important');
                child.style.setProperty('overflow', 'hidden', 'important');
            } else if (!isAfterMain) {
                if (child.hasAttribute('data-wa-aux-empty')) {
                    clearAuxInlineStyles(child);
                    child.removeAttribute('data-wa-aux-empty');
                }
                var childRect = child.getBoundingClientRect();
                var isNavRail = (child.tagName === 'HEADER') ||
                                (sideCol &&
                                 !!(child.compareDocumentPosition(sideCol) & Node.DOCUMENT_POSITION_FOLLOWING) &&
                                 !child.hasAttribute('data-wa-left-drawer') &&
                                 !child.querySelector('[data-animate-drawer-left="true"], section, [role="region"], [role="heading"], h1, h2, input, [role="textbox"], [role="row"], [role="listitem"], [role="grid"]') &&
                                 childRect.width > 0 && childRect.width <= 96 &&
                                 sideRect && childRect.right <= sideRect.left + 2);
                if (isNavRail) {
                    if (child.hasAttribute('data-wa-left-drawer') || child.hasAttribute('data-wa-right-column')) {
                        clearAuxInlineStyles(child);
                    }
                    child.removeAttribute('data-wa-left-drawer');
                    child.removeAttribute('data-wa-right-column');
                    clearStaleInnerDrawers(child);
                    continue;
                }

                var childPos = window.getComputedStyle(child).position;
                var absOverlay = null;
                if (childPos !== 'absolute' && childPos !== 'fixed') {
                    var innerCand = child.querySelector('[data-animate-drawer-left="true"]') || child.firstElementChild;
                    if (innerCand) {
                        var innerPos = window.getComputedStyle(innerCand).position;
                        if (innerPos === 'absolute' || innerPos === 'fixed') {
                            absOverlay = innerCand;
                        }
                    }
                }

                if (absOverlay) {
                    clearAuxInlineStyles(child);
                    child.removeAttribute('data-wa-left-drawer');
                    child.removeAttribute('data-wa-right-column');
                    child.style.setProperty('flex', '0 0 0px', 'important');
                    child.style.setProperty('width', '0px', 'important');
                    child.style.setProperty('min-width', '0px', 'important');
                    child.style.setProperty('overflow', 'visible', 'important');
                    var absRect = absOverlay.getBoundingClientRect();
                    var absW = targetSideW;
                    if (sideRect && sideRect.width > 0 && absRect.width > 0 && absRect.left < sideRect.left) {
                        absW = Math.max(targetSideW, Math.round((sideRect.left + targetSideW) - absRect.left));
                    }
                    absOverlay.style.setProperty('width', absW + 'px', 'important');
                    absOverlay.style.setProperty('min-width', absW + 'px', 'important');
                    absOverlay.style.setProperty('max-width', absW + 'px', 'important');
                    absOverlay.style.setProperty('overflow', 'hidden', 'important');
                    absOverlay.style.setProperty('border-right', '1px solid rgba(134, 150, 160, 0.22)', 'important');
                    absOverlay.style.setProperty('background-color', 'var(--panel-background-deep, var(--background-default, #111b21))', 'important');
                    absOverlay.setAttribute('data-wa-left-drawer', 'true');
                    continue;
                }

                child.removeAttribute('data-wa-right-column');
                child.setAttribute('data-wa-left-drawer', 'true');

                var drawerW = targetSideW;
                if (sideRect && sideRect.width > 0 && childRect.width > 0 && childRect.left < sideRect.left) {
                    var sideRight = sideRect.left + targetSideW;
                    drawerW = Math.max(targetSideW, Math.round(sideRight - childRect.left));
                }

                child.style.removeProperty('border');
                child.style.removeProperty('border-left');
                child.style.setProperty('flex', '0 0 ' + drawerW + 'px', 'important');
                child.style.setProperty('flex-basis', drawerW + 'px', 'important');
                child.style.setProperty('flex-grow', '0', 'important');
                child.style.setProperty('flex-shrink', '0', 'important');
                child.style.setProperty('width', drawerW + 'px', 'important');
                child.style.setProperty('min-width', drawerW + 'px', 'important');
                child.style.setProperty('max-width', drawerW + 'px', 'important');
                child.style.setProperty('overflow', 'hidden', 'important');
                child.style.setProperty('border-right', '1px solid rgba(134, 150, 160, 0.22)', 'important');
                child.style.setProperty('background-color', 'var(--panel-background-deep, var(--background-default, #111b21))', 'important');
            } else {
                if (child.hasAttribute('data-wa-aux-empty')) {
                    clearAuxInlineStyles(child);
                    child.removeAttribute('data-wa-aux-empty');
                }
                hasRightCol = true;
                child.removeAttribute('data-wa-left-drawer');
                clearStaleInnerDrawers(child);
                child.setAttribute('data-wa-right-column', 'true');

                if (!isRightDragging) {
                    var rw = Math.max(MIN_RIGHT_WIDTH, Math.min(getSavedRightWidth(), getMaxRightWidth()));
                    document.documentElement.style.setProperty('--wa-right-panel-width', rw + 'px');
                    child.style.removeProperty('overflow');
                    child.style.removeProperty('border');
                    child.style.removeProperty('border-right');
                    child.style.removeProperty('background-color');
                    applyRightColumnInlineWidth(child, rw);
                }
            }
        }

        var leftDrawers = container.querySelectorAll('[data-animate-drawer-left="true"]');
        for (var j = 0; j < leftDrawers.length; j++) {
            var dl = leftDrawers[j];
            if (dl.children.length === 0) continue;
            if (dl.hasAttribute('data-wa-left-drawer')) {
                dl.style.setProperty('box-sizing', 'border-box', 'important');
                continue;
            }
            var inLeftDrawer = !!dl.closest('[data-wa-left-drawer="true"]');
            var inSideCol = !!(sideCol && sideCol.contains(dl));
            if (inLeftDrawer || (inSideCol && !isCompactActive())) {
                var dlRect = dl.getBoundingClientRect();
                if (sideRect && inSideCol && !isCompactActive() && dlRect.width > 0 && dlRect.left < sideRect.left - 1) {
                    var dlW = Math.max(targetSideW, Math.round((sideRect.left + targetSideW) - dlRect.left));
                    dl.style.setProperty('width', dlW + 'px', 'important');
                    dl.style.setProperty('min-width', dlW + 'px', 'important');
                    dl.style.setProperty('max-width', dlW + 'px', 'important');
                } else {
                    dl.style.setProperty('width', '100%', 'important');
                    dl.style.setProperty('min-width', '100%', 'important');
                    dl.style.setProperty('max-width', '100%', 'important');
                }
            } else {
                dl.style.setProperty('width', targetSideW + 'px', 'important');
                dl.style.setProperty('min-width', targetSideW + 'px', 'important');
                dl.style.setProperty('max-width', targetSideW + 'px', 'important');
                dl.style.setProperty('background-color', 'var(--panel-background-deep, var(--background-default, #111b21))', 'important');
            }
            dl.style.setProperty('box-sizing', 'border-box', 'important');
        }

        if (hasRightCol) {
            ensureRightResizer();
        }
        updateResizerPosition();
    }

    function setSidebarWidth(width, persist) {
        var max = getMaxWidth();
        var numericWidth = (typeof width === 'number' && !isNaN(width)) ? width : DEFAULT_WIDTH;
        var clamped = Math.max(MIN_WIDTH, Math.min(Math.round(numericWidth), max));
        currentSidebarWidth = clamped;

        document.documentElement.style.setProperty('--wa-sidebar-width', clamped + 'px');

        var containers = resolveLayoutContainers();
        if (containers && !isCompactActive()) {
            var side = containers.side;
            var sideCol = containers.sideColumn;
            var mainCol = containers.mainColumn;

            if (side) {
                side.__waWidthApplied = true;
            }

            if (sideCol) {
                sideCol.style.removeProperty('border-right');
                sideCol.style.removeProperty('overflow');
                sideCol.style.setProperty('width', clamped + 'px', 'important');
                sideCol.style.setProperty('min-width', clamped + 'px', 'important');
                sideCol.style.setProperty('max-width', clamped + 'px', 'important');
                sideCol.style.setProperty('flex-basis', clamped + 'px', 'important');
                sideCol.style.setProperty('flex-grow', '0', 'important');
                sideCol.style.setProperty('flex-shrink', '0', 'important');
            }

            if (side && side !== sideCol) {
                side.style.removeProperty('border-right');
                side.style.removeProperty('overflow');
                side.style.setProperty('width', '100%', 'important');
                side.style.setProperty('min-width', '100%', 'important');
                side.style.setProperty('max-width', '100%', 'important');
                side.style.setProperty('flex-basis', '100%', 'important');
                side.style.setProperty('flex-grow', '1', 'important');
                side.style.setProperty('flex-shrink', '1', 'important');
            } else if (side) {
                side.style.removeProperty('border-right');
                side.style.removeProperty('overflow');
                side.style.setProperty('width', clamped + 'px', 'important');
                side.style.setProperty('min-width', clamped + 'px', 'important');
                side.style.setProperty('max-width', clamped + 'px', 'important');
                side.style.setProperty('flex-basis', clamped + 'px', 'important');
            }

            if (mainCol) {
                mainCol.style.setProperty('flex', '1 1 0%', 'important');
                mainCol.style.setProperty('flex-grow', '1', 'important');
                mainCol.style.setProperty('flex-shrink', '1', 'important');
                mainCol.style.setProperty('min-width', '0', 'important');
                mainCol.style.setProperty('width', 'auto', 'important');
                mainCol.style.setProperty('max-width', 'none', 'important');
            }

            var mainEl = document.querySelector('#main');
            if (mainEl && mainEl !== mainCol) {
                mainEl.style.setProperty('width', '100%', 'important');
                mainEl.style.setProperty('height', '100%', 'important');
                mainEl.style.setProperty('min-width', '0', 'important');
                mainEl.style.setProperty('flex', '1 1 auto', 'important');
            }

            syncAuxDrawers(containers.flexContainer, sideCol, mainCol);
        }

        if (persist) {
            localStorage.setItem(STORAGE_KEY_WIDTH, clamped.toString());
        }

        updateResizerPosition();
    }

    function resolveLeftResizeTarget() {
        var containers = resolveLayoutContainers();
        var targetEl = (containers && containers.sideColumn) ? containers.sideColumn : document.querySelector('#side');
        var rect = targetEl ? targetEl.getBoundingClientRect() : null;
        if (!targetEl || !rect || rect.width === 0 || rect.height === 0) {
            var drawers = document.querySelectorAll('[data-wa-left-drawer="true"]');
            for (var i = 0; i < drawers.length; i++) {
                var dRect = drawers[i].getBoundingClientRect();
                if (dRect.width > 0 && dRect.height > 0) {
                    return { element: drawers[i], rect: dRect };
                }
            }
            return null;
        }
        return { element: targetEl, rect: rect };
    }

    function updateLeftResizerPosition() {
        if (!resizerElement) return;

        if (isCompactActive()) {
            resizerElement.style.display = 'none';
            resizerElement.style.left = '-9999px';
            return;
        }

        var target = resolveLeftResizeTarget();
        if (!target) {
            resizerElement.style.display = 'none';
            resizerElement.style.left = '-9999px';
            return;
        }

        resizerElement.style.display = 'block';
        resizerElement.style.top = target.rect.top + 'px';
        resizerElement.style.height = target.rect.height + 'px';
        resizerElement.style.left = target.rect.right + 'px';
    }

    function updateRightResizerPosition() {
        if (!rightResizerElement) return;

        var rightCol = document.querySelector('[data-wa-right-column="true"]');
        if (!rightCol) {
            rightResizerElement.style.display = 'none';
            rightResizerElement.style.left = '-9999px';
            return;
        }

        var rRect = rightCol.getBoundingClientRect();
        if (rRect.width <= 0 || rRect.height <= 0) {
            rightResizerElement.style.display = 'none';
            rightResizerElement.style.left = '-9999px';
            return;
        }

        rightResizerElement.style.display = 'block';
        rightResizerElement.style.top = rRect.top + 'px';
        rightResizerElement.style.height = rRect.height + 'px';
        rightResizerElement.style.left = rRect.left + 'px';
    }

    function updateResizerPosition() {
        updateLeftResizerPosition();
        updateRightResizerPosition();
    }

    function onMouseDown(e) {
        if (e.button !== 0 || isCompactActive()) return;
        e.preventDefault();

        isDragging = true;
        if (resizerElement) {
            resizerElement.classList.add('is-resizing');
        }
        document.documentElement.classList.add('wa-resizing-active');

        window.addEventListener('mousemove', onMouseMove, { passive: false, capture: true });
        window.addEventListener('mouseup', onMouseUp, { once: true, capture: true });
    }

    function onMouseMove(e) {
        if (!isDragging) return;
        e.preventDefault();
        targetClientX = e.clientX;

        if (!rafPending) {
            rafPending = true;
            window.requestAnimationFrame(function() {
                rafPending = false;
                if (!isDragging) return;

                var target = resolveLeftResizeTarget();
                if (!target) return;

                var sideLeft = target.rect.left;
                var calculatedWidth = targetClientX - sideLeft;

                setSidebarWidth(calculatedWidth, false);
            });
        }
    }

    function onMouseUp(e) {
        if (!isDragging) return;
        isDragging = false;

        if (resizerElement) {
            resizerElement.classList.remove('is-resizing');
        }
        document.documentElement.classList.remove('wa-resizing-active');

        window.removeEventListener('mousemove', onMouseMove, { capture: true });

        var target = resolveLeftResizeTarget();
        if (target) {
            var currentWidth = Math.round(target.rect.width);
            setSidebarWidth(currentWidth, true);
        }
    }

    function onRightMouseDown(e) {
        if (e.button !== 0) return;
        var rightCol = document.querySelector('[data-wa-right-column="true"]');
        if (!rightCol) return;

        e.preventDefault();
        isRightDragging = true;
        if (rightResizerElement) {
            rightResizerElement.classList.add('is-resizing');
        }
        document.documentElement.classList.add('wa-resizing-active');

        window.addEventListener('mousemove', onRightMouseMove, { passive: false, capture: true });
        window.addEventListener('mouseup', onRightMouseUp, { once: true, capture: true });
    }

    function onRightMouseMove(e) {
        if (!isRightDragging) return;
        e.preventDefault();
        rightTargetClientX = e.clientX;

        if (!rightRafPending) {
            rightRafPending = true;
            window.requestAnimationFrame(function() {
                rightRafPending = false;
                if (!isRightDragging) return;

                var rightCol = document.querySelector('[data-wa-right-column="true"]');
                if (!rightCol) return;

                var rightEdge = rightCol.getBoundingClientRect().right;
                var calculatedWidth = rightEdge - rightTargetClientX;
                setRightPanelWidth(calculatedWidth, false);
            });
        }
    }

    function onRightMouseUp(e) {
        if (!isRightDragging) return;
        isRightDragging = false;

        if (rightResizerElement) {
            rightResizerElement.classList.remove('is-resizing');
        }
        document.documentElement.classList.remove('wa-resizing-active');

        window.removeEventListener('mousemove', onRightMouseMove, { capture: true });

        var rightCol = document.querySelector('[data-wa-right-column="true"]');
        if (rightCol) {
            var currentWidth = Math.round(rightCol.getBoundingClientRect().width);
            setRightPanelWidth(currentWidth, true);
        }
    }

    window.__waSetSidebarCompact = function(targetCompact) {
        var currentlyCompact = isCompactActive();
        if (targetCompact === currentlyCompact) return;

        var containers = resolveLayoutContainers();
        var side = (containers && containers.side) ? containers.side : document.querySelector('#side');
        var sideCol = (containers && containers.sideColumn) ? containers.sideColumn : side;
        var mainCol = (containers && containers.mainColumn) ? containers.mainColumn : null;

        if (targetCompact) {
            if (sideCol && sideCol.offsetWidth >= MIN_WIDTH) {
                var widthVal = Math.round(sideCol.getBoundingClientRect().width);
                localStorage.setItem(STORAGE_KEY_WIDTH, widthVal.toString());
            }
            document.body.classList.add('wa-sidebar-compact');
            localStorage.setItem(STORAGE_KEY_COMPACT, 'true');
            document.documentElement.style.setProperty('--wa-sidebar-width', '70px');

            if (sideCol) {
                sideCol.style.setProperty('width', '70px', 'important');
                sideCol.style.setProperty('min-width', '70px', 'important');
                sideCol.style.setProperty('max-width', '70px', 'important');
                sideCol.style.setProperty('flex-basis', '70px', 'important');
                sideCol.style.setProperty('overflow', 'visible', 'important');
                sideCol.style.setProperty('border-right', 'none', 'important');
            }
            if (side && side !== sideCol) {
                side.style.setProperty('width', '70px', 'important');
                side.style.setProperty('min-width', '70px', 'important');
                side.style.setProperty('max-width', '70px', 'important');
                side.style.setProperty('flex-basis', '70px', 'important');
                side.style.setProperty('overflow', 'visible', 'important');
                side.style.setProperty('border-right', 'none', 'important');
            }
            if (resizerElement) {
                resizerElement.style.display = 'none';
                resizerElement.style.left = '-9999px';
            }
            if (mainCol) {
                mainCol.style.setProperty('flex', '1 1 0%', 'important');
                mainCol.style.setProperty('flex-grow', '1', 'important');
                mainCol.style.setProperty('min-width', '0', 'important');
                mainCol.style.setProperty('width', 'auto', 'important');
                mainCol.style.setProperty('max-width', 'none', 'important');
            }
            if (containers && containers.flexContainer) {
                syncAuxDrawers(containers.flexContainer, sideCol, mainCol);
            }
        } else {
            document.body.classList.remove('wa-sidebar-compact');
            localStorage.setItem(STORAGE_KEY_COMPACT, 'false');
            var savedWidth = getSavedWidth();
            document.documentElement.style.setProperty('--wa-sidebar-width', savedWidth + 'px');
            setSidebarWidth(savedWidth, false);
        }

        var btn = document.querySelector('.wa-compact-toggle-btn');
        if (btn) {
            updateButtonAppearance(btn, targetCompact);
        }

        updateResizerPosition();
    };

    window.__waToggleSidebarCompact = function() {
        window.__waSetSidebarCompact(!isCompactActive());
    };

    function ensureToggleButton() {
        var existingBtn = document.querySelector('.wa-compact-toggle-btn');
        if (existingBtn && existingBtn.isConnected) {
            updateButtonAppearance(existingBtn, isCompactActive());
            return true;
        }

        var header = document.querySelector('#side header');
        if (!header) return false;

        var wrapper = document.createElement('div');
        wrapper.className = 'wa-compact-toggle-wrapper';

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'wa-compact-toggle-btn';
        updateButtonAppearance(btn, isCompactActive());

        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            window.__waToggleSidebarCompact();
        });

        wrapper.appendChild(btn);

        // Insertar siempre como hijo directo de header para no quedar oculto dentro de botones nativos
        header.appendChild(wrapper);

        return true;
    }

    function syncAvatarTooltips() {
        if (!isCompactActive()) {
            if (syncAvatarTooltips.__dirty !== false) {
                var stale = document.querySelectorAll('[data-wa-compact-hide], [data-wa-avatar-col], [data-wa-text-col]');
                for (var s = 0; s < stale.length; s++) {
                    stale[s].removeAttribute('data-wa-compact-hide');
                    stale[s].removeAttribute('data-wa-avatar-col');
                    stale[s].removeAttribute('data-wa-text-col');
                }
                syncAvatarTooltips.__dirty = false;
            }
            return;
        }
        syncAvatarTooltips.__dirty = true;

        var pane = document.getElementById('pane-side');
        if (!pane) return;

        var sideRoot = pane.closest('[data-wa-side-column="true"]') || document.getElementById('side');
        if (sideRoot) {
            var sideHeaders = sideRoot.querySelectorAll('header');
            for (var h = 0; h < sideHeaders.length; h++) {
                if (pane.contains(sideHeaders[h])) continue;
                if (sideHeaders[h].getAttribute('data-wa-compact-hide') !== 'true') {
                    sideHeaders[h].setAttribute('data-wa-compact-hide', 'true');
                }
            }

            var ancCurr = pane;
            while (ancCurr) {
                if (ancCurr.hasAttribute('data-wa-compact-hide')) {
                    ancCurr.removeAttribute('data-wa-compact-hide');
                }
                if (ancCurr === sideRoot) break;
                var ancParent = ancCurr.parentElement;
                if (!ancParent || !(sideRoot === ancParent || sideRoot.contains(ancParent))) {
                    break;
                }
                var ancSibs = ancParent.children;
                for (var as = 0; as < ancSibs.length; as++) {
                    var ancSib = ancSibs[as];
                    if (ancSib === ancCurr) continue;
                    var isPaneBranch = ancSib.id === 'pane-side' || ancSib.contains(pane);
                    var isSibToast = !isPaneBranch &&
                                     !ancSib.matches('header') &&
                                     !ancSib.querySelector('header, [role="search"], [role="tablist"], input') &&
                                     (ancSib.matches('[role="alert"], [role="status"], [data-testid*="toast"], [data-animate-toast]') ||
                                      ancSib.querySelector('[role="alert"], [role="status"], [data-testid*="toast"], [data-animate-toast]') !== null);
                    if (isPaneBranch || isSibToast) {
                        if (ancSib.hasAttribute('data-wa-compact-hide')) {
                            ancSib.removeAttribute('data-wa-compact-hide');
                        }
                        continue;
                    }
                    if (ancSib.getAttribute('data-wa-compact-hide') !== 'true') {
                        ancSib.setAttribute('data-wa-compact-hide', 'true');
                    }
                }
                ancCurr = ancParent;
            }
        }

        if (!pane.__waCompactScrollAttached) {
            pane.__waCompactScrollAttached = true;
            var scrollRaf = false;
            pane.addEventListener('scroll', function() {
                if (!isCompactActive() || scrollRaf) return;
                scrollRaf = true;
                window.requestAnimationFrame(function() {
                    scrollRaf = false;
                    syncAvatarTooltips();
                });
            }, { passive: true });
        }

        function isTextSiblingEl(el, avatarEl) {
            if (!el || el.nodeType !== 1) return false;
            if (el.classList && el.classList.contains('wa-alt-badge')) return false;
            if (el === avatarEl || el.contains(avatarEl)) return false;
            var tag = el.tagName ? el.tagName.toLowerCase() : '';
            if (tag === 'svg' || tag === 'path' || el.hasAttribute('data-icon')) return false;
            if (el.getAttribute('role') === 'gridcell' ||
                el.querySelector('[role="gridcell"], [data-testid="cell-frame-title"], [data-testid="cell-frame-primary"], [data-testid="cell-frame-secondary"], span[title], span[dir="auto"]') !== null) {
                return true;
            }
            var nonSvgText = '';
            for (var cn = 0; cn < el.childNodes.length; cn++) {
                var ch = el.childNodes[cn];
                if (ch.nodeType === 3) {
                    nonSvgText += ch.nodeValue;
                } else if (ch.nodeType === 1 && ch.tagName && ch.tagName.toLowerCase() !== 'svg' && !ch.hasAttribute('data-icon')) {
                    nonSvgText += ch.textContent;
                }
            }
            return nonSvgText.trim().length > 0;
        }

        // Ocultar bloques de aviso de cifrado y elementos de Archivados fuera de filas de chat
        var lockIcons = pane.querySelectorAll('span[data-icon*="lock"], [data-testid*="encrypt"], a[href*="encryption"], a[href*="28030015"]');
        for (var l = 0; l < lockIcons.length; l++) {
            var lockEl = lockIcons[l];
            if (lockEl.closest('[role="row"], [role="listitem"]')) continue;
            var lockTarget = lockEl;
            while (lockTarget.parentElement && lockTarget.parentElement !== pane &&
                   !lockTarget.parentElement.querySelector('[role="row"], [role="listitem"]') &&
                   !lockTarget.parentElement.matches('[role="grid"], [role="region"], [role="list"]')) {
                lockTarget = lockTarget.parentElement;
            }
            if (lockTarget !== pane &&
                !lockTarget.matches('[role="grid"], [role="region"], [role="list"]') &&
                !lockTarget.querySelector('[role="row"], [role="listitem"], [role="grid"], [role="region"], [role="list"]')) {
                if (lockTarget.getAttribute('data-wa-compact-hide') !== 'true') {
                    lockTarget.setAttribute('data-wa-compact-hide', 'true');
                }
            }
        }

        function hideNonRowBlocks(node) {
            if (!node || node.nodeType !== 1) return;
            if (node.matches('[role="row"], [role="listitem"]')) return;
            if (node.getAttribute('data-wa-compact-hide') === 'true') return;

            var hasRowsOrList = node.querySelector('[role="row"], [role="listitem"], [role="grid"], [role="region"], [role="list"]') !== null;
            if (node !== pane && !hasRowsOrList && !node.matches('[role="grid"], [role="region"], [role="list"]')) {
                var txt = (node.textContent || '').trim();
                var hasLock = node.querySelector('span[data-icon*="lock"], [data-testid*="encrypt"], a[href*="encryption"], a[href*="28030015"]') !== null;
                var hasArchive = node.querySelector('span[data-icon*="archiv"], [data-testid*="archiv"]') !== null;
                var isEncryptTxt = /(cifrad|extremo a extremo|end-to-end|encrypt|criptograf)/i.test(txt);
                var isArchiveTxt = /^(archivados|archived|arquivadas)(\s*\d+)?$/i.test(txt);
                if (hasLock || hasArchive || isEncryptTxt || isArchiveTxt) {
                    node.setAttribute('data-wa-compact-hide', 'true');
                    return;
                }
            }

            var children = node.children;
            for (var c = 0; c < children.length; c++) {
                hideNonRowBlocks(children[c]);
            }
        }
        hideNonRowBlocks(pane);

        var rows = pane.querySelectorAll('[role="row"], [role="listitem"]');
        if (rows.length > 0) {
            // Ocultar hermanos sin filas del contenedor de lista dentro de #pane-side (p. ej. aviso de cifrado al pie)
            var listAncestor = rows[0].parentElement;
            if (listAncestor && listAncestor !== pane) {
                var chain = listAncestor.parentElement;
                var childInChain = listAncestor;
                while (chain && pane.contains(chain)) {
                    var siblings = chain.children;
                    for (var sb = 0; sb < siblings.length; sb++) {
                        var sib = siblings[sb];
                        if (sib === childInChain) continue;
                        if (sib.classList && sib.classList.contains('wa-alt-badge')) continue;
                        if (sib.matches('[role="row"], [role="listitem"]')) continue;
                        if (sib.querySelector('[role="row"], [role="listitem"]')) continue;
                        if ((sib.textContent && sib.textContent.trim().length > 0) ||
                            sib.querySelector('svg, button, a, span') !== null) {
                            if (sib.getAttribute('data-wa-compact-hide') !== 'true') {
                                sib.setAttribute('data-wa-compact-hide', 'true');
                            }
                        }
                    }
                    if (chain === pane) break;
                    childInChain = chain;
                    chain = chain.parentElement;
                }
            }
        } else {
            rows = pane.querySelectorAll('div[data-testid="cell-frame-container"]');
        }

        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];

            var isPinned = row.querySelector('span[data-icon*="pin"], [data-testid*="pin"]') !== null;
            if (!isPinned) {
                var hasArchiveIcon = row.querySelector('span[data-icon*="archiv"], [data-testid*="archiv"]') !== null;
                var rowFullText = (row.textContent || '').trim();
                var isArchivedRow = hasArchiveIcon || /^(archivados|archived|arquivadas)(\s*\d+)?$/i.test(rowFullText);
                var isNoticeRow = !row.querySelector('img, span[title], [data-testid="cell-frame-title"]') &&
                                  (row.querySelector('span[data-icon*="lock"], [data-testid*="encrypt"]') !== null ||
                                   /(cifrad|extremo a extremo|end-to-end|encrypt|criptograf)/i.test(rowFullText));
                if (isArchivedRow || isNoticeRow) {
                    if (row.getAttribute('data-wa-compact-hide') !== 'true') {
                        row.setAttribute('data-wa-compact-hide', 'true');
                    }
                    continue;
                }
            }
            if (row.hasAttribute('data-wa-compact-hide')) {
                row.removeAttribute('data-wa-compact-hide');
            }

            var titleEl = row.querySelector('[data-testid="cell-frame-title"]') ||
                          row.querySelector('span[title]') ||
                          row.querySelector('span[dir="auto"]');
            if (titleEl) {
                var name = (titleEl.getAttribute('title') || titleEl.textContent || '').trim();
                if (name && row.getAttribute('title') !== name) {
                    row.setAttribute('title', name);
                }
            }

            var avatarEl = row.querySelector(
                'img, span[data-icon*="default-"], span[data-icon*="community"], ' +
                'span[data-icon*="avatar"], span[data-icon*="channel"], span[data-icon*="newsletter"], svg'
            );
            if (!avatarEl) continue;

            var avatarCol = null;
            var flexParent = null;
            var curr = avatarEl;
            while (curr && curr !== row) {
                var parent = curr.parentElement;
                if (!parent || !row.contains(parent)) break;
                var hasTextSib = false;
                var pChildren = parent.children;
                for (var k = 0; k < pChildren.length; k++) {
                    if (pChildren[k] !== curr && isTextSiblingEl(pChildren[k], avatarEl)) {
                        hasTextSib = true;
                        break;
                    }
                }
                if (hasTextSib) {
                    avatarCol = curr;
                    flexParent = parent;
                    break;
                }
                curr = parent;
            }

            if (avatarCol && flexParent) {
                var oldCols = row.querySelectorAll('[data-wa-avatar-col], [data-wa-text-col]');
                for (var oc = 0; oc < oldCols.length; oc++) {
                    var oldEl = oldCols[oc];
                    if (oldEl !== avatarCol && oldEl.parentElement !== flexParent) {
                        oldEl.removeAttribute('data-wa-avatar-col');
                        oldEl.removeAttribute('data-wa-text-col');
                    }
                }

                if (avatarCol.getAttribute('data-wa-avatar-col') !== 'true') {
                    avatarCol.setAttribute('data-wa-avatar-col', 'true');
                }
                if (avatarCol.hasAttribute('data-wa-text-col')) {
                    avatarCol.removeAttribute('data-wa-text-col');
                }

                var cols = flexParent.children;
                for (var j = 0; j < cols.length; j++) {
                    var col = cols[j];
                    if (col === avatarCol) continue;
                    if ((col.classList && col.classList.contains('wa-alt-badge')) || col.contains(avatarEl)) {
                        if (col.hasAttribute('data-wa-text-col')) {
                            col.removeAttribute('data-wa-text-col');
                        }
                        continue;
                    }
                    if (col.getAttribute('data-wa-text-col') !== 'true') {
                        col.setAttribute('data-wa-text-col', 'true');
                    }
                    if (col.hasAttribute('data-wa-avatar-col')) {
                        col.removeAttribute('data-wa-avatar-col');
                    }
                }
            }
        }
    }

    function ensureRightResizer() {
        if (!rightResizerElement || !document.body.contains(rightResizerElement)) {
            rightResizerElement = document.getElementById('wa-custom-right-resizer');
            if (!rightResizerElement) {
                rightResizerElement = document.createElement('div');
                rightResizerElement.id = 'wa-custom-right-resizer';
                rightResizerElement.setAttribute('role', 'separator');
                rightResizerElement.setAttribute('aria-orientation', 'vertical');
                rightResizerElement.setAttribute('title', 'Arrastra para redimensionar el panel de informacion');
                document.body.appendChild(rightResizerElement);
            }
            rightResizerElement.removeEventListener('mousedown', onRightMouseDown);
            rightResizerElement.addEventListener('mousedown', onRightMouseDown);
        }

        var rightCol = document.querySelector('[data-wa-right-column="true"]');
        if (window.ResizeObserver && rightCol && !rightCol.__waRightResizeObserverAttached) {
            rightCol.__waRightResizeObserverAttached = true;
            var rightResizeObserver = new ResizeObserver(function() {
                if (!isRightDragging) {
                    updateRightResizerPosition();
                }
            });
            rightResizeObserver.observe(rightCol);
        }
    }

    function initResizer() {
        var side = document.querySelector('#side');
        if (!side) return false;

        resolveLayoutContainers();

        if (!resizerElement || !document.body.contains(resizerElement)) {
            resizerElement = document.getElementById('wa-custom-resizer');
            if (!resizerElement) {
                resizerElement = document.createElement('div');
                resizerElement.id = 'wa-custom-resizer';
                resizerElement.setAttribute('role', 'separator');
                resizerElement.setAttribute('aria-orientation', 'vertical');
                resizerElement.setAttribute('title', 'Arrastra para redimensionar el panel lateral');
                document.body.appendChild(resizerElement);
            }
            resizerElement.removeEventListener('mousedown', onMouseDown);
            resizerElement.addEventListener('mousedown', onMouseDown);
        }

        ensureRightResizer();

        var containers = resolveLayoutContainers();
        var targetEl = (containers && containers.sideColumn) ? containers.sideColumn : side;

        if (window.ResizeObserver && targetEl && !targetEl.__waResizeObserverAttached) {
            targetEl.__waResizeObserverAttached = true;
            var resizeObserver = new ResizeObserver(function() {
                if (!isDragging) {
                    updateLeftResizerPosition();
                }
                if (!isRightDragging) {
                    updateRightResizerPosition();
                }
            });
            resizeObserver.observe(targetEl);
        }

        updateResizerPosition();
        return true;
    }

    injectStyles();

    function applyCompactInline() {
        var c = resolveLayoutContainers();
        if (!c) return;
        [c.sideColumn, c.side].forEach(function(el) {
            if (!el) return;
            el.style.setProperty('width', '70px', 'important');
            el.style.setProperty('flex-basis', '70px', 'important');
            el.style.setProperty('overflow', 'visible', 'important');
            el.style.setProperty('border-right', 'none', 'important');
        });
        if (c.mainColumn) {
            c.mainColumn.style.setProperty('flex', '1 1 0%', 'important');
            c.mainColumn.style.setProperty('min-width', '0', 'important');
        }
        if (c.flexContainer) {
            syncAuxDrawers(c.flexContainer, c.sideColumn, c.mainColumn);
        }
        if (c.side && c.sideColumn && c.mainColumn) {
            c.side.__waCompactApplied = true;
        }
    }

    var savedCompact = localStorage.getItem(STORAGE_KEY_COMPACT);
    if (savedCompact === 'true') {
        document.body.classList.add('wa-sidebar-compact');
        document.documentElement.style.setProperty('--wa-sidebar-width', '70px');
        applyCompactInline();
    } else {
        var initialWidth = getSavedWidth();
        setSidebarWidth(initialWidth, false);
    }

    initResizer();
    ensureToggleButton();
    syncAvatarTooltips();

    var observer = new MutationObserver(function() {
        ensureToggleButton();
        syncAvatarTooltips();
        if (window.__waEnsurePaneListeners) {
            window.__waEnsurePaneListeners();
        }
        var c = resolveLayoutContainers();
        if (c && c.flexContainer) {
            syncAuxDrawers(c.flexContainer, c.sideColumn, c.mainColumn);
        }
        if (!isCompactActive()) {
            initResizer();
            var sEl = document.querySelector('#side');
            if (sEl && !sEl.__waWidthApplied) {
                sEl.__waWidthApplied = true;
                setSidebarWidth(currentSidebarWidth || getSavedWidth(), false);
            }
        } else if (document.querySelector('#side') &&
                   (!document.querySelector('[data-wa-side-column="true"]') ||
                    !document.querySelector('#side').__waCompactApplied)) {
            // #side o #main monto despues del arranque en modo compacto: reaplicar contenedores y anchos
            applyCompactInline();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    window.addEventListener('resize', function() {
        if (!isCompactActive()) {
            var curWidth = getSavedWidth();
            setSidebarWidth(curWidth, false);
        }
        if (document.querySelector('[data-wa-right-column="true"]')) {
            setRightPanelWidth(getSavedRightWidth(), false);
        } else {
            updateRightResizerPosition();
        }
    });
})();
)JS");
}
