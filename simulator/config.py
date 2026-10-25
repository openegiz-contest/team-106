import os

MQTT_HOST = os.environ.get("MQTT_HOST", "mosquitto")
MQTT_PORT = int(os.environ.get("MQTT_PORT", 1883))
MQTT_TOPIC_PREFIX = os.environ.get("MQTT_TOPIC_PREFIX", "telemetry")

DITTO_URL = os.environ.get("DITTO_URL", "http://ditto-nginx:80").rstrip("/")
DITTO_USER = os.environ.get("DITTO_USER", "ditto")
DITTO_PASSWORD = os.environ.get("DITTO_PASSWORD", "ditto")
DITTO_NAMESPACE = os.environ.get("DITTO_NAMESPACE", "org.openegiz.mine")

SIM_INTERVAL = float(os.environ.get("SIM_INTERVAL", 1.0))
SIM_SPEEDUP = float(os.environ.get("SIM_SPEEDUP", 5.0))
SIM_PORT = int(os.environ.get("SIM_PORT", 8000))
