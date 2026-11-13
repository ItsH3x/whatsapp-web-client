# Maintainer: Hector Caro Tarin <ItsH3x>
pkgname=whatsapp-web-client
pkgver=2.0.0
pkgrel=1
pkgdesc="Cliente nativo ultraligero de WhatsApp Web en C++ y Qt6"
arch=('x86_64' 'aarch64')
url="https://github.com/ItsH3x/whatsapp-web-client"
license=('GPL3')
depends=('qt6-base' 'qt6-webengine')
makedepends=('cmake' 'ninja' 'gcc')
source=(
    "CMakeLists.txt"
    "whatsapp.svg"
    "whatsapp-web-client.desktop"
)
sha256sums=('SKIP' 'SKIP' 'SKIP')

prepare() {
    cp -r "$startdir/app" "$srcdir/"
}

build() {
    cmake -B "$srcdir/build" -S "$srcdir" \
        -G Ninja \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_PREFIX=/usr
    cmake --build "$srcdir/build"
}

package() {
    DESTDIR="$pkgdir" cmake --install "$srcdir/build"
}
