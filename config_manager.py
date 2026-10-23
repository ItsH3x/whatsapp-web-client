import json
import hashlib
from pathlib import Path

# Paths
HOME_DIR = Path.home()
CONFIG_DIR = HOME_DIR / ".local" / "share" / "WhatsAppWebClient"
CONFIG_FILE = CONFIG_DIR / "config.json"

def ensure_directories():
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)

ensure_directories()


# --- Gestión de PIN de Bloqueo de la Aplicación ---

def get_pin_hash():
    """Retorna el hash SHA-256 del PIN guardado o cadena vacía si no existe."""
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                config = json.load(f)
                return config.get("app_pin_hash", "")
        except Exception:
            pass
    return ""

def set_pin(new_pin: str):
    """Guarda el nuevo PIN hasheado con SHA-256 en config.json."""
    ensure_directories()
    config = {}
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                config = json.load(f)
        except Exception:
            pass
    if new_pin:
        config["app_pin_hash"] = hashlib.sha256(new_pin.encode("utf-8")).hexdigest()
    else:
        config.pop("app_pin_hash", None)
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)

def verify_pin(candidate_pin: str) -> bool:
    """Valida si el PIN introducido coincide con el hash guardado."""
    saved_hash = get_pin_hash()
    if not saved_hash:
        return True
    candidate_hash = hashlib.sha256(candidate_pin.encode("utf-8")).hexdigest()
    return candidate_hash == saved_hash

def has_pin() -> bool:
    """Verifica si ya hay un PIN configurado."""
    return bool(get_pin_hash())
