#!/bin/bash
set -e

# Directorios de destino estandar XDG
TARGET_DIR="$HOME/.local/share/whatsapp-web-client"
APPS_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons/hicolor/scalable/apps"
BIN_DIR="$HOME/.local/bin"
DESKTOP_FILE="$APPS_DIR/whatsapp-web.desktop"
LAUNCHER_BIN="$BIN_DIR/whatsapp-web-client"

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Manejo de desinstalacion
if [ "$1" = "--uninstall" ] || [ "$1" = "-u" ]; then
    echo "Desinstalando WhatsApp Web Client..."
    rm -rf "$TARGET_DIR"
    rm -f "$DESKTOP_FILE"
    rm -f "$LAUNCHER_BIN"
    rm -f "$ICON_DIR/whatsapp-web-client.svg"
    if command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database "$APPS_DIR" || true
    fi
    echo "Desinstalacion completada con exito."
    exit 0
fi

echo "=========================================="
echo " Instalador de WhatsApp Web Client (C++)"
echo "=========================================="

# Funcion para verificar herramientas de compilacion y librerias Qt6
check_dependencies() {
    local missing_deps=()
    command -v cmake >/dev/null 2>&1 || missing_deps+=("cmake")
    command -v c++ >/dev/null 2>&1 || missing_deps+=("c++ compiler")
    if command -v pkg-config >/dev/null 2>&1; then
        pkg-config --exists Qt6Widgets || missing_deps+=("Qt6Widgets")
        pkg-config --exists Qt6WebEngineWidgets || missing_deps+=("Qt6WebEngineWidgets")
        pkg-config --exists Qt6DBus || missing_deps+=("Qt6DBus")
    fi

    if [ ${#missing_deps[@]} -eq 0 ]; then
        return 0
    fi

    echo ""
    echo "ADVERTENCIA: Faltan dependencias necesarias del sistema: ${missing_deps[*]}"
    echo ""

    local install_cmd=""
    if command -v pacman >/dev/null 2>&1; then
        install_cmd="sudo pacman -S --needed base-devel cmake ninja qt6-base qt6-webengine"
    elif command -v apt-get >/dev/null 2>&1; then
        install_cmd="sudo apt-get update && sudo apt-get install -y build-essential cmake ninja-build qt6-base-dev qt6-webengine-dev"
    elif command -v dnf >/dev/null 2>&1; then
        install_cmd="sudo dnf install -y gcc-c++ cmake ninja-build qt6-qtbase-devel qt6-qtwebengine-devel"
    elif command -v zypper >/dev/null 2>&1; then
        install_cmd="sudo zypper install -y gcc-c++ cmake ninja qt6-base-devel qt6-webengine-devel"
    fi

    if [ -n "$install_cmd" ]; then
        if [ -t 0 ]; then
            read -p "Deseas instalar las dependencias automaticamente ahora? [S/n]: " ans
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
        echo "Por favor instala manualmente los paquetes correspondientes para tu distribucion:"
        echo "  - C++17 compiler (GCC o Clang), CMake"
        echo "  - Qt6 Base y Qt6 WebEngine (headers de desarrollo)"
    fi
    echo ""
    echo "Instalacion cancelada debido a dependencias faltantes."
    exit 1
}

check_dependencies

echo "[1/3] Compilando binario nativo en C++ (Release -O3 -flto)..."
BUILD_DIR="$SOURCE_DIR/build"
DESIRED_GEN="Unix Makefiles"
if command -v ninja >/dev/null 2>&1; then
    DESIRED_GEN="Ninja"
fi
if [ -f "$BUILD_DIR/CMakeCache.txt" ]; then
    CACHED_GEN=$(grep -m1 '^CMAKE_GENERATOR:INTERNAL=' "$BUILD_DIR/CMakeCache.txt" | cut -d= -f2-)
    if [ -n "$CACHED_GEN" ] && [ "$CACHED_GEN" != "$DESIRED_GEN" ]; then
        rm -rf "$BUILD_DIR/CMakeCache.txt" "$BUILD_DIR/CMakeFiles"
    fi
fi
if [ "$DESIRED_GEN" = "Ninja" ]; then
    cmake -B "$BUILD_DIR" -S "$SOURCE_DIR" -G Ninja -DCMAKE_BUILD_TYPE=Release
else
    cmake -B "$BUILD_DIR" -S "$SOURCE_DIR" -DCMAKE_BUILD_TYPE=Release
fi
cmake --build "$BUILD_DIR" --parallel
cp -f "$BUILD_DIR/whatsapp-web-client" "$SOURCE_DIR/whatsapp-web-client"
chmod +x "$SOURCE_DIR/whatsapp-web-client"

if [ "$1" = "--build-only" ]; then
    rm -rf "$BUILD_DIR"
    echo "Binario compilado listo en: $SOURCE_DIR/whatsapp-web-client"
    exit 0
fi

echo "[2/3] Instalando binario y recursos en el espacio de usuario..."
mkdir -p "$TARGET_DIR" "$APPS_DIR" "$ICON_DIR" "$BIN_DIR"

install -m755 "$BUILD_DIR/whatsapp-web-client" "$LAUNCHER_BIN"
install -m644 "$SOURCE_DIR/whatsapp.svg" "$TARGET_DIR/whatsapp.svg"
install -m644 "$SOURCE_DIR/whatsapp.svg" "$ICON_DIR/whatsapp-web-client.svg"
rm -rf "$BUILD_DIR"

echo "[3/3] Registrando acceso directo e integracion de escritorio..."
cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Version=1.0
Name=WhatsApp Web
Comment=Cliente nativo ultraligero de WhatsApp Web
Exec=$LAUNCHER_BIN %U
Icon=$TARGET_DIR/whatsapp.svg
Terminal=false
Type=Application
StartupWMClass=whatsapp-web
Categories=Network;InstantMessaging;
Keywords=whatsapp;chat;im;messaging;
MimeType=x-scheme-handler/whatsapp;
EOF

chmod 644 "$DESKTOP_FILE"

if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$APPS_DIR" || true
fi

if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
fi

if command -v xdg-mime >/dev/null 2>&1; then
    xdg-mime default whatsapp-web.desktop x-scheme-handler/whatsapp || true
fi

echo ""
echo "=========================================="
echo " Instalacion completada con exito"
echo "=========================================="
echo "Binario instalado en: $LAUNCHER_BIN"
echo "Lanzador de escritorio: $DESKTOP_FILE"
echo "Para desinstalar ejecuta: ./install.sh --uninstall"
