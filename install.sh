#!/bin/bash
set -e

# Directorios de destino estándar XDG
TARGET_DIR="$HOME/.local/share/whatsapp-web-client"
APPS_DIR="$HOME/.local/share/applications"
BIN_DIR="$HOME/.local/bin"
DESKTOP_FILE="$APPS_DIR/whatsapp-web.desktop"
LAUNCHER_BIN="$BIN_DIR/whatsapp-web-client"

# Directorio desde donde se ejecuta el script
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Manejo de desinstalación
if [ "$1" = "--uninstall" ] || [ "$1" = "-u" ]; then
    echo "Desinstalando WhatsApp Web Client..."
    rm -rf "$TARGET_DIR"
    rm -f "$DESKTOP_FILE"
    rm -f "$LAUNCHER_BIN"
    if command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database "$APPS_DIR" || true
    fi
    echo "¡Desinstalación completada con éxito!"
    exit 0
fi

echo "=========================================="
echo " Instalador de WhatsApp Web Client"
echo "=========================================="

# Función para verificar dependencias de Python requeridas
check_dependencies() {
    local missing_deps=()
    python3 -c "import PyQt6" 2>/dev/null || missing_deps+=("PyQt6")
    python3 -c "import PyQt6.QtWebEngineWidgets" 2>/dev/null || missing_deps+=("PyQt6-WebEngine")
    python3 -c "import dbus" 2>/dev/null || missing_deps+=("dbus-python")
    python3 -c "import gi" 2>/dev/null || missing_deps+=("PyGObject")

    if [ ${#missing_deps[@]} -eq 0 ]; then
        return 0
    fi

    echo ""
    echo "ADVERTENCIA: Faltan dependencias necesarias del sistema: ${missing_deps[*]}"
    echo ""

    # Detectar el gestor de paquetes de la distribución
    local install_cmd=""
    if command -v pacman >/dev/null 2>&1; then
        install_cmd="sudo pacman -S --needed python python-pyqt6 python-pyqt6-webengine python-dbus python-gobject"
    elif command -v apt-get >/dev/null 2>&1; then
        install_cmd="sudo apt-get update && sudo apt-get install -y python3 python3-pyqt6 python3-pyqt6.qtwebengine python3-dbus python3-gi"
    elif command -v dnf >/dev/null 2>&1; then
        install_cmd="sudo dnf install -y python3 python3-pyqt6 python3-pyqt6-webengine python3-dbus python3-gobject"
    elif command -v zypper >/dev/null 2>&1; then
        install_cmd="sudo zypper install -y python3-qt6 python3-qt6-webengine python3-dbus-python python3-gobject"
    fi

    if [ -n "$install_cmd" ]; then
        # Si se ejecuta de forma interactiva (en una terminal)
        if [ -t 0 ]; then
            read -p "¿Deseas instalar las dependencias automáticamente ahora? [S/n]: " ans
            ans=${ans:-S}
            if [[ "$ans" =~ ^[sSyY]$ ]]; then
                echo "Ejecutando: $install_cmd"
                eval "$install_cmd"
                return 0
            fi
        fi
        echo "Por favor, instala las dependencias manualmente ejecutando:"
        echo "  $install_cmd"
    else
        echo "Por favor instala manualmente los paquetes correspondientes para tu distribución:"
        echo "  - Python 3"
        echo "  - PyQt6 y PyQt6-WebEngine"
        echo "  - dbus-python y PyGObject"
    fi
    echo ""
    echo "Instalación cancelada debido a dependencias faltantes."
    exit 1
}

# Verificar dependencias antes de continuar
check_dependencies

# Determinar modo de instalación (in-place o copia permanente)
INSTALL_DIR="$TARGET_DIR"
if [ "$1" = "--in-place" ]; then
    echo "Modo: Instalación in-place (desarrollo local)"
    INSTALL_DIR="$SOURCE_DIR"
else
    echo "Modo: Instalación estándar en $TARGET_DIR"
    mkdir -p "$TARGET_DIR"

    # Copiar archivos esenciales
    cp -u "$SOURCE_DIR/main.py" "$TARGET_DIR/"
    cp -u "$SOURCE_DIR/lock_overlay.py" "$TARGET_DIR/"
    cp -u "$SOURCE_DIR/config_manager.py" "$TARGET_DIR/"
    cp -u "$SOURCE_DIR/dbus_daemon.py" "$TARGET_DIR/"
    cp -u "$SOURCE_DIR/style.css" "$TARGET_DIR/"
    cp -u "$SOURCE_DIR/whatsapp.svg" "$TARGET_DIR/"
fi

# Determinar intérprete de Python
if [ -x "$INSTALL_DIR/venv/bin/python3" ]; then
    PYTHON_EXEC="$INSTALL_DIR/venv/bin/python3"
elif [ -x "$SOURCE_DIR/venv/bin/python3" ]; then
    PYTHON_EXEC="$SOURCE_DIR/venv/bin/python3"
elif command -v python3 >/dev/null 2>&1; then
    PYTHON_EXEC="$(command -v python3)"
else
    echo "Error: No se encontró python3 instalado en el sistema." >&2
    exit 1
fi

# Asegurar permisos de ejecución
chmod +x "$INSTALL_DIR/main.py"
chmod +x "$INSTALL_DIR/dbus_daemon.py"

# Crear lanzador de terminal en ~/.local/bin
mkdir -p "$BIN_DIR"
cat <<EOF > "$LAUNCHER_BIN"
#!/bin/bash
exec "$PYTHON_EXEC" "$INSTALL_DIR/main.py" "\$@"
EOF
chmod +x "$LAUNCHER_BIN"

# Crear directorio de aplicaciones y archivo .desktop
mkdir -p "$APPS_DIR"
cat <<EOF > "$DESKTOP_FILE"
[Desktop Entry]
Version=1.0
Name=WhatsApp Web
Comment=Cliente no oficial de WhatsApp
Exec=$LAUNCHER_BIN %U
Icon=$INSTALL_DIR/whatsapp.svg
Terminal=false
Type=Application
StartupWMClass=whatsapp-web
Categories=Network;InstantMessaging;
Keywords=whatsapp;chat;im;messaging;
MimeType=x-scheme-handler/whatsapp;
EOF
chmod +x "$DESKTOP_FILE"

# Instalar icono en el tema hicolor para integración con Wayland/KDE
ICON_HICOLOR_DIR="$HOME/.local/share/icons/hicolor/scalable/apps"
mkdir -p "$ICON_HICOLOR_DIR"
cp -u "$SOURCE_DIR/whatsapp.svg" "$ICON_HICOLOR_DIR/whatsapp-web.svg"

# Registrar manejador para enlaces whatsapp:// si xdg-mime está disponible
if command -v xdg-mime >/dev/null 2>&1; then
    xdg-mime default whatsapp-web.desktop x-scheme-handler/whatsapp || true
fi

# Actualizar base de datos de escritorio si existe
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$APPS_DIR" || true
fi

echo ""
echo "¡Instalación completada con éxito!"
echo "------------------------------------------"
echo "• Archivos instalados en : $INSTALL_DIR"
echo "• Comando de terminal   : $LAUNCHER_BIN"
echo "• Acceso de escritorio  : $DESKTOP_FILE"
echo ""
echo "Ya puedes abrir 'WhatsApp Web' desde tu menú de aplicaciones o ejecutar 'whatsapp-web-client' en tu terminal."
