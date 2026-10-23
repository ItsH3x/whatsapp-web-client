import sys
import os

# Optimizacion de banderas de Chromium para QtWebEngine:
# - renderer-process-limit=1: Consolida renderers para evitar procesos duplicados
# - disable-gpu-shader-disk-cache: Evita escrituras continuas de cache de shaders en disco
# - max-old-space-size=384: Dispara Garbage Collection de V8 si la memoria JS supera 384 MB
# - disable-features: Desactiva subsistemas de Chromium innecesarios para WhatsApp
chromium_flags = [
    "--renderer-process-limit=1",
    "--disable-gpu-shader-disk-cache",
    '--js-flags="--max-old-space-size=384"',
    "--disable-features=EyeDropper,InstalledApp,WebOTP,WebPayments,WebUSB,BackgroundFetch",
]
existing_flags = os.environ.get("QTWEBENGINE_CHROMIUM_FLAGS", "")
os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = f"{existing_flags} {' '.join(chromium_flags)}".strip()

import json
import tempfile
from datetime import datetime
from PyQt6.QtCore import QUrl, Qt, QProcess, QTimer, QEvent, QSettings
from PyQt6.QtGui import QIcon, QAction, QKeySequence, QWheelEvent, QDesktopServices
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QSystemTrayIcon, QMenu, QGraphicsBlurEffect,
    QDialog, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QCheckBox
)
from PyQt6.QtWebEngineWidgets import QWebEngineView
from PyQt6.QtWebEngineCore import QWebEngineProfile, QWebEnginePage


from lock_overlay import LockOverlay, PinConfigDialog


class PrivacyInstructionDialog(QDialog):
    """Diálogo instructivo que explica cómo usar los atajos de teclado Alt+B para privacidad y bloqueo."""
    
    def __init__(self, parent=None, mode="privacy"):
        super().__init__(parent)
        self.mode = mode
        self.setWindowFlags(Qt.WindowType.FramelessWindowHint | Qt.WindowType.Dialog)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.setFixedWidth(460)
        self.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose, True)
        
        # Estilo oscuro moderno consistente con WhatsApp
        self.setStyleSheet("""
            QDialog {
                background-color: #111b21;
                border: 1px solid rgba(255, 255, 255, 0.15);
                border-radius: 14px;
            }
            QLabel {
                color: #e9edef;
                font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
            }
            QCheckBox {
                color: #8696a0;
                font-size: 13px;
                spacing: 8px;
            }
            QCheckBox::indicator {
                width: 18px;
                height: 18px;
                border: 1.5px solid #8696a0;
                border-radius: 4px;
                background: transparent;
            }
            QCheckBox::indicator:checked {
                background-color: #00a884;
                border-color: #00a884;
            }
            QPushButton#btnOk {
                background-color: #00a884;
                color: #ffffff;
                font-weight: 700;
                font-size: 13px;
                border: none;
                border-radius: 6px;
                padding: 8px 24px;
                min-width: 80px;
            }
            QPushButton#btnOk:hover {
                background-color: #02906f;
            }
            QPushButton#btnOk:focus {
                border: 2px solid #ffffff;
            }
        """)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(24, 22, 24, 20)
        layout.setSpacing(14)

        title_text = "Modo Privacidad activado" if mode == "privacy" else "Bloqueo de app activado"
        lbl_title = QLabel(f"<h3 style='margin:0; color:#00a884; font-size:16px;'>{title_text}</h3>", self)
        layout.addWidget(lbl_title)

        msg_html = """
        <p style='color:#e9edef; font-size:13px; line-height:1.5; margin:0;'>
        Puedes controlar rápidamente estas funciones usando tu teclado:
        </p>
        <div style='background:rgba(255,255,255,0.06); padding:10px 14px; border-radius:8px; margin-top:4px;'>
            <p style='margin:0 0 6px 0; font-size:13px; color:#e9edef;'>
                <b style='color:#00a884;'>Pulsar Alt + B:</b> Activa o desactiva el <i>Modo Privacidad</i> (desenfoque rápido sin PIN).
            </p>
            <p style='margin:0; font-size:13px; color:#e9edef;'>
                <b style='color:#00a884;'>Mantener Alt + B:</b> Bloquea la app con tu <i>PIN de seguridad</i>.
            </p>
        </div>
        """
        lbl_msg = QLabel(msg_html, self)
        lbl_msg.setWordWrap(True)
        layout.addWidget(lbl_msg)

        self.chk_dont_show = QCheckBox("No volver a mostrar este mensaje", self)
        layout.addWidget(self.chk_dont_show)

        btn_layout = QHBoxLayout()
        btn_layout.addStretch()
        self.btn_ok = QPushButton("OK", self)
        self.btn_ok.setObjectName("btnOk")
        self.btn_ok.setDefault(True)
        self.btn_ok.clicked.connect(self.accept)
        btn_layout.addWidget(self.btn_ok)
        layout.addLayout(btn_layout)

        # El botón OK tiene el focus por default
        self.btn_ok.setFocus()

    def accept(self):
        if self.chk_dont_show.isChecked():
            settings = QSettings("WhatsAppWebClient", "WhatsAppWebClient")
            settings.setValue("hide_privacy_instructions", True)
        super().accept()


class WhatsAppPage(QWebEnginePage):
    """Subclase de QWebEnginePage que intercepta links externos y los abre en el navegador del sistema."""
    
    def acceptNavigationRequest(self, url, nav_type, is_main_frame):
        # Solo interceptar clics del usuario en el frame principal
        if nav_type == QWebEnginePage.NavigationType.NavigationTypeLinkClicked and is_main_frame:
            host = url.host()
            if host and "whatsapp.com" not in host and "whatsapp.net" not in host:
                QDesktopServices.openUrl(url)
                return False
        return super().acceptNavigationRequest(url, nav_type, is_main_frame)
    
    def createWindow(self, window_type):
        # Cuando WhatsApp intenta abrir una ventana nueva (target="_blank"),
        # creamos una página temporal que intercepta la URL y la abre en el navegador.
        temp_page = QWebEnginePage(self.profile(), self)
        temp_page.urlChanged.connect(lambda url: self._handle_new_window_url(url, temp_page))
        return temp_page
    
    def _handle_new_window_url(self, url, temp_page):
        if url.isValid() and url.scheme() in ("http", "https"):
            QDesktopServices.openUrl(url)
        temp_page.deleteLater()

class WhatsAppClient(QMainWindow):
    def __init__(self):
        super().__init__()

        self.setWindowTitle("WhatsApp Web")
        self.resize(1024, 768)

        # Configurar el icono de la ventana
        icon_path = os.path.join(os.path.dirname(__file__), "whatsapp.svg")
        if os.path.exists(icon_path):
            self.setWindowIcon(QIcon(icon_path))

        # Configurar QWebEngineView
        self.browser = QWebEngineView(self)

        # Configurar Perfil Persistente (Para guardar la sesión)
        profile = QWebEngineProfile("WhatsAppProfile", self)
        
        # Detectar el idioma del sistema y configurarlo para que WhatsApp cargue en ese idioma
        lang_env = os.environ.get('LANG', 'en_US.UTF-8')
        sys_lang = lang_env.split('.')[0].replace('_', '-') # Convierte 'es_ES.UTF-8' a 'es-ES'
        profile.setHttpAcceptLanguage(f"{sys_lang},{sys_lang.split('-')[0]};q=0.9,en-US;q=0.8,en;q=0.7")
        
        # Engañar a WhatsApp haciéndole creer que somos la versión más reciente de Google Chrome
        profile.setHttpUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        
        storage_path = os.path.expanduser("~/.local/share/WhatsAppWebClient")
        profile.setPersistentStoragePath(storage_path)
        profile.setPersistentCookiesPolicy(QWebEngineProfile.PersistentCookiesPolicy.ForcePersistentCookies)
        
        # Limitar la cache HTTP en disco a 80 MB para evitar saturacion de I/O y memoria
        profile.setHttpCacheType(QWebEngineProfile.HttpCacheType.DiskHttpCache)
        profile.setHttpCacheMaximumSize(80 * 1024 * 1024)
        
        # Corrector Ortográfico Nativo
        profile.setSpellCheckEnabled(True)
        profile.setSpellCheckLanguages(["es-ES", "en-US"])
        
        # Configurar QWebEngineView con el perfil (usando nuestra subclase para links externos)
        page = WhatsAppPage(profile, self.browser)
        self.browser.setPage(page)
        self.setCentralWidget(self.browser)
        
        # Permitir notificaciones web automáticamente
        page.featurePermissionRequested.connect(self.grant_feature_permission)
        
        # Interceptar notificaciones para enviarlas a DBus con soporte Inline-Reply
        profile.setNotificationPresenter(self.handle_notification)
        
        # Gestor de descargas
        self.download_dir = os.path.expanduser("~/Downloads/WhatsApp")
        os.makedirs(self.download_dir, exist_ok=True)
        self.session_downloads = []  # Lista de descargas de esta sesión
        self._active_downloads = set() # Retener referencias vivas para evitar Garbage Collection
        profile.downloadRequested.connect(self.handle_download)
        
        # Iniciar demonio de notificaciones persistente
        self.dbus_daemon = QProcess(self)
        daemon_script = os.path.join(os.path.dirname(__file__), "dbus_daemon.py")
        self.dbus_daemon.start(sys.executable, [daemon_script])
        self.dbus_daemon.readyReadStandardOutput.connect(self.on_daemon_stdout)
        
        # Conectar el evento de carga para inyectar badges de atajos
        page.loadFinished.connect(self.on_page_loaded)


        # Cargar WhatsApp Web
        self.browser.setUrl(QUrl("https://web.whatsapp.com"))

        # Configurar la bandeja del sistema
        self.tray_icon = QSystemTrayIcon(self)
        if os.path.exists(icon_path):
            self.tray_icon.setIcon(QIcon(icon_path))
        
        # Lista de chats recientes para el menú de la bandeja
        self.recent_chats = []
        
        # Menú de la bandeja (se reconstruye dinámicamente)
        self.tray_menu = QMenu()
        self.tray_icon.setContextMenu(self.tray_menu)
        self.tray_menu.aboutToShow.connect(self.build_tray_menu)
        self.tray_icon.show()

        # Al hacer clic en el icono de la bandeja, mostrar u ocultar la ventana
        self.tray_icon.activated.connect(self.tray_activated)

        # Configurar Zoom (Atajos de Teclado)
        self.setup_zoom()
        
        # Configurar atajos de cambio rápido de chat (Alt+1..9, Alt+0)
        self.setup_chat_shortcuts()

        # Estado inicial
        self.dnd_mode = False
        
        # Overlay de bloqueo con PIN y efecto Blur (Pill flotante)
        self.lock_overlay = LockOverlay(self)
        self.lock_overlay.locked.connect(self._on_app_locked)
        self.lock_overlay.unlocked.connect(self._on_app_unlocked)
        
        # Atajo de bloqueo de aplicación (Alt+B)
        self.setup_privacy_shortcut()

    def grant_feature_permission(self, url, feature):
        # Otorgar todos los permisos que WhatsApp solicite (notificaciones, micrófono, cámara, etc.)
        self.browser.page().setFeaturePermission(url, feature, QWebEnginePage.PermissionPolicy.PermissionGrantedByUser)

    def scrape_recent_chats(self):
        """Inyecta JavaScript para leer los últimos 10 chats de la lista lateral de WhatsApp Web."""
        self.init_chat_helpers()
        js = """
        (function() {
            var chats = [];
            var validChats = (window.__waGetValidChats) ? window.__waGetValidChats() : [];
            if (!validChats.length) {
                var pane = document.getElementById('pane-side');
                if (!pane) return JSON.stringify(chats);
                validChats = pane.querySelectorAll('[role="listitem"]');
            }
            
            var count = Math.min(validChats.length, 10);
            for (var i = 0; i < count; i++) {
                var row = validChats[i];
                var titleEl = row.querySelector('span[title]');
                var lastMsgEl = row.querySelector('span[data-testid="last-msg-status"]');
                if (!lastMsgEl) {
                    lastMsgEl = row.querySelector('span.matched-text') ||
                                row.querySelector('div[data-testid="cell-frame-secondary"] span span');
                }
                if (titleEl) {
                    chats.push({
                        name: titleEl.getAttribute('title'),
                        lastMsg: lastMsgEl ? lastMsgEl.textContent.substring(0, 50) : ''
                    });
                }
            }
            return JSON.stringify(chats);
        })();
        """
        self.browser.page().runJavaScript(js, self._on_chats_scraped)
    
    def _on_chats_scraped(self, result):
        """Callback que recibe el JSON con los chats recientes."""
        if result:
            try:
                self.recent_chats = json.loads(result)
            except (json.JSONDecodeError, TypeError):
                pass

    def _update_recent_chat(self, name, message):
        """Actualizacion reactiva: coloca el chat que recibio mensaje al tope de la lista."""
        if not name:
            return
        clean_name = name.strip()
        # Filtrar el chat si ya existia para reinsertarlo en la primera posicion
        self.recent_chats = [c for c in self.recent_chats if c.get("name") != clean_name]
        self.recent_chats.insert(0, {
            "name": clean_name,
            "lastMsg": message.strip()[:50] if message else ""
        })
        if len(self.recent_chats) > 10:
            self.recent_chats = self.recent_chats[:10]
    
    def build_tray_menu(self):
        """Reconstruye el menú de la bandeja con los chats recientes."""
        self.tray_menu.clear()
        
        # Si la lista esta vacia, intentar una lectura bajo demanda
        if not self.recent_chats:
            self.scrape_recent_chats()
        
        if self.recent_chats:
            # Submenú de chats recientes
            chats_menu = self.tray_menu.addMenu("Chats recientes")
            for chat in self.recent_chats:
                name = chat.get("name", "???")
                last_msg = chat.get("lastMsg", "")
                label = f"{name}"
                if last_msg:
                    label += f"  ·  {last_msg}"
                action = chats_menu.addAction(label)
                # Closure para capturar el nombre del chat
                action.triggered.connect(lambda checked, n=name: self.open_chat(n))
            
            self.tray_menu.addSeparator()
        


        # Submenú de Descargas de esta sesión
        if self.session_downloads:
            downloads_menu = self.tray_menu.addMenu(f"Descargas ({len(self.session_downloads)})")
            for dl in reversed(self.session_downloads[-15:]):  # Últimas 15, más reciente primero
                fname = dl.get("filename", "???")
                size_mb = dl.get("size_mb", "?")
                time_str = dl.get("time", "")
                label = f"{fname}  ({size_mb} MB · {time_str})"
                dl_action = downloads_menu.addAction(label)
                dl_path = dl.get("path", "")
                dl_action.triggered.connect(lambda checked, p=dl_path: QDesktopServices.openUrl(QUrl.fromLocalFile(p)))
            
            downloads_menu.addSeparator()
            open_folder_action = downloads_menu.addAction("Abrir carpeta de descargas")
            open_folder_action.triggered.connect(lambda: QDesktopServices.openUrl(QUrl.fromLocalFile(self.download_dir)))
            
            self.tray_menu.addSeparator()

        show_action = QAction("Mostrar", self)
        show_action.triggered.connect(self.show)
        self.tray_menu.addAction(show_action)

        dnd_action = QAction("Modo no molestar", self)
        dnd_action.setCheckable(True)
        dnd_action.setChecked(getattr(self, "dnd_mode", False))
        dnd_action.triggered.connect(self.toggle_dnd_mode)
        self.tray_menu.addAction(dnd_action)

        privacy_action = QAction("Modo privacidad", self)
        privacy_action.triggered.connect(self.toggle_quick_privacy)
        self.tray_menu.addAction(privacy_action)

        lock_action = QAction("Bloquear app", self)
        lock_action.triggered.connect(self.lock_app)
        self.tray_menu.addAction(lock_action)

        pin_config_action = QAction("Configurar PIN", self)
        pin_config_action.triggered.connect(self.open_pin_config)
        self.tray_menu.addAction(pin_config_action)
        
        quit_action = QAction("Salir", self)
        quit_action.triggered.connect(QApplication.instance().quit)
        self.tray_menu.addAction(quit_action)


    def tray_activated(self, reason):
        if reason == QSystemTrayIcon.ActivationReason.Trigger:
            if self.isHidden():
                self.show()
                self.activateWindow()
            else:
                self.hide()

    def closeEvent(self, event):
        # En lugar de cerrar, minimizar a la bandeja del sistema
        event.ignore()
        self.hide()
        self.tray_icon.showMessage(
            "WhatsApp Web",
            "La aplicación sigue ejecutándose en segundo plano.",
            QSystemTrayIcon.MessageIcon.Information,
            2000
        )

    # --- Funcionalidad de Notificaciones Nativas y Respuesta Rápida ---
    def handle_notification(self, notification):
        if getattr(self, "dnd_mode", False):
            return

        title = notification.title().replace('|', '-')
        body = notification.message().replace('\n', ' ').replace('|', '-')
        
        icon_path = ""
        if not notification.icon().isNull():
            temp_dir = os.path.join(tempfile.gettempdir(), "wa_icons")
            os.makedirs(temp_dir, exist_ok=True)
            safe_title = "".join(c for c in title if c.isalnum() or c in " ._-")
            icon_path = os.path.join(temp_dir, f"{safe_title}.png")
            notification.icon().save(icon_path, "PNG")
        
        # Actualizacion reactiva: registrar el chat con mensaje nuevo al tope de la bandeja
        self._update_recent_chat(title, body)

        # Enviar comando al demonio DBus
        command = f"{title}|{body}|{icon_path}\n"
        self.dbus_daemon.write(command.encode('utf-8'))
        # Nota: no llamamos a notification.show() para evitar notificaciones duplicadas en el escritorio

    def on_daemon_stdout(self):
        output = self.dbus_daemon.readAllStandardOutput().data().decode('utf-8').strip()
        for line in output.split('\n'):
            line = line.strip()
            if not line: continue
            
            if line.startswith("REPLY:"):
                parts = line.split(":", 2)
                if len(parts) == 3:
                    chat_title = parts[1]
                    text = parts[2]
                    self.send_whatsapp_message(chat_title, text)
            elif line.startswith("ACTION:"):
                parts = line.split(":", 2)
                if len(parts) == 3 and parts[2] == "default":
                    chat_title = parts[1]
                    self.open_chat(chat_title)

    def open_chat(self, chat_name):
        self.show()
        self.activateWindow()
        escaped_name = json.dumps(chat_name)
        js = f"""
        (function() {{
            let targetName = {escaped_name};
            let chat = document.querySelector('span[title="' + CSS.escape(targetName) + '"]');
            if(chat) {{
                let event = new MouseEvent('mousedown', {{bubbles: true, cancelable: true, view: window}});
                chat.dispatchEvent(event);
            }}
        }})();
        """
        self.browser.page().runJavaScript(js)

    def send_whatsapp_message(self, chat_name, text):
        escaped_text = text.replace('"', '\\"').replace('\n', '\\n')
        js = f"""
        (function() {{
            let chat = document.querySelector('span[title="{chat_name}"]');
            if(chat) {{
                let event = new MouseEvent('mousedown', {{bubbles: true, cancelable: true, view: window}});
                chat.dispatchEvent(event);
                
                setTimeout(() => {{
                    let composer = document.querySelector('div[contenteditable="true"][data-tab="10"]');
                    if (composer) {{
                        composer.focus();
                        document.execCommand('insertText', false, "{escaped_text}");
                        
                        setTimeout(() => {{
                            let sendBtn = document.querySelector('span[data-testid="send"]');
                            if (sendBtn) {{
                                sendBtn.closest('button').click();
                            }}
                        }}, 150);
                    }}
                }}, 400);
            }}
        }})();
        """
        self.browser.page().runJavaScript(js)

    def on_page_loaded(self, ok):
        if not ok:
            return
        # Inyectar helpers de chats y atajos de teclado Alt
        QTimer.singleShot(2500, self.init_chat_helpers)
        # Lectura inicial unica de chats recientes para la bandeja del sistema
        QTimer.singleShot(4000, self.scrape_recent_chats)


    # --- Gestor de Descargas ---
    def handle_download(self, download):
        """Intercepta solicitudes de descarga y las redirige a ~/Downloads/WhatsApp/."""
        suggested = download.downloadFileName()
        save_path = os.path.join(self.download_dir, suggested)
        
        # Evitar sobrescribir: añadir (1), (2), etc.
        base, ext = os.path.splitext(save_path)
        counter = 1
        while os.path.exists(save_path):
            save_path = f"{base} ({counter}){ext}"
            counter += 1
        
        self._active_downloads.add(download)
        download.setDownloadDirectory(self.download_dir)
        download.setDownloadFileName(os.path.basename(save_path))
        download.accept()
        
        # Registrar y conectar señal de finalización
        download.isFinishedChanged.connect(lambda d=download: self.on_download_finished(d))

    def on_download_finished(self, download):
        """Se ejecuta cuando una descarga termina."""
        if not download.isFinished():
            return
            
        if download in self._active_downloads:
            self._active_downloads.discard(download)
            
        file_path = os.path.join(download.downloadDirectory(), download.downloadFileName())
        file_name = download.downloadFileName()
        
        # Calcular tamaño
        try:
            size_bytes = os.path.getsize(file_path)
            size_mb = f"{size_bytes / (1024 * 1024):.1f}"
        except OSError:
            size_mb = "?"
        
        time_str = datetime.now().strftime("%H:%M")
        
        # Registrar en la lista de sesión
        self.session_downloads.append({
            "filename": file_name,
            "path": file_path,
            "size_mb": size_mb,
            "time": time_str
        })
        
        # Notificación nativa del sistema
        self.show_download_notification(file_name, file_path, size_mb)

    def show_download_notification(self, filename, filepath, size_mb):
        """Envía una notificación nativa del sistema sobre la descarga completada."""
        if getattr(self, "dnd_mode", False):
            return
            
        self.tray_icon.showMessage(
            "Descarga completada",
            f"{filename} ({size_mb} MB)",
            QSystemTrayIcon.MessageIcon.Information,
            4000
        )

    # --- Funcionalidad de Privacidad Rápida y Bloqueo con PIN ---
    def setup_privacy_shortcut(self):
        """
        Configura la detección diferenciada de Alt+B:
        - Pulsación simple (Tap): activa/desactiva el desenfoque de privacidad rápido (sin pedir PIN).
        - Mantener presionado (Hold >= 500ms): bloquea la app con blur profundo y pide el PIN en la pill flotante.
        """
        self.quick_privacy_mode = False
        self._alt_b_down = False
        self._alt_b_hold_triggered = False

        self._alt_b_hold_timer = QTimer(self)
        self._alt_b_hold_timer.setSingleShot(True)
        self._alt_b_hold_timer.setInterval(500)
        self._alt_b_hold_timer.timeout.connect(self._on_alt_b_held)

        QApplication.instance().installEventFilter(self)

    def _is_privacy_active(self):
        """Retorna True si la app está en modo privacidad rápida o bloqueada con PIN."""
        if getattr(self, "quick_privacy_mode", False):
            return True
        if hasattr(self, "lock_overlay") and self.lock_overlay.is_locked():
            return True
        return False

    def eventFilter(self, obj, event):
        etype = event.type()

        # Si hay un diálogo modal activo (como el diálogo instructivo o config de PIN), permitir interacción normal
        if QApplication.activeModalWidget() is not None:
            return super().eventFilter(obj, event)

        # Ocultar badges si la ventana pierde foco o se desactiva
        if etype in (QEvent.Type.WindowDeactivate, QEvent.Type.FocusOut):
            self._hide_chat_badges()

        # --- Manejo de Alt+B (siempre activo, incluso en modo privacidad) ---
        if etype == QEvent.Type.KeyPress:
            if event.key() == Qt.Key.Key_B and bool(event.modifiers() & Qt.KeyboardModifier.AltModifier):
                if event.isAutoRepeat():
                    return True

                self._hide_chat_badges()

                if hasattr(self, "lock_overlay") and self.lock_overlay.is_locked():
                    self.lock_overlay.txt_pin.setFocus()
                    return True

                self._alt_b_down = True
                self._alt_b_hold_triggered = False
                self._alt_b_hold_timer.start()
                return True

            # --- Mostrar badges al presionar Alt (solo) ---
            if event.key() in (Qt.Key.Key_Alt, Qt.Key.Key_AltGr) and not event.isAutoRepeat():
                if not self._is_privacy_active():
                    self._show_chat_badges()

        elif etype == QEvent.Type.KeyRelease:
            if self._alt_b_down and event.key() in (Qt.Key.Key_B, Qt.Key.Key_Alt, Qt.Key.Key_AltGr):
                if event.isAutoRepeat():
                    return True

                if self._alt_b_hold_timer.isActive():
                    # Soltó antes de 500ms: fue una pulsación simple (TAP)
                    self._alt_b_hold_timer.stop()
                    self.toggle_quick_privacy()

                self._alt_b_down = False
                self._alt_b_hold_triggered = False
                return True

            # --- Ocultar badges al soltar Alt ---
            if event.key() in (Qt.Key.Key_Alt, Qt.Key.Key_AltGr) and not event.isAutoRepeat():
                self._hide_chat_badges()

        # --- Bloqueo de input cuando privacidad rápida está activa ---
        if getattr(self, "quick_privacy_mode", False):
            if etype in (
                QEvent.Type.KeyPress, QEvent.Type.KeyRelease,
                QEvent.Type.MouseButtonPress, QEvent.Type.MouseButtonRelease,
                QEvent.Type.MouseButtonDblClick, QEvent.Type.MouseMove,
                QEvent.Type.Wheel, QEvent.Type.ContextMenu,
                QEvent.Type.InputMethod, QEvent.Type.ShortcutOverride,
            ):
                return True  # Consumir el evento, no llega a la app

        return super().eventFilter(obj, event)

    def _on_alt_b_held(self):
        """Disparado al mantener presionado Alt+B durante 500ms."""
        self._alt_b_hold_triggered = True
        self.lock_app()

    def show_privacy_instructions_if_needed(self, mode="privacy"):
        """Muestra el diálogo instructivo sobre cómo usar las teclas Alt+B si el usuario no ha marcado no volver a mostrar."""
        settings = QSettings("WhatsAppWebClient", "WhatsAppWebClient")
        if settings.value("hide_privacy_instructions", False, type=bool):
            return
        dialog = PrivacyInstructionDialog(self, mode=mode)
        dialog.exec()

    def toggle_quick_privacy(self):
        """Modo privacidad rápido: desenfoca estéticamente la app sin capa opaca y sin solicitar PIN."""
        if hasattr(self, "lock_overlay") and self.lock_overlay.is_locked():
            return

        self.quick_privacy_mode = not getattr(self, "quick_privacy_mode", False)
        if self.quick_privacy_mode:
            self._apply_native_blur(radius=18)
            QTimer.singleShot(150, lambda: self.show_privacy_instructions_if_needed("privacy"))
        else:
            self._remove_native_blur()

    def lock_app(self):
        """Bloquea la aplicación con PIN y muestra la pill flotante sobre el desenfoque estético."""
        self.show()
        self.activateWindow()
        self.quick_privacy_mode = False
        self.lock_overlay.lock()
        QTimer.singleShot(150, lambda: self.show_privacy_instructions_if_needed("lock"))

    def _on_app_locked(self):
        self._apply_native_blur(radius=24)

    def _on_app_unlocked(self):
        self._remove_native_blur()
        self.quick_privacy_mode = False
        self.browser.setFocus()

    def _apply_native_blur(self, radius=22):
        """Aplica un desenfoque nativo puro a la vista web para que los textos sean ilegibles pero se reconozca WhatsApp."""
        blur_effect = QGraphicsBlurEffect(self.browser)
        blur_effect.setBlurRadius(radius)
        blur_effect.setBlurHints(QGraphicsBlurEffect.BlurHint.QualityHint)
        self.browser.setGraphicsEffect(blur_effect)

    def _remove_native_blur(self):
        """Restaura la nitidez de la vista web."""
        self.browser.setGraphicsEffect(None)

    def open_pin_config(self):
        dialog = PinConfigDialog(self)
        dialog.exec()

    def toggle_dnd_mode(self, checked):
        self.dnd_mode = checked
        if hasattr(self, "browser") and self.browser.page():
            self.browser.page().setAudioMuted(self.dnd_mode)

    def resizeEvent(self, event):
        super().resizeEvent(event)
        if hasattr(self, "lock_overlay") and self.lock_overlay:
            self.lock_overlay.setGeometry(self.rect())

    # --- Cambio rápido de chat con Alt+Número ---
    def setup_chat_shortcuts(self):
        """Configura Alt+1..9 para cambiar al chat 1-9, Alt+0 para el chat 10."""
        for i in range(10):
            action = QAction(self)
            action.setShortcut(QKeySequence(f"Alt+{i}"))
            # Alt+0 = chat 10 (índice 9), Alt+1 = chat 1 (índice 0), etc.
            chat_index = 9 if i == 0 else i - 1
            action.triggered.connect(lambda checked, idx=chat_index: self.switch_to_chat_by_index(idx))
            self.addAction(action)

    def _get_init_chat_helpers_js(self):
        return """
        (function() {
            // 1. Inyectar estilos CSS para badges de atajos
            if (!document.getElementById('wa-alt-badge-styles')) {
                var style = document.createElement('style');
                style.id = 'wa-alt-badge-styles';
                style.textContent = `
                    .wa-alt-badge {
                        position: absolute !important;
                        width: 20px !important;
                        height: 20px !important;
                        line-height: 20px !important;
                        text-align: center !important;
                        font-size: 11px !important;
                        font-weight: 800 !important;
                        font-family: 'Segoe UI', system-ui, -apple-system, sans-serif !important;
                        color: #ffffff !important;
                        background: #00a884 !important;
                        border: 2px solid #ffffff !important;
                        border-radius: 50% !important;
                        pointer-events: none !important;
                        z-index: 999999 !important;
                        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5) !important;
                        box-sizing: border-box !important;
                        padding: 0 !important;
                        margin: 0 !important;
                        animation: wa-badge-pop 0.1s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important;
                    }
                    @keyframes wa-badge-pop {
                        0% { transform: scale(0.3); opacity: 0; }
                        100% { transform: scale(1); opacity: 1; }
                    }
                `;
                document.head.appendChild(style);
            }

            // 2. Función para obtener chats válidos ignorando completamente la pestaña de Archivados
            // y capturando todas las conversaciones visibles (tanto fijadas como normales) en su orden visual exacto.
            window.__waGetValidChats = function() {
                var pane = document.getElementById('pane-side');
                if (!pane) return [];

                // Buscar todos los frames de conversación en el panel lateral.
                // En WhatsApp Web, cada fila de chat (fijada o normal) contiene data-testid="cell-frame-container"
                var cellFrames = pane.querySelectorAll('div[data-testid="cell-frame-container"]');
                var rawList = [];
                if (cellFrames.length) {
                    cellFrames.forEach(function(cf) {
                        var row = cf.closest('[role="listitem"]') || cf.closest('[role="row"]') || cf.parentElement || cf;
                        if (rawList.indexOf(row) === -1) {
                            rawList.push(row);
                        }
                    });
                }

                if (!rawList.length) {
                    rawList = Array.from(pane.querySelectorAll('[role="listitem"], [role="row"]'));
                }

                var validChats = [];
                for (var i = 0; i < rawList.length; i++) {
                    var el = rawList[i];

                    // 1. Filtrar si es la fila de Archivados por iconos, atributos o texto
                    if (el.querySelector('span[data-icon="archive"], span[data-icon="archived"], [data-testid="archived"], [data-testid="archive"]')) {
                        continue;
                    }
                    var titleEl = el.querySelector('span[title]');
                    var title = titleEl ? (titleEl.getAttribute('title') || '').trim().toLowerCase() : '';
                    if (/^(archivados|archived)/i.test(title)) {
                        continue;
                    }
                    var fullText = (el.innerText || el.textContent || '').trim();
                    if (/^(archivados|archived)/i.test(fullText)) {
                        continue;
                    }

                    // 2. Asegurar que representa un chat real (nombre de contacto o contenido de celda)
                    var hasChatContent = el.querySelector('div[data-testid="cell-frame-title"]') || 
                                         el.querySelector('span[title]') || 
                                         el.querySelector('div[data-testid="cell-frame-primary"]') ||
                                         el.querySelector('span[dir="auto"]') ||
                                         el.querySelector('img, span[data-icon]');
                    if (!hasChatContent) {
                        continue;
                    }

                    validChats.push(el);
                }

                // Ordenar visualmente por posición Y en la pantalla para garantizar que el primer chat visible sea siempre el índice 0
                validChats.sort(function(a, b) {
                    return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
                });

                return validChats;
            };

            // 3. Función para mostrar badges sobre la esquina de la foto de perfil
            window.__waShowAltBadges = function() {
                window.__waHideAltBadges();

                var validChats = window.__waGetValidChats();
                var count = Math.min(validChats.length, 10);

                for (var i = 0; i < count; i++) {
                    var keyLabel = (i < 9) ? String(i + 1) : '0';
                    var chatRow = validChats[i];

                    // Localizar la columna/celda del avatar dentro de la fila
                    var frame = chatRow.querySelector('div[data-testid="cell-frame-container"]');
                    var avatarCol = (frame && frame.firstElementChild) ? frame.firstElementChild : chatRow.firstElementChild;
                    if (!avatarCol) continue;

                    var rowRect = chatRow.getBoundingClientRect();
                    if (!rowRect.width || !rowRect.height) continue;

                    // Buscar el elemento visual que representa el círculo del avatar
                    // Cubre: fotos normales (img), contactos sin foto (svg/iconos),
                    // grupos sin foto, anillos de historias/estados y mensajes temporales.
                    var candidate = null;

                    // 1. Imagen de perfil directa
                    var img = avatarCol.querySelector('img');
                    if (img && img.getBoundingClientRect().width >= 35) {
                        candidate = img;
                    }

                    // 2. Anillo de historia o botón contenedor circular
                    if (!candidate) {
                        var roleBtn = avatarCol.querySelector('div[role="button"]');
                        if (roleBtn && roleBtn.getBoundingClientRect().width >= 35) {
                            candidate = roleBtn;
                        }
                    }

                    // 3. Contenedor con icono o forma de avatar (contactos/grupos sin foto)
                    if (!candidate) {
                        var iconContainer = avatarCol.querySelector('span[data-icon]') || avatarCol.querySelector('svg');
                        if (iconContainer) {
                            var parentCandidate = iconContainer.closest('div');
                            if (parentCandidate && avatarCol.contains(parentCandidate) && parentCandidate.getBoundingClientRect().width >= 35) {
                                candidate = parentCandidate;
                            } else {
                                candidate = iconContainer;
                            }
                        }
                    }

                    // 4. Búsqueda de cualquier elemento con dimensiones de avatar (38px - 65px)
                    if (!candidate) {
                        var descendants = avatarCol.querySelectorAll('div, span');
                        for (var d = 0; d < descendants.length; d++) {
                            var rect = descendants[d].getBoundingClientRect();
                            if (rect.width >= 38 && rect.width <= 65 && rect.height >= 38 && rect.height <= 65) {
                                candidate = descendants[d];
                                break;
                            }
                        }
                    }

                    // Determinar el centro del avatar (cx, cy) relativo a chatRow
                    var cx, cy;
                    if (candidate) {
                        var candRect = candidate.getBoundingClientRect();
                        cx = (candRect.left - rowRect.left) + (candRect.width / 2);
                        cy = (candRect.top - rowRect.top) + (candRect.height / 2);
                    } else {
                        var colRect = avatarCol.getBoundingClientRect();
                        cx = (colRect.width > 0) ? ((colRect.left - rowRect.left) + (colRect.width / 2)) : 36.5;
                        cy = (colRect.height > 0) ? ((colRect.top - rowRect.top) + (colRect.height / 2)) : (chatRow.offsetHeight / 2);
                    }

                    // El avatar estándar de WhatsApp Web tiene ~49px de diámetro (radio 24.5px).
                    // Anclamos la insignia exactamente en la esquina superior izquierda del círculo (-3px).
                    var avatarRadius = 24.5;
                    var badgeTop = Math.round(cy - avatarRadius - 3);
                    var badgeLeft = Math.round(cx - avatarRadius - 3);

                    // Asegurar posicionamiento relativo en chatRow y overflow visible
                    if (getComputedStyle(chatRow).position === 'static') {
                        chatRow.style.position = 'relative';
                    }
                    chatRow.style.setProperty('overflow', 'visible', 'important');
                    avatarCol.style.setProperty('overflow', 'visible', 'important');

                    var badge = document.createElement('span');
                    badge.className = 'wa-alt-badge';
                    badge.textContent = keyLabel;
                    badge.style.top = badgeTop + 'px';
                    badge.style.left = badgeLeft + 'px';
                    chatRow.appendChild(badge);
                }
            };

            // 4. Función para ocultar badges
            window.__waHideAltBadges = function() {
                document.querySelectorAll('.wa-alt-badge').forEach(function(el) { el.remove(); });
            };

            // 5. Escuchador directo del teclado dentro de la ventana web
            if (!window.__waAltListenersAttached) {
                window.__waAltListenersAttached = true;
                window.addEventListener('keydown', function(e) {
                    if (e.key === 'Alt' && !e.repeat) {
                        window.__waShowAltBadges();
                    }
                }, true);

                window.addEventListener('keyup', function(e) {
                    if (e.key === 'Alt') {
                        window.__waHideAltBadges();
                    }
                }, true);

                window.addEventListener('blur', function() {
                    window.__waHideAltBadges();
                });
            }
        })();
        """

    def init_chat_helpers(self):
        """Inyecta en la página de WhatsApp los helpers de selección de chat y atajos de badges."""
        if hasattr(self, "browser") and self.browser.page():
            self.browser.page().runJavaScript(self._get_init_chat_helpers_js())

    def switch_to_chat_by_index(self, index):
        """Cambia al chat en la posición dada (0-indexed) de la lista lateral.
        
        Usa el panel lateral (#pane-side) filtrando chats reales para capturar
        chats fijados y normales en su orden visual exacto (omitiendo Archivados).
        Los badges permanecen visibles mientras Alt siga presionado.
        """
        js = f"""
        (function() {{
            var validChats = (window.__waGetValidChats) ? window.__waGetValidChats() : [];
            if (!validChats.length) {{
                {self._get_init_chat_helpers_js()}
                validChats = window.__waGetValidChats ? window.__waGetValidChats() : [];
            }}
            
            if (validChats.length > {index}) {{
                var target = validChats[{index}];
                var clickTarget = target.querySelector('div[data-testid="cell-frame-container"]') || target;
                
                ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function(evtName) {{
                    clickTarget.dispatchEvent(new MouseEvent(evtName, {{
                        bubbles: true,
                        cancelable: true,
                        view: window,
                        buttons: 1
                    }}));
                }});
                
                var titleEl = target.querySelector('span[title]');
                if (titleEl && titleEl !== clickTarget) {{
                    titleEl.click();
                }}
            }}
        }})();
        """
        self.browser.page().runJavaScript(js)

    def _show_chat_badges(self):
        """Muestra badges numéricos en la esquina de la foto de perfil de los primeros 10 chats mientras se presiona Alt."""
        if self._is_privacy_active():
            return
        js = f"""
        if (window.__waShowAltBadges) {{
            window.__waShowAltBadges();
        }} else {{
            {self._get_init_chat_helpers_js()}
            if (window.__waShowAltBadges) window.__waShowAltBadges();
        }}
        """
        self.browser.page().runJavaScript(js)

    def _hide_chat_badges(self):
        """Oculta todos los badges numéricos de los chats."""
        js = "if (window.__waHideAltBadges) window.__waHideAltBadges(); else document.querySelectorAll('.wa-alt-badge').forEach(function(el) { el.remove(); });"
        self.browser.page().runJavaScript(js)

    # --- Funcionalidad de Zoom ---
    def setup_zoom(self):
        # Atajos de teclado para Zoom
        zoom_in_action = QAction(self)
        zoom_in_action.setShortcuts([QKeySequence("Ctrl++"), QKeySequence("Ctrl+=")])
        zoom_in_action.triggered.connect(self.zoom_in)
        self.addAction(zoom_in_action)

        zoom_out_action = QAction(self)
        zoom_out_action.setShortcut(QKeySequence("Ctrl+-"))
        zoom_out_action.triggered.connect(self.zoom_out)
        self.addAction(zoom_out_action)

        zoom_reset_action = QAction(self)
        zoom_reset_action.setShortcut(QKeySequence("Ctrl+0"))
        zoom_reset_action.triggered.connect(self.zoom_reset)
        self.addAction(zoom_reset_action)

    def zoom_in(self):
        current_zoom = self.browser.zoomFactor()
        self.browser.setZoomFactor(current_zoom + 0.1)

    def zoom_out(self):
        current_zoom = self.browser.zoomFactor()
        self.browser.setZoomFactor(max(0.2, current_zoom - 0.1))

    def zoom_reset(self):
        self.browser.setZoomFactor(1.0)
        
    def handle_whatsapp_url(self, url):
        # Convertir enlaces nativos a web (soporta whatsapp://chat/?code= o whatsapp://chat?code=)
        if "chat" in url and "code=" in url:
            code = url.split("code=")[1].split("&")[0]
            web_url = f"https://web.whatsapp.com/accept?code={code}"
            # Forzar navegación mediante JavaScript para evitar bloqueos de QWebEngine
            self.browser.page().runJavaScript(f"window.location.href = '{web_url}';")
        elif "send" in url and "?" in url:
            query = url.split("?", 1)[1]
            web_url = f"https://web.whatsapp.com/send?{query}"
            self.browser.page().runJavaScript(f"window.location.href = '{web_url}';")
        
    def wheelEvent(self, event: QWheelEvent):
        # Hacer zoom con Ctrl + Rueda del ratón
        if event.modifiers() == Qt.KeyboardModifier.ControlModifier:
            delta = event.angleDelta().y()
            if delta > 0:
                self.zoom_in()
            elif delta < 0:
                self.zoom_out()
            event.accept()
        else:
            super().wheelEvent(event)

if __name__ == '__main__':
    from PyQt6.QtNetwork import QLocalSocket, QLocalServer
    app = QApplication(sys.argv)
    
    # Configurar el nombre de la aplicación para el gestor de ventanas (Linux)
    app.setApplicationName("WhatsApp Web")
    app.setApplicationDisplayName("WhatsApp Web")
    app.setDesktopFileName("whatsapp-web-client.desktop")
    
    server_name = "WhatsAppWebClientServer"
    socket = QLocalSocket()
    socket.connectToServer(server_name)
    
    # Extraer argumento de url (si viene de un link en el navegador)
    url_arg = ""
    for arg in sys.argv[1:]:
        if arg.startswith("whatsapp://"):
            url_arg = arg
            break
            
    if socket.waitForConnected(500):
        # La aplicación ya está abierta, mandarle la señal y salir
        msg = "SHOW:" + url_arg if url_arg else "SHOW:"
        socket.write(msg.encode('utf-8'))
        socket.waitForBytesWritten(1000)
        socket.disconnectFromServer()
        sys.exit(0)
    
    # Si no está corriendo, crear el servidor para escuchar a futuras instancias
    server = QLocalServer()
    server.removeServer(server_name)
    server.listen(server_name)
    
    QApplication.setQuitOnLastWindowClosed(False)
    client = WhatsAppClient()
    
    def on_new_connection():
        client_socket = server.nextPendingConnection()
        if client_socket.waitForReadyRead(1000):
            data = client_socket.readAll().data().decode('utf-8')
            if data.startswith("SHOW:"):
                client.show()
                client.activateWindow()
                url = data[5:]
                if url:
                    client.handle_whatsapp_url(url)
        client_socket.disconnectFromServer()
        
    server.newConnection.connect(on_new_connection)
    
    if url_arg:
        client.handle_whatsapp_url(url_arg)
        
    client.show()
    sys.exit(app.exec())
