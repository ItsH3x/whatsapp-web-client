# WhatsApp Web Client para Linux

Cliente no oficial de WhatsApp para Linux desarrollado con Python y PyQt6 (QtWebEngine).

![WhatsApp Web Client Preview](whatsapp.svg)

---

## Caracteristicas

- **Modo Privacidad Dual (`Alt + B`)**:
  - **Pulsacion simple (`Tap < 500ms`)**: Activa o desactiva un desenfoque optico instantaneo de la interfaz (Boss Key). La aplicacion sigue visible pero el texto se vuelve ilegible. No requiere PIN.
  - **Mantener presionado (`Hold >= 500ms`)**: Bloquea por completo la sesion con una capsula flotante frosted glass que solicita un PIN de seguridad numerico.
- **Modo No Molestar (DND)**: Silencia tanto las notificaciones de escritorio como el audio web de la aplicacion.
- **Notificaciones e Integracion con Bandeja**:
  - Demonio DBus dedicado con soporte para respuesta rapida (inline-reply) en KDE y otros escritorios compatibles.
  - Menu de bandeja con acceso directo a chats recientes y descargas.
- **Gestor de Descargas**: Guarda archivos ordenadamente en `~/Downloads/WhatsApp` con aviso de completado.
- **Manejo de Enlaces `whatsapp://`**: Integracion con el sistema para abrir chats y enlaces directos.
- **Zoom y Atajos**:
  - `Alt + 1..9` / `Alt + 0`: Salto directo a los primeros chats de la lista lateral con insignias numericas visuales.
  - `Ctrl + +`, `Ctrl + -`, `Ctrl + 0`: Ajustes de escala y zoom.

---

## Requisitos del Sistema

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

## Instalacion

### Metodo 1: Arch Linux (Recomendado via PKGBUILD)
Clona el repositorio y compila o instala con `makepkg`:
```bash
git clone https://github.com/ItsH3x/whatsapp-web-client.git
cd whatsapp-web-client
makepkg -sif
```

### Metodo 2: Instalacion universal (`install.sh`)
Verifica dependencias automaticamente y crea el comando y lanzador de escritorio:
```bash
git clone https://github.com/ItsH3x/whatsapp-web-client.git
cd whatsapp-web-client
chmod +x install.sh
./install.sh
```

### Metodo 3: Ejecutar directamente sin instalar
```bash
python3 main.py
```

---

## Atajos de Teclado

| Atajo | Accion |
| :--- | :--- |
| **`Alt + B` (Pulsar brevemente)** | Alternar modo privacidad rapido (desenfoque estetico sin PIN). |
| **`Alt + B` (Mantener presionado)** | Bloquear aplicacion con PIN de seguridad. |
| **`Alt + 1` .. `Alt + 9`** | Cambiar a los chats 1 al 9 de la lista lateral. |
| **`Alt + 0`** | Cambiar al chat 10. |
| **`Ctrl + +` / `Ctrl + -`** | Aumentar o disminuir zoom. |
| **`Ctrl + 0`** | Restablecer zoom al 100%. |

---

## Configuracion del PIN
- La primera vez que mantengas `Alt + B`, la capsula flotante solicitara registrar tu PIN (4 a 6 digitos).
- El PIN se almacena hasheado con SHA-256 en `~/.local/share/WhatsAppWebClient/config.json`.
- Para cambiarlo en cualquier momento: Clic derecho en el icono de la bandeja -> **Configurar PIN**.

---

## Licencia
Distribuido bajo la licencia GPL-3.0. Consulta el archivo de licencia para mas detalles.
