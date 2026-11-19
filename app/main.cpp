#include <QApplication>
#include <QByteArray>
#include <QCoreApplication>
#include <QDir>
#include <QFileInfo>
#include <QIcon>
#include <QLocalServer>
#include <QLocalSocket>
#include <QString>
#include <QStringList>

#include "whatsapp_window.h"

int main(int argc, char *argv[])
{
    // Optimizacion de Chromium para fluidez, aceleracion por GPU y bajo consumo
    const QStringList chromiumFlags = {
        "--enable-smooth-scrolling",
        "--enable-gpu-rasterization",
        "--enable-zero-copy",
        "--ignore-gpu-blocklist",
        "--ozone-platform-hint=auto",
        "--disable-background-networking",
        "--enable-features=VaapiVideoDecoder,CanvasOopRasterization",
        "--disable-features=EyeDropper,InstalledApp,WebOTP,WebPayments,WebUSB,BackgroundFetch,Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider,CalculateNativeWinOcclusion,InterestFeedContentSuggestions,AutofillServerCommunication"
    };

    const QByteArray existingFlags = qgetenv("QTWEBENGINE_CHROMIUM_FLAGS");
    QString combinedFlags;
    if (!existingFlags.trimmed().isEmpty()) {
        combinedFlags = QString::fromLocal8Bit(existingFlags).trimmed() + QLatin1Char(' ');
    }
    combinedFlags += chromiumFlags.join(QLatin1Char(' '));

    qputenv("QTWEBENGINE_CHROMIUM_FLAGS", combinedFlags.toLocal8Bit());

    // Instancia principal de la aplicacion
    QApplication app(argc, argv);

    // Identidad de la aplicacion para Wayland y X11 (agrupacion en KDE Plasma)
    app.setApplicationName("whatsapp-web");
    app.setApplicationDisplayName("WhatsApp Web");
    app.setDesktopFileName("whatsapp-web");

    const QString serverName = QStringLiteral("WhatsAppWebClientServer");

    // Extraer posible argumento de URL con protocolo whatsapp://
    QString urlArg;
    const QStringList args = app.arguments();
    for (int i = 1; i < args.size(); ++i) {
        if (args.at(i).startsWith(QLatin1String("whatsapp://"))) {
            urlArg = args.at(i);
            break;
        }
    }

    // Comprobacion rapida de instancia unica mediante QLocalSocket
    QLocalSocket socket;
    socket.connectToServer(serverName);

    const bool connected = (socket.state() == QLocalSocket::ConnectedState)
        || (socket.state() == QLocalSocket::ConnectingState && socket.waitForConnected(50));
    if (connected) {
        // Enviar peticion para activar ventana de la instancia en ejecucion
        const QString message = QStringLiteral("SHOW:") + urlArg;
        socket.write(message.toUtf8());
        socket.waitForBytesWritten(200);
        socket.disconnectFromServer();
        return 0;
    }

    // Busqueda rapida del icono global (sin escanear tema XDG en el arranque critico)
    const QString homePath = QDir::homePath();
    const QStringList iconCandidatePaths = {
        QCoreApplication::applicationDirPath() + QStringLiteral("/whatsapp.svg"),
        homePath + QStringLiteral("/.local/share/whatsapp-web-client/whatsapp.svg"),
        homePath + QStringLiteral("/.local/share/icons/hicolor/scalable/apps/whatsapp-web-client.svg"),
        QStringLiteral("/usr/share/whatsapp-web-client/whatsapp.svg"),
        QStringLiteral("/usr/share/pixmaps/whatsapp-web-client.svg"),
        QStringLiteral("/usr/share/pixmaps/whatsapp.svg")
    };

    for (const QString &path : iconCandidatePaths) {
        if (QFileInfo::exists(path)) {
            app.setWindowIcon(QIcon(path));
            break;
        }
    }

    // Instancia principal: crear servidor local para recibir llamadas posteriores
    QLocalServer server;
    QLocalServer::removeServer(serverName);
    server.listen(serverName);

    QApplication::setQuitOnLastWindowClosed(false);

    WhatsAppClient client;

    QObject::connect(&server, &QLocalServer::newConnection, [&server, &client]() {
        while (QLocalSocket *clientSocket = server.nextPendingConnection()) {
            QObject::connect(clientSocket, &QLocalSocket::readyRead, &client, [clientSocket, &client]() {
                const QString data = QString::fromUtf8(clientSocket->readAll());
                if (data.startsWith(QLatin1String("SHOW:"))) {
                    client.show();
                    client.activateWindow();
                    client.raise();
                    const QString url = data.mid(5);
                    if (!url.isEmpty()) {
                        client.handleWhatsAppUrl(url);
                    }
                }
                clientSocket->disconnectFromServer();
                clientSocket->deleteLater();
            });
            QObject::connect(clientSocket, &QLocalSocket::disconnected, clientSocket, &QObject::deleteLater);
        }
    });

    if (!urlArg.isEmpty()) {
        client.handleWhatsAppUrl(urlArg);
    }

    client.show();

    return app.exec();
}
