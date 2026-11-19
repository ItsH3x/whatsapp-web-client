#include "whatsapp_window.h"

#include <QApplication>
#include <QColor>
#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QKeySequence>
#include <QLineEdit>
#include <QPalette>
#include <QStandardPaths>
#include <QTimer>
#include <QWebEngineSettings>

namespace {

inline bool isPureLeftAltModifier(Qt::KeyboardModifiers mods) {
    return (mods & Qt::AltModifier) && !(mods & Qt::GroupSwitchModifier);
}

inline bool isRightAltOrAltGrNative(const QKeyEvent *ke) {
    if (!ke) return false;
    const quint32 sc = ke->nativeScanCode();
    const quint32 vk = ke->nativeVirtualKey();
    return sc == 108u || sc == 100u
        || vk == 0xffeau || vk == 0xfe03u || vk == 0xff7eu;
}

inline bool isLeftAltKeyEvent(const QKeyEvent *ke) {
    return ke != nullptr
        && ke->key() == Qt::Key_Alt
        && !(ke->modifiers() & Qt::GroupSwitchModifier)
        && !isRightAltOrAltGrNative(ke);
}

inline bool isAltGrKeyEvent(const QKeyEvent *ke) {
    return ke != nullptr
        && (ke->key() == Qt::Key_AltGr
            || ke->key() == Qt::Key_Mode_switch
            || static_cast<bool>(ke->modifiers() & Qt::GroupSwitchModifier)
            || isRightAltOrAltGrNative(ke));
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
    , m_initialUrl(QStringLiteral("https://web.whatsapp.com"))
{
    setWindowTitle(QStringLiteral("WhatsApp Web"));
    resize(1024, 768);

    // Fondo oscuro inmediato antes de que Chromium pinte el primer frame
    QPalette pal = palette();
    pal.setColor(QPalette::Window, QColor(0x11, 0x1b, 0x21));
    setPalette(pal);
    setAutoFillBackground(true);

    const QIcon appIcon = QApplication::windowIcon();
    if (!appIcon.isNull()) {
        setWindowIcon(appIcon);
    }

    // Restaurar estado de bloqueo inmediatamente antes de mostrar el contenido web
    if (ConfigManager::hasPin() && ConfigManager::isAppLocked()) {
        ensureLockOverlay();
        m_lockOverlay->lock();
    }

    // Inicializar WebEngine justo tras el primer show() para pintar la ventana lo antes posible
    QTimer::singleShot(0, this, &WhatsAppClient::initWebEngine);
}

void WhatsAppClient::ensureLockOverlay() {
    if (m_lockOverlay) {
        return;
    }
    m_lockOverlay = new LockOverlay(this);
    connect(m_lockOverlay, &LockOverlay::locked, this, &WhatsAppClient::onAppLocked);
    connect(m_lockOverlay, &LockOverlay::unlocked, this, &WhatsAppClient::onAppUnlocked);
}

void WhatsAppClient::ensureDownloadDir() {
    if (!m_downloadDir.isEmpty()) {
        return;
    }
    QString baseDownloadDir = QStandardPaths::writableLocation(QStandardPaths::DownloadLocation);
    if (baseDownloadDir.trimmed().isEmpty()) {
        baseDownloadDir = QDir::homePath() + QStringLiteral("/Downloads");
    }
    m_downloadDir = baseDownloadDir + QStringLiteral("/WhatsApp");
    if (!QFileInfo::exists(m_downloadDir)) {
        QDir().mkpath(m_downloadDir);
    }
}

void WhatsAppClient::initWebEngine() {
    if (m_browser) {
        return;
    }

    m_profile = new QWebEngineProfile(QStringLiteral("WhatsAppProfile"), this);

    // Idioma del sistema
    QByteArray langEnv = qgetenv("LANG");
    if (langEnv.isEmpty()) {
        langEnv = "en_US.UTF-8";
    }
    const QString langStr = QString::fromUtf8(langEnv).section('.', 0, 0).replace('_', '-');
    const QString langBase = langStr.section('-', 0, 0);
    m_profile->setHttpAcceptLanguage(QStringLiteral("%1,%2;q=0.9,en-US;q=0.8,en;q=0.7").arg(langStr, langBase));

    // User-Agent de Chrome moderno en Linux
    m_profile->setHttpUserAgent(QStringLiteral("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"));

    // Almacenamiento persistente
    const QString storagePath = QDir::homePath() + QStringLiteral("/.local/share/WhatsAppWebClient");
    if (!QFileInfo::exists(storagePath)) {
        QDir().mkpath(storagePath);
    }
    m_profile->setPersistentStoragePath(storagePath);
    m_profile->setPersistentCookiesPolicy(QWebEngineProfile::ForcePersistentCookies);

    // Limite de cache HTTP en disco (80 MB)
    m_profile->setHttpCacheType(QWebEngineProfile::DiskHttpCache);
    m_profile->setHttpCacheMaximumSize(80 * 1024 * 1024);

    // Inyectar scripts en DocumentCreation / DocumentReady antes de iniciar la navegacion
    setupWebScripts();

    // Crear la pagina con m_profile antes de asociarla a QWebEngineView
    // para evitar inicializar QWebEngineProfile::defaultProfile() con una pagina temporal
    m_page = new WhatsAppPage(m_profile, this);
    QWebEngineSettings *webSettings = m_page->settings();
    webSettings->setAttribute(QWebEngineSettings::ScrollAnimatorEnabled, true);
    webSettings->setAttribute(QWebEngineSettings::Accelerated2dCanvasEnabled, true);
    webSettings->setAttribute(QWebEngineSettings::WebGLEnabled, true);
    if (m_dndMode) {
        m_page->setAudioMuted(true);
    }

    m_browser = new QWebEngineView(this);
    m_browser->setPage(m_page);
    m_page->setParent(m_browser);
    setCentralWidget(m_browser);
    m_browser->show();

    if (m_lockOverlay && m_lockOverlay->isLocked()) {
        m_lockOverlay->raise();
    }

    // Permisos, notificaciones, descargas y carga de pagina
    connect(m_page, &QWebEnginePage::permissionRequested, this, &WhatsAppClient::grantPermission);
    m_profile->setNotificationPresenter([this](std::unique_ptr<QWebEngineNotification> notif) {
        handleNotification(std::move(notif));
    });
    connect(m_profile, &QWebEngineProfile::downloadRequested, this, [this](QWebEngineDownloadRequest *download) {
        ensureDownloadDir();
        handleDownload(download);
    });
    connect(m_page, &QWebEnginePage::loadFinished, this, &WhatsAppClient::onPageLoaded);

    m_browser->installEventFilter(this);
    if (m_browser->focusProxy()) {
        m_browser->focusProxy()->installEventFilter(this);
    }
    for (QObject *child : m_browser->children()) {
        if (child->isWidgetType()) {
            child->installEventFilter(this);
        }
    }

    // Iniciar carga de WhatsApp Web de inmediato
    m_browser->setUrl(m_initialUrl);

    // Diferir servicios secundarios fuera de la ruta critica de arranque
    QTimer::singleShot(0, this, &WhatsAppClient::initDeferredServices);
}

void WhatsAppClient::initDeferredServices() {
    // Corrector ortografico (solo si existen diccionarios .bdic disponibles)
    if (m_profile) {
        QStringList dictDirs = {
            QCoreApplication::applicationDirPath() + QStringLiteral("/qtwebengine_dictionaries"),
            QStringLiteral("/usr/share/qt6/qtwebengine_dictionaries")
        };
        const QByteArray envDictPath = qgetenv("QTWEBENGINE_DICTIONARIES_PATH");
        if (!envDictPath.isEmpty()) {
            dictDirs.prepend(QString::fromLocal8Bit(envDictPath));
        }
        bool hasBdic = false;
        for (const QString &dirPath : dictDirs) {
            const QDir d(dirPath);
            if (d.exists() && !d.entryList({QStringLiteral("*.bdic")}, QDir::Files).isEmpty()) {
                hasBdic = true;
                break;
            }
        }
        if (hasBdic) {
            m_profile->setSpellCheckEnabled(true);
            m_profile->setSpellCheckLanguages({QStringLiteral("es-ES"), QStringLiteral("en-US")});
        }
    }

    ensureDownloadDir();

    // Gestor de notificaciones nativas DBus
    m_notificationManager = new NotificationManager(this);
    connect(m_notificationManager, &NotificationManager::replyReceived, this, &WhatsAppClient::sendWhatsAppMessage);
    connect(m_notificationManager, &NotificationManager::actionDefaultInvoked, this, &WhatsAppClient::openChat);

    // Fallback al tema de iconos solo si no se encontro SVG directo
    QIcon appIcon = windowIcon();
    if (appIcon.isNull()) {
        appIcon = QIcon::fromTheme(QStringLiteral("whatsapp-web-client"));
        if (!appIcon.isNull()) {
            setWindowIcon(appIcon);
        }
    }

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

    setupZoom();
    setupChatShortcuts();
    setupPrivacyShortcut();
    ensureLockOverlay();
}

WhatsAppClient::~WhatsAppClient() {
    if (qApp) {
        qApp->removeEventFilter(this);
    }
    if (m_browser) {
        delete m_browser;
        m_browser = nullptr;
        m_page = nullptr;
    }
}

void WhatsAppClient::grantPermission(QWebEnginePermission permission) {
    permission.grant();
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
            if (m_altBHoldTimer) {
                m_altBHoldTimer->start();
            }
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

            if (m_altBHoldTimer && m_altBHoldTimer->isActive()) {
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
    QTimer::singleShot(4000, this, &WhatsAppClient::scrapeRecentChats);
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
    QUrl targetUrl;
    if (url.contains(QLatin1String("chat")) && url.contains(QLatin1String("code="))) {
        const QString afterCode = url.section(QLatin1String("code="), 1, 1);
        const QString code = afterCode.section(QLatin1Char('&'), 0, 0);
        targetUrl = QUrl(QStringLiteral("https://web.whatsapp.com/accept?code=") + code);
    } else if (url.contains(QLatin1String("send")) && url.contains(QLatin1Char('?'))) {
        const QString query = url.section(QLatin1Char('?'), 1);
        targetUrl = QUrl(QStringLiteral("https://web.whatsapp.com/send?") + query);
    }
    if (!targetUrl.isValid()) {
        return;
    }
    if (m_browser) {
        m_browser->setUrl(targetUrl);
    } else {
        m_initialUrl = targetUrl;
    }
}
