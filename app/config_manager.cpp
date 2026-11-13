#include "config_manager.h"

#include <QDir>
#include <QFile>
#include <QJsonDocument>
#include <QCryptographicHash>

QString ConfigManager::configFilePath()
{
    return QDir::homePath() + QStringLiteral("/.local/share/WhatsAppWebClient/config.json");
}

void ConfigManager::ensureDirectoryExists()
{
    const QString dirPath = QDir::homePath() + QStringLiteral("/.local/share/WhatsAppWebClient");
    QDir().mkpath(dirPath);
}

QJsonObject ConfigManager::readConfigFile()
{
    QFile file(configFilePath());
    if (!file.exists() || !file.open(QIODevice::ReadOnly | QIODevice::Text)) {
        return QJsonObject();
    }

    const QByteArray data = file.readAll();
    file.close();

    const QJsonDocument doc = QJsonDocument::fromJson(data);
    if (!doc.isObject()) {
        return QJsonObject();
    }

    return doc.object();
}

bool ConfigManager::writeConfigFile(const QJsonObject &config)
{
    ensureDirectoryExists();

    QFile file(configFilePath());
    if (!file.open(QIODevice::WriteOnly | QIODevice::Text | QIODevice::Truncate)) {
        return false;
    }

    const QJsonDocument doc(config);
    file.write(doc.toJson(QJsonDocument::Indented));
    file.close();
    return true;
}

QString ConfigManager::getPinHash()
{
    const QJsonObject config = readConfigFile();
    return config.value(QStringLiteral("app_pin_hash")).toString();
}

void ConfigManager::setPin(const QString &newPin)
{
    QJsonObject config = readConfigFile();
    if (!newPin.isEmpty()) {
        const QByteArray hash = QCryptographicHash::hash(newPin.toUtf8(), QCryptographicHash::Sha256);
        config.insert(QStringLiteral("app_pin_hash"), QString::fromLatin1(hash.toHex()));
    } else {
        config.remove(QStringLiteral("app_pin_hash"));
    }
    writeConfigFile(config);
}

bool ConfigManager::verifyPin(const QString &candidatePin)
{
    const QString savedHash = getPinHash();
    if (savedHash.isEmpty()) {
        return true;
    }

    const QByteArray hash = QCryptographicHash::hash(candidatePin.toUtf8(), QCryptographicHash::Sha256);
    const QString candidateHash = QString::fromLatin1(hash.toHex());
    return candidateHash == savedHash;
}

bool ConfigManager::hasPin()
{
    return !getPinHash().isEmpty();
}

bool ConfigManager::isAppLocked()
{
    const QJsonObject config = readConfigFile();
    return config.value(QStringLiteral("is_locked")).toBool(false);
}

void ConfigManager::setAppLocked(bool locked)
{
    QJsonObject config = readConfigFile();
    config.insert(QStringLiteral("is_locked"), locked);
    writeConfigFile(config);
}
