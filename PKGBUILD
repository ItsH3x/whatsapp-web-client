# Maintainer: Héctor Caro Tarín <ItsH3x>
pkgname=whatsapp-web-client
pkgver=1.0.0
pkgrel=15
pkgdesc="Cliente no oficial de WhatsApp"
arch=('any')
url="https://github.com/ItsH3x/whatsapp-web-client"
license=('GPL3')
depends=('python' 'python-pyqt6' 'python-pyqt6-webengine' 'python-dbus' 'python-gobject')
source=(
    "main.py"
    "dbus_daemon.py"
    "config_manager.py"
    "lock_overlay.py"
    "style.css"
    "whatsapp.svg"
    "launcher.sh"
    "whatsapp-web-client.desktop"
)
sha256sums=('SKIP' 'SKIP' 'SKIP' 'SKIP' 'SKIP' 'SKIP' 'SKIP' 'SKIP')

package() {
    # Crear directorios
    install -d "$pkgdir/usr/share/$pkgname"
    install -d "$pkgdir/usr/bin"
    install -d "$pkgdir/usr/share/applications"
    install -d "$pkgdir/usr/share/pixmaps"

    # Instalar archivos de la aplicación
    install -m644 "$srcdir/main.py" "$pkgdir/usr/share/$pkgname/"
    install -m644 "$srcdir/config_manager.py" "$pkgdir/usr/share/$pkgname/"
    install -m644 "$srcdir/lock_overlay.py" "$pkgdir/usr/share/$pkgname/"
    install -m644 "$srcdir/style.css" "$pkgdir/usr/share/$pkgname/"
    
    # El dbus_daemon.py necesita permisos de ejecución porque se llama vía QProcess
    install -m755 "$srcdir/dbus_daemon.py" "$pkgdir/usr/share/$pkgname/"


    # Instalar icono
    install -m644 "$srcdir/whatsapp.svg" "$pkgdir/usr/share/$pkgname/"
    install -m644 "$srcdir/whatsapp.svg" "$pkgdir/usr/share/pixmaps/$pkgname.svg"

    # Instalar script lanzador
    install -m755 "$srcdir/launcher.sh" "$pkgdir/usr/bin/$pkgname"

    # Instalar archivo desktop
    install -m644 "$srcdir/whatsapp-web-client.desktop" "$pkgdir/usr/share/applications/"
}
