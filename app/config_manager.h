#ifndef CONFIG_MANAGER_H
#define CONFIG_MANAGER_H

#include <QString>
#include <QJsonObject>

class ConfigManager
{
public:
    ConfigManager() = delete;

    static QString getPinHash();
    static void setPin(const QString &newPin);
    static bool verifyPin(const QString &candidatePin);
    static bool hasPin();
    static bool isAppLocked();
    static void setAppLocked(bool locked);
    static QString configFilePath();

private:
    static void ensureDirectoryExists();
    static QJsonObject readConfigFile();
    static bool writeConfigFile(const QJsonObject &config);
};

#endif // CONFIG_MANAGER_H
