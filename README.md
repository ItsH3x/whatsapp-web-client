# WhatsApp Web Client para Linux 💬🔒

Cliente no oficial de WhatsApp para Linux desarrollado con **Python** y **PyQt6 (QtWebEngine)**.

![WhatsApp Web Client Preview](whatsapp.svg)

---

## ✨ Características

- 🛡️ **Modo Privacidad Dual (`Alt + B`)**:
  - **Pulsación simple (`Tap < 500ms`)**: Activa/desactiva un desenfoque óptico instantáneo de la interfaz (Boss Key). La app sigue pareciendo WhatsApp pero el texto se vuelve ilegible. No pide PIN.
  - **Mantener presionado (`Hold >= 500ms`)**: Bloquea por completo la sesión con una *cápsula flotante (pill) frosted glass* que solicita un PIN de seguridad censurado (`●●●●`).
- 🔕 **Modo No Molestar (DND)**: Silencia tanto las notificaciones de escritorio como el audio web de la aplicación.
- 📬 **Notificaciones e Integración con Bandeja**:
  - Demonio DBus dedicado con soporte para respuesta rápida (*inline-reply*) en KDE y otros escritorios compatibles.
  - Menú de bandeja con acceso directo a chats recientes y descargas.
- 📥 **Gestor de Descargas**: Guarda archivos ordenadamente en `~/Downloads/WhatsApp` con aviso de completado.
- 🔗 **Manejo de Enlaces `whatsapp://`**: Integración con el sistema para abrir chats y enlaces directos.
- 🔍 **Zoom y Atajos**:
  - `Alt + 1..9` / `Alt + 0`: Salto directo a los primeros chats.
  - `Ctrl + +`, `Ctrl + -`, `Ctrl + 0`: Ajustes de escala y zoom.

---

## 📦 Requisitos del Sistema

### Dependencias base
- Python 3.10+
- PyQt6 y PyQt6-WebEngine
- dbus-python y PyGObject

#### En Arch Linux / Manjaro / EndeavourOS:
```bash
sudo pacman -S python python-pyqt6 python-pyqt6-webengine python-dbus python-gobject
```

#### En Debian / Ubuntu / Linux Mint:
```bash
sudo apt install python3 python3-pyqt6 python3-pyqt6.qtwebengine python3-dbus python3-gi
```

#### En Fedora:
```bash
sudo dnf install python3 python3-pyqt6 python3-pyqt6-webengine python3-dbus python3-gobject
```

---

## 🚀 Instalación

### Método 1: Arch Linux (Recomendado vía PKGBUILD)
Clona el repositorio y compila/instala con `makepkg`:
```bash
git clone https://github.com/ItsH3x/whatsapp-web-client.git
cd whatsapp-web-client
makepkg -sif
```

### Método 2: Instalación local / Cualquier distribución (`install.sh`)
Crea el lanzador `.desktop` en tu usuario (`~/.local/share/applications`):
```bash
git clone https://github.com/ItsH3x/whatsapp-web-client.git
cd whatsapp-web-client
chmod +x install.sh
./install.sh
```

### Método 3: Ejecutar directamente sin instalar
```bash
python3 main.py
```

---

## ⌨️ Atajos de Teclado

| Atajo | Acción |
| :--- | :--- |
| **`Alt + B` (Pulsar brevemente)** | Alternar modo privacidad rápido (desenfoque estético sin PIN). |
| **`Alt + B` (Mantener presionado)** | Bloquear aplicación con PIN de seguridad. |
| **`Alt + 1` .. `Alt + 9`** | Cambiar a los chats 1 al 9 de la lista lateral. |
| **`Alt + 0`** | Cambiar al chat 10. |
| **`Ctrl + +` / `Ctrl + -`** | Aumentar o disminuir zoom. |
| **`Ctrl + 0`** | Restablecer zoom al 100%. |

---

## 🔒 Configuración del PIN
- La primera vez que mantengas `Alt + B`, la cápsula flotante te pedirá registrar tu PIN (4 a 6 dígitos).
- El PIN se almacena hasheado con SHA-256 en `~/.local/share/WhatsAppWebClient/config.json`.
- Para cambiarlo en cualquier momento: Clic derecho en el icono de la bandeja ➔ **Configurar PIN de seguridad...**.

---

## 📄 Licencia
Distribuido bajo la licencia GPL-3.0. Consulta el archivo de licencia para más detalles.
