cmake_minimum_required(VERSION 3.16)

project(whatsapp-web-client
    VERSION 1.0.0
    LANGUAGES CXX
)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)

# Configuracion por defecto a Release
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "Tipo de construccion" FORCE)
endif()

# Optimizacion de rendimiento y reduccion de binario en Release
set(CMAKE_CXX_FLAGS_RELEASE "-O3 -flto=auto -DNDEBUG")
set(CMAKE_EXE_LINKER_FLAGS_RELEASE "-flto=auto -s")

# Dependencias Qt6
find_package(Qt6 REQUIRED COMPONENTS
    Core
    Gui
    Widgets
    Network
    DBus
    Svg
    WebEngineCore
    WebEngineWidgets
)

# Definicion del ejecutable principal
add_executable(whatsapp-web-client
    app/main.cpp
    app/config_manager.cpp
    app/notification_manager.cpp
    app/lock_overlay.cpp
    app/whatsapp_page.cpp
    app/whatsapp_window.cpp
    app/whatsapp_tray.cpp
    app/whatsapp_privacy.cpp
    app/whatsapp_chat_bridge.cpp
    app/resources.qrc
)

target_include_directories(whatsapp-web-client PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/app
)

target_link_libraries(whatsapp-web-client PRIVATE
    Qt6::Core
    Qt6::Gui
    Qt6::Widgets
    Qt6::Network
    Qt6::DBus
    Qt6::Svg
    Qt6::WebEngineCore
    Qt6::WebEngineWidgets
)

# Reglas de instalacion
install(TARGETS whatsapp-web-client
    RUNTIME DESTINATION bin
)

install(FILES whatsapp.svg
    DESTINATION share/whatsapp-web-client
)

install(FILES whatsapp.svg
    DESTINATION share/pixmaps
)

install(FILES whatsapp.svg
    DESTINATION share/pixmaps
    RENAME whatsapp-web-client.svg
)

install(FILES whatsapp-web-client.desktop
    DESTINATION share/applications
    RENAME whatsapp-web.desktop
)
