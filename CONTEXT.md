# CONTEXTO DEL PROYECTO: WhatsApp Web Client para Linux 💬🔒

> **Propósito de este documento:** Este archivo contiene el contexto técnico completo, arquitectura, inventario de archivos, estado actual de desarrollo y guía de empaquetado del proyecto. Puedes copiar o referenciar este archivo en cualquier nuevo chat o sesión para continuar el desarrollo sin perder información.

---

## 1. 📌 Información General y Stack Tecnológico

- **Nombre del proyecto:** `whatsapp-web-client`
- **Plataforma:** Linux (Universal: Arch, Debian, Ubuntu, Fedora, Manjaro, etc.)
- **Tecnologías principales:**
  - **Lenguaje:** Python 3.10+
  - **Framework GUI:** PyQt6 (Widgets y QtCore/QtGui)
  - **Motor Web:** `PyQt6.QtWebEngineWidgets` (`QWebEngineView`, Chromium integrado)
  - **Integración con Escritorio:** `dbus-python` y `python-gobject` (demonio DBus para notificaciones e inline-reply)
  - **Estilos:** QSS (Qt Style Sheets) para UI nativa + JS dinámico inyectado en el DOM de WhatsApp Web

---

## 2. 🚀 Características Implementadas

### A. Modo Privacidad Dual (`Alt + B`)
1. **Pulsación Corta (`Tap < 500ms`) - Boss Key:**
   - Aplica un efecto óptico `QGraphicsBlurEffect` sobre el `QWebEngineView`.
   - Vuelve el texto de los chats ilegible al instante sin bloquear la interfaz ni requerir PIN.
   - Pulsar de nuevo desactiva el desenfoque.
2. **Mantener Presionado (`Hold >= 500ms`) - Bloqueo con PIN:**
   - Despliega un overlay de pantalla completa con efecto *frosted glass*.
   - Muestra una cápsula flotante (*pill*) centrada con sombra profunda.
   - Solicita un PIN numérico (4 a 6 dígitos) censurado con viñetas (`●●●●`).
   - El PIN se almacena hasheado con **SHA-256** en `~/.local/share/WhatsAppWebClient/config.json`.
   - Incluye animación de vibración en caso de PIN incorrecto.
3. **Diálogo Instructivo Inicial (`PrivacyInstructionDialog`):**
   - Diálogo flotante sin bordes (*frameless*, estilo oscuro moderno de WhatsApp).
   - Explica la diferencia entre pulsar y mantener `Alt + B`.
   - Incluye casilla *"No volver a mostrar este mensaje"* (guardada en configuración) y botón "OK" enfocado por defecto.

### B. Atajos de Teclado y Badges Numéricos (`Alt + 1..9`, `Alt + 0`)
1. **Salto Rápido a Chats:**
   - `Alt + 1` al `Alt + 9`: Salta a los chats 1 al 9 de la lista lateral visible.
   - `Alt + 0`: Salta al chat 10.
   - **Exclusión inteligente:** Ignora por completo el botón/pestaña de *Archivados*, seleccionando únicamente conversaciones reales.
2. **Badges Visuales sobre Avatares:**
   - Mientras la tecla `Alt` se mantiene presionada, se inyectan en el DOM insignias circulares verdes numeradas (1 al 10) directamente sobre los avatares de los chats correspondientes.
   - Al soltar la tecla `Alt`, los badges se ocultan automáticamente.
   - Si se presiona un número, los badges permanecen visibles mientras `Alt` siga presionado.

### C. Bandeja del Sistema e Integración Linux
1. **Bandeja (`QSystemTrayIcon`):**
   - Menú contextual limpio: *Chats recientes, Descargas de la sesión, Abrir carpeta de descargas, Mostrar, Modo No Molestar (DND), Modo Privacidad, Bloquear app, Configurar PIN, Salir*.
2. **Modo No Molestar (DND):**
   - Silencia el audio web de la pestaña Chromium y bloquea las notificaciones de escritorio.
3. **Notificaciones DBus (`dbus_daemon.py`):**
   - Notificaciones nativas del sistema con soporte para respuesta rápida (*inline-reply*) en KDE Plasma y otros entornos compatibles.
4. **Gestor de Descargas:**
   - Captura eventos de descarga y los guarda automáticamente en `~/Downloads/WhatsApp/`, evitando nombres duplicados y mostrando aviso de confirmación.
5. **Manejo de Enlaces:**
   - Soporte registrado para el protocolo `whatsapp://`.

---

## 3. 📂 Inventario de Archivos del Proyecto

| Archivo | Rol y Descripción |
| :--- | :--- |
| [`main.py`](file:///home/hex/whatsapp-web-client/main.py) | **Archivo principal**. Ventana principal, QWebEngine, atajos de teclado, inyección JS, gestión de badges con Alt, bandeja del sistema, descargas y zoom. |
| [`lock_overlay.py`](file:///home/hex/whatsapp-web-client/lock_overlay.py) | **Overlay de Bloqueo por PIN**. Maneja la cápsula flotante (*pill*), validación SHA-256, diálogo de configuración de PIN y diálogo instructivo de privacidad. |
| [`config_manager.py`](file:///home/hex/whatsapp-web-client/config_manager.py) | **Gestor de Configuración**. Rutas de usuario, persistencia en `config.json` y gestión de hashing SHA-256 del PIN. |
| [`dbus_daemon.py`](file:///home/hex/whatsapp-web-client/dbus_daemon.py) | **Demonio DBus**. Proceso secundario en segundo plano para notificaciones de escritorio e inline-reply. |
| [`style.css`](file:///home/hex/whatsapp-web-client/style.css) | **Estilos QSS/CSS**. Reglas de estilizado estructural y scrollbar. |
| [`whatsapp.svg`](file:///home/hex/whatsapp-web-client/whatsapp.svg) | **Icono vectorial**. Utilizado para el lanzador, la ventana y la bandeja. |
| [`install.sh`](file:///home/hex/whatsapp-web-client/install.sh) | **Instalador Universal**. Copia la app a `~/.local/share/whatsapp-web-client/`, crea el lanzador `.desktop` y binario en `~/.local/bin/`. |
| [`PKGBUILD`](file:///home/hex/whatsapp-web-client/PKGBUILD) | **Receta Arch Linux**. Para compilar paquetes `.pkg.tar.zst` mediante `makepkg`. |
| [`launcher.sh`](file:///home/hex/whatsapp-web-client/launcher.sh) | **Lanzador Shell**. Script wrapper para `/usr/bin/whatsapp-web-client`. |
| [`whatsapp-web-client.desktop`](file:///home/hex/whatsapp-web-client/whatsapp-web-client.desktop) | **Entrada Desktop XDG**. Acceso directo para el menú de aplicaciones del sistema. |
| [`README.md`](file:///home/hex/whatsapp-web-client/README.md) | **Documentación**. Manual de usuario, atajos y requisitos del sistema. |

---

## 4. 📦 Empaquetado y Distribución

### Opción A: Tarball Universal (`whatsapp.tar.gz`) con `install.sh` (Recomendado)
Permite instalar la aplicación en **cualquier distribución Linux** de forma limpia y permanente en el espacio de usuario (`~/.local/share/whatsapp-web-client`).

#### 1. Crear el paquete tar:
```bash
tar --exclude='venv' \
    --exclude='__pycache__' \
    --exclude='pkg' \
    --exclude='src' \
    --exclude='scratch' \
    --exclude='*.pkg.tar.zst' \
    -czvf whatsapp.tar.gz \
    main.py lock_overlay.py config_manager.py dbus_daemon.py \
    style.css whatsapp.svg whatsapp-web-client.desktop install.sh launcher.sh \
    README.md CONTEXT.md
```

#### 2. Instrucciones para la persona que recibe el paquete:
1. Instalar las dependencias de su distribución:
   - **Debian / Ubuntu / Mint:** `sudo apt install python3 python3-pyqt6 python3-pyqt6.qtwebengine python3-dbus python3-gi`
   - **Fedora:** `sudo dnf install python3 python3-pyqt6 python3-pyqt6-webengine python3-dbus python3-gobject`
   - **Arch / Manjaro:** `sudo pacman -S python python-pyqt6 python-pyqt6-webengine python-dbus python-gobject`
2. Descomprimir y ejecutar el instalador:
   ```bash
   tar -xzvf whatsapp.tar.gz
   cd whatsapp-web-client   # (o la carpeta donde se descomprima)
   ./install.sh
   ```
   *El instalador copia los archivos a `~/.local/share/whatsapp-web-client`, instala el comando en `~/.local/bin/whatsapp-web-client` y genera el acceso directo en el menú de aplicaciones.*

---

### Opción B: Paquete Nativo de Arch Linux (`.pkg.tar.zst`)
Para usuarios de Arch Linux, Manjaro, EndeavourOS:
1. Compilar: `makepkg -f`
2. Instalar el paquete generado: `sudo pacman -U whatsapp-web-client-1.0.0-*-any.pkg.tar.zst`

---

## 5. 🛠️ Tareas Pendientes y Próximos Pasos

1. **[COMPLETADO] Alineación Robusta de Badges con `Alt`:**
   - Implementado algoritmo geométrico basado en el centro exacto `(cx, cy)` del avatar real.
   - Manejo consistente para: fotos estándar (`img`), contactos sin foto (SVG), grupos sin foto, anillos de historias/estados y chats con mensajes temporales. Anclado fijo a la esquina superior izquierda (`-3px`).

2. **Persistencia del Estado de Bloqueo por PIN:**
   - Al bloquear la app con PIN, guardar un flag (`locked = true`) en `~/.local/share/WhatsAppWebClient/config.json`.
   - Al iniciar la app (incluso tras un reinicio forzado o `kill -9`), verificar si el estado estaba bloqueado y arrancar directamente con el overlay de bloqueo activo antes de mostrar cualquier contenido.
   - Prevenir el cierre accidental de la ventana mientras el bloqueo esté activo.

3. **Diagnóstico y Optimización de Rendimiento:**
   - Una vez finalizada la parte funcional, auditar el consumo de memoria RAM y CPU del proceso `QtWebEngineProcess`.
   - Ajustar banderas de Chromium (`--disable-gpu-shader-disk-cache`, límites de caché, gestión de suspensiones en segundo plano) para lograr un consumo mínimo de recursos.
