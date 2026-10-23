#!/usr/bin/python3
import sys
import dbus
import dbus.mainloop.glib
from gi.repository import GLib
import threading

dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
bus = dbus.SessionBus()
loop = GLib.MainLoop()

notif_map = {} # dbus_id -> chat_title
chat_to_id = {} # chat_title -> dbus_id

def on_replied(id, text):
    if id in notif_map:
        print(f"REPLY:{notif_map[id]}:{text}", flush=True)

def on_action(id, action):
    if id in notif_map and action == "default":
        print(f"ACTION:{notif_map[id]}:default", flush=True)

bus.add_signal_receiver(on_replied, dbus_interface="org.freedesktop.Notifications", signal_name="NotificationReplied")
bus.add_signal_receiver(on_action, dbus_interface="org.freedesktop.Notifications", signal_name="ActionInvoked")

notify_obj = bus.get_object("org.freedesktop.Notifications", "/org/freedesktop/Notifications")
notify_interface = dbus.Interface(notify_obj, "org.freedesktop.Notifications")

def read_stdin():
    for line in sys.stdin:
        line = line.strip()
        if not line: continue
        parts = line.split("|", 2)
        if len(parts) == 3:
            title, body, icon_path = parts
            GLib.idle_add(send_notification, title, body, icon_path)
    # If stdin closes, it means the main PyQt6 process died. We should exit.
    loop.quit()

def send_notification(title, body, icon_path):
    if not icon_path:
        icon_path = "whatsapp"
        
    replaces_id = chat_to_id.get(title, 0)
    
    try:
        new_id = notify_interface.Notify(
            "WhatsApp Web", 
            dbus.UInt32(replaces_id), 
            icon_path, 
            title, 
            body,
            dbus.Array(["inline-reply", "Responder", "default", "Abrir"], signature="s"),
            dbus.Dictionary({
                "x-kde-reply-action": dbus.String("inline-reply"),
                "transient": dbus.Boolean(False),
                "resident": dbus.Boolean(True)
            }, signature="sv"),
            dbus.Int32(5000) # Expire in 5 seconds
        )
        chat_to_id[title] = new_id
        notif_map[new_id] = title
    except Exception as e:
        print(f"ERROR:{e}", flush=True)
    return False

threading.Thread(target=read_stdin, daemon=True).start()
loop.run()
