#include "whatsapp_page.h"

#include <QDesktopServices>

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

