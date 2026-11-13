# WhatsApp Web Client para Linux (C++ Nativo)

Cliente no oficial ultraligero de WhatsApp Web para Linux, compilado nativamente en C++17 sobre Qt6 (`Qt6Widgets`, `Qt6WebEngineWidgets` y `Qt6DBus`). Disenado para ofrecer la experiencia oficial completa con un ejecutable de ~335 KB, cero interpretes intermedios y el menor impacto posible en memoria RAM y CPU.

![WhatsApp Web Client Preview](whatsapp.svg)

---

## Caracteristicas

- **Arquitectura Nativa en C++ (Un Solo Proceso de Aplicacion)**:
  - Binario compilado con optimizacion `-O3 -flto` (~335 KB).
  - Integracion directa con `QDBusConnection` en el mismo hilo de eventos (sin subprocesos ni demonios secundarios).
  - Flags de GPU y bajo consumo para Chromium (`--enable-smooth-scrolling`, `--enable-gpu-rasterization`, `--enable-zero-copy`, `--ignore-gpu-blocklist`, `--ozone-platform-hint=auto`, `--enable-features=VaapiVideoDecoder,CanvasOopRasterization` y `--disable-features` para servicios innecesarios).
- **Modo Privacidad Dual (`Alt + B`)**:
  - **Pulsacion simple (`Tap < 500ms`)**: Activa o desactiva un desenfoque optico instantaneo de la interfaz mediante overlay CSS (`backdrop-filter`). La aplicacion sigue visible pero el texto se vuelve ilegible y se bloquea la entrada. No requiere PIN.
  - **Mantener presionado (`Hold >= 500ms`)**: Bloquea por completo la sesion con una capsula flotante frosted glass que solicita un PIN de seguridad numerico (hasheado con SHA-256 y persistente ante reinicios).
- **Confirmaciones de Lectura Bajo Demanda (`Alt + M`)**:
  - Modo incognito que bloquea el envio automatico de confirmaciones de lectura al abrir chats y solo las envia temporalmente al responder un mensaje.
- **Barra Lateral Redimensionable y Modo Compacto**:
  - Arrastra el borde derecho de la barra de chats para ajustar su ancho o usa el boton de la cabecera para minimizarla a una columna de solo fotos de perfil (`70px`).
- **Atajos de Chat, Rueda y Badges Geometricos (`Alt + 1..9`, `Alt + 0`, `Alt + Rueda`)**:
  - Mientras mantienes presionada la tecla `Alt`, se muestran insignias circulares verdes numeradas sobre el avatar de los primeros 10 chats visibles (ignorando la fila de Archivados).
  - Pulsar `Alt + 1..9` o `Alt + 0` salta de inmediato al chat correspondiente, y `Alt + Rueda del raton` avanza o retrocede entre chats.
- **Notificaciones DBus con Respuesta Rapida (Inline-Reply)**:
  - Soporte nativo para responder mensajes directamente desde la notificacion en KDE Plasma y entornos compatibles con `org.freedesktop.Notifications`.
  - Censura automatica del contenido de las notificaciones cuando la aplicacion esta bloqueada con PIN.
- **Bandeja del Sistema Dinamica (`QSystemTrayIcon`)**:
  - Acceso rapido a los ultimos 10 chats recientes, historial de descargas de la sesion, Modo No Molestar (silencia audio web y notificaciones), Modo Privacidad, Bloqueo y Configuracion de PIN.
- **Gestor de Descargas y Protocolo `whatsapp://`**:
  - Guarda archivos automaticamente en `~/Downloads/WhatsApp` evitando colisiones de nombres.
  - Manejo de enlaces externos en el navegador predeterminado y soporte para enlaces `whatsapp://`.

---

## Requisitos del Sistema

### Dependencias de ejecucion
- `qt6-base`
- `qt6-webengine`

### Dependencias de compilacion
- Compilador C++17 (`gcc` o `clang`)
- `cmake` y `ninja` (o `make`)

#### En Arch Linux / CachyOS / Manjaro / EndeavourOS:
```bash
sudo pacman -S --needed base-devel cmake ninja qt6-base qt6-webengine
```

#### En Debian / Ubuntu / Linux Mint:
```bash
sudo apt install build-essential cmake ninja-build qt6-base-dev qt6-webengine-dev
```

#### En Fedora:
```bash
sudo dnf install gcc-c++ cmake ninja-build qt6-qtbase-devel qt6-qtwebengine-devel
```

---

## Instalacion en Un Clic

### Metodo 1: Instalador Universal (`install.sh`)
Compila el binario nativo en modo Release (`-O3 -flto`), lo instala en `~/.local/bin/whatsapp-web-client` y registra el acceso directo en el menu de aplicaciones:
```bash
chmod +x install.sh
./install.sh
```
Para desinstalar en cualquier momento:
```bash
./install.sh --uninstall
```

### Metodo 2: Paquete Nativo de Arch Linux (`PKGBUILD`)
```bash
makepkg -sif
```

### Metodo 3: Compilacion manual con CMake
```bash
cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build
./build/whatsapp-web-client
```

---

## Atajos de Teclado

| Atajo | Accion |
| :--- | :--- |
| **`Alt + B` (Pulsar brevemente)** | Alternar modo privacidad rapido (desenfoque estetico sin PIN). |
| **`Alt + B` (Mantener presionado)** | Bloquear aplicacion con PIN de seguridad. |
| **`Alt + M`** | Activar/desactivar bloqueo de confirmaciones de lectura (modo incognito). |
| **`Alt` (Mantener presionado)** | Mostrar insignias numericas sobre los primeros 10 chats. |
| **`Alt + 1` .. `Alt + 9`** | Cambiar a los chats 1 al 9 de la lista lateral. |
| **`Alt + 0`** | Cambiar al chat 10. |
| **`Alt + Rueda del raton`** | Navegar al chat anterior o siguiente. |
| **`Ctrl + +` / `Ctrl + -`** | Aumentar o disminuir zoom. |
| **`Ctrl + 0`** | Restablecer zoom al 100%. |

> **Nota sobre corrector ortografico:** El corrector (`es-ES`, `en-US`) se habilita automaticamente si existen diccionarios `.bdic` en `/usr/share/qt6/qtwebengine_dictionaries`, junto al binario (`qtwebengine_dictionaries/`) o en la ruta definida por `QTWEBENGINE_DICTIONARIES_PATH`.

---

## Licencia
Distribuido bajo la licencia GPL-3.0.
