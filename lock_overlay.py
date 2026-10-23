import os
import config_manager
from PyQt6.QtCore import Qt, pyqtSignal, QPropertyAnimation, QPoint, QEasingCurve, QTimer
from PyQt6.QtGui import QColor, QFont, QIntValidator
from PyQt6.QtWidgets import (
    QWidget, QFrame, QVBoxLayout, QHBoxLayout, QLabel,
    QLineEdit, QPushButton, QGraphicsDropShadowEffect, QDialog, QMessageBox
)

class LockOverlay(QWidget):
    """
    Overlay de bloqueo de pantalla completa que intercepta todos los eventos
    y muestra una 'pill' (cápsula flotante) con estilo frosted glass para introducir el PIN censurado.
    """
    unlocked = pyqtSignal()
    locked = pyqtSignal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAttribute(Qt.WidgetAttribute.WA_NoSystemBackground, True)
        self.setFocusPolicy(Qt.FocusPolicy.StrongFocus)
        self.setVisible(False)

        self._is_locked = False
        self.init_ui()

    def init_ui(self):
        # Layout principal centrado
        main_layout = QVBoxLayout(self)
        main_layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        main_layout.setContentsMargins(0, 0, 0, 0)

        # La Pill flotante (cápsula frosted glass)
        self.pill_frame = QFrame(self)
        self.pill_frame.setObjectName("pillFrame")
        self.pill_frame.setFixedWidth(440)
        
        # Efecto de sombra difuminada profunda
        shadow = QGraphicsDropShadowEffect(self)
        shadow.setBlurRadius(45)
        shadow.setColor(QColor(0, 0, 0, 200))
        shadow.setOffset(0, 14)
        self.pill_frame.setGraphicsEffect(shadow)

        self.pill_style_normal = """
        QFrame#pillFrame {
            background: qlineargradient(
                x1: 0, y1: 0, x2: 1, y2: 1,
                stop: 0 rgba(26, 33, 42, 0.94),
                stop: 1 rgba(16, 21, 28, 0.96)
            );
            border: 1px solid rgba(255, 255, 255, 0.18);
            border-radius: 28px;
        }
        """
        self.pill_style_error = """
        QFrame#pillFrame {
            background: qlineargradient(
                x1: 0, y1: 0, x2: 1, y2: 1,
                stop: 0 rgba(45, 22, 28, 0.96),
                stop: 1 rgba(25, 15, 18, 0.98)
            );
            border: 1.5px solid #ff453a;
            border-radius: 28px;
        }
        """
        self.pill_frame.setStyleSheet(self.pill_style_normal)

        pill_layout = QVBoxLayout(self.pill_frame)
        pill_layout.setContentsMargins(28, 22, 28, 22)
        pill_layout.setSpacing(14)

        # Cabecera de la pill: Título
        header_layout = QHBoxLayout()
        header_layout.setSpacing(10)
        
        self.lbl_title = QLabel("WhatsApp bloqueado")
        self.lbl_title.setStyleSheet("""
            color: #f0f2f5;
            font-size: 15px;
            font-weight: 600;
            background: transparent;
            letter-spacing: 0.5px;
        """)
        
        header_layout.addWidget(self.lbl_title)
        header_layout.addStretch()

        pill_layout.addLayout(header_layout)

        # Fila de Entrada: Input de PIN censurado + Botón de Desbloqueo
        input_layout = QHBoxLayout()
        input_layout.setSpacing(12)

        self.txt_pin = QLineEdit()
        self.txt_pin.setEchoMode(QLineEdit.EchoMode.Password)
        self.txt_pin.setMaxLength(6)
        self.txt_pin.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.txt_pin.setPlaceholderText("····")
        self.txt_pin.setValidator(QIntValidator(0, 999999, self))
        self.txt_pin.setStyleSheet("""
            QLineEdit {
                background-color: rgba(0, 0, 0, 0.55);
                border: 1px solid rgba(255, 255, 255, 0.15);
                border-radius: 20px;
                color: #ffffff;
                font-size: 22px;
                font-weight: bold;
                letter-spacing: 6px;
                padding: 6px 16px;
                min-height: 28px;
            }
            QLineEdit:focus {
                border: 1.5px solid #00a884;
                background-color: rgba(0, 0, 0, 0.75);
            }
        """)
        self.txt_pin.textChanged.connect(self._on_pin_changed)
        self.txt_pin.returnPressed.connect(self.submit_pin)

        self.btn_unlock = QPushButton("OK")
        self.btn_unlock.setFixedSize(48, 42)
        self.btn_unlock.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_unlock.setStyleSheet("""
            QPushButton {
                background-color: #00a884;
                color: #ffffff;
                font-size: 14px;
                font-weight: bold;
                border: none;
                border-radius: 21px;
            }
            QPushButton:hover {
                background-color: #02be94;
            }
            QPushButton:pressed {
                background-color: #008f6f;
            }
        """)
        self.btn_unlock.clicked.connect(self.submit_pin)

        input_layout.addWidget(self.txt_pin, 1)
        input_layout.addWidget(self.btn_unlock)

        pill_layout.addLayout(input_layout)

        # Etiqueta de estado / error
        self.lbl_status = QLabel("")
        self.lbl_status.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_status.setStyleSheet("""
            color: #8696a0;
            font-size: 12px;
            background: transparent;
        """)
        pill_layout.addWidget(self.lbl_status)

        main_layout.addWidget(self.pill_frame)

    def paintEvent(self, event):
        # Tinte muy sutil (semitransparente) que permite apreciar WhatsApp con efecto blur detrás
        from PyQt6.QtGui import QPainter
        painter = QPainter(self)
        painter.fillRect(self.rect(), QColor(0, 0, 0, 45))

    def _on_pin_changed(self, text):
        # Auto-verificar si ya tiene 4 dígitos y ya existe un PIN guardado
        if config_manager.has_pin() and len(text) == 4:
            self.submit_pin()

    def submit_pin(self):
        entered_pin = self.txt_pin.text().strip()
        if not entered_pin:
            return

        # Si no hay PIN guardado todavía, este será su nuevo PIN
        if not config_manager.has_pin():
            if len(entered_pin) < 4:
                self.set_error_status("El PIN debe tener al menos 4 dígitos")
                self.shake_pill()
                return
            config_manager.set_pin(entered_pin)
            self.lbl_status.setStyleSheet("color: #00a884; font-size: 12px; background: transparent;")
            self.lbl_status.setText("¡PIN configurado correctamente!")
            QTimer.singleShot(600, self.unlock)
            return

        # Validar PIN existente
        if config_manager.verify_pin(entered_pin):
            self.unlock()
        else:
            self.set_error_status("PIN incorrecto. Inténtalo de nuevo.")
            self.shake_pill()

    def set_error_status(self, message):
        self.lbl_status.setStyleSheet("color: #ff453a; font-size: 12px; font-weight: 500; background: transparent;")
        self.lbl_status.setText(message)
        self.pill_frame.setStyleSheet(self.pill_style_error)
        self.txt_pin.selectAll()

    def shake_pill(self):
        """Animación de vibración suave cuando el PIN es erróneo."""
        original_pos = self.pill_frame.pos()
        self.anim = QPropertyAnimation(self.pill_frame, b"pos")
        self.anim.setDuration(350)
        self.anim.setEasingCurve(QEasingCurve.Type.InOutSine)

        x, y = original_pos.x(), original_pos.y()
        self.anim.setKeyValueAt(0.0, QPoint(x, y))
        self.anim.setKeyValueAt(0.15, QPoint(x - 9, y))
        self.anim.setKeyValueAt(0.35, QPoint(x + 9, y))
        self.anim.setKeyValueAt(0.55, QPoint(x - 6, y))
        self.anim.setKeyValueAt(0.75, QPoint(x + 6, y))
        self.anim.setKeyValueAt(1.0, QPoint(x, y))
        
        def restore_style():
            self.pill_frame.setStyleSheet(self.pill_style_normal)
        self.anim.finished.connect(restore_style)
        self.anim.start()

    def lock(self):
        self._is_locked = True
        self.txt_pin.clear()
        self.pill_frame.setStyleSheet(self.pill_style_normal)

        if not config_manager.has_pin():
            self.lbl_title.setText("Crea tu PIN de seguridad")
            self.lbl_status.setStyleSheet("color: #8696a0; font-size: 12px; background: transparent;")
            self.lbl_status.setText("Ingresa 4 dígitos para proteger tu sesión")
        else:
            self.lbl_title.setText("WhatsApp bloqueado")
            self.lbl_status.setStyleSheet("color: #8696a0; font-size: 12px; background: transparent;")
            self.lbl_status.setText("Introduce tu PIN para desbloquear")

        if self.parent():
            self.setGeometry(self.parent().rect())
        self.setVisible(True)
        self.raise_()
        self.txt_pin.setFocus()
        self.locked.emit()

    def unlock(self):
        self._is_locked = False
        self.txt_pin.clear()
        self.lbl_status.setText("")
        self.setVisible(False)
        self.unlocked.emit()

    def is_locked(self):
        return self._is_locked

    # Captura absoluta de eventos mientras está bloqueado
    def keyPressEvent(self, event):
        if not self._is_locked:
            super().keyPressEvent(event)
            return
        if not self.txt_pin.hasFocus():
            self.txt_pin.setFocus()
        super().keyPressEvent(event)

    def mousePressEvent(self, event):
        # Bloquear cualquier clic a la app inferior
        event.accept()


class PinConfigDialog(QDialog):
    """Diálogo para configurar o cambiar el PIN de seguridad."""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("PIN de Seguridad - WhatsApp Web")
        self.setFixedSize(360, 240)
        self.init_ui()

    def init_ui(self):
        layout = QVBoxLayout(self)
        layout.setSpacing(12)

        has_pin = config_manager.has_pin()
        
        if has_pin:
            layout.addWidget(QLabel("PIN actual:"))
            self.txt_current = QLineEdit()
            self.txt_current.setEchoMode(QLineEdit.EchoMode.Password)
            self.txt_current.setMaxLength(6)
            self.txt_current.setValidator(QIntValidator(0, 999999, self))
            layout.addWidget(self.txt_current)
        else:
            self.txt_current = None

        layout.addWidget(QLabel("Nuevo PIN (4 dígitos):"))
        self.txt_new = QLineEdit()
        self.txt_new.setEchoMode(QLineEdit.EchoMode.Password)
        self.txt_new.setMaxLength(6)
        self.txt_new.setValidator(QIntValidator(0, 999999, self))
        layout.addWidget(self.txt_new)

        layout.addWidget(QLabel("Confirmar nuevo PIN:"))
        self.txt_confirm = QLineEdit()
        self.txt_confirm.setEchoMode(QLineEdit.EchoMode.Password)
        self.txt_confirm.setMaxLength(6)
        self.txt_confirm.setValidator(QIntValidator(0, 999999, self))
        layout.addWidget(self.txt_confirm)

        actions_layout = QHBoxLayout()
        btn_cancel = QPushButton("Cancelar")
        btn_cancel.clicked.connect(self.reject)

        btn_save = QPushButton("Guardar PIN")
        btn_save.setStyleSheet("background-color: #00a884; color: white; font-weight: bold; padding: 6px 14px; border-radius: 4px;")
        btn_save.clicked.connect(self.save_pin)

        actions_layout.addWidget(btn_cancel)
        actions_layout.addStretch()
        actions_layout.addWidget(btn_save)
        layout.addLayout(actions_layout)

    def save_pin(self):
        if self.txt_current is not None:
            current = self.txt_current.text().strip()
            if not config_manager.verify_pin(current):
                QMessageBox.warning(self, "Error", "El PIN actual es incorrecto.")
                return

        new_pin = self.txt_new.text().strip()
        confirm_pin = self.txt_confirm.text().strip()

        if len(new_pin) < 4:
            QMessageBox.warning(self, "Error", "El nuevo PIN debe tener al menos 4 dígitos.")
            return

        if new_pin != confirm_pin:
            QMessageBox.warning(self, "Error", "El nuevo PIN y su confirmación no coinciden.")
            return

        config_manager.set_pin(new_pin)
        QMessageBox.information(self, "Éxito", "El PIN de seguridad se ha guardado correctamente.")
        self.accept()
