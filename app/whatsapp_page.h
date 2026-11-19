#ifndef WHATSAPP_PAGE_H
#define WHATSAPP_PAGE_H

#include <QWebEnginePage>
#include <QWebEngineProfile>
#include <QUrl>

class WhatsAppPage : public QWebEnginePage {
    Q_OBJECT
public:
    explicit WhatsAppPage(QWebEngineProfile *profile, QObject *parent = nullptr);
    explicit WhatsAppPage(QObject *parent = nullptr);

protected:
    bool acceptNavigationRequest(const QUrl &url, NavigationType type, bool isMainFrame) override;
    QWebEnginePage *createWindow(QWebEnginePage::WebWindowType type) override;

private slots:
    void handleNewWindowUrl(const QUrl &url, QWebEnginePage *tempPage);
};

#endif // WHATSAPP_PAGE_H

