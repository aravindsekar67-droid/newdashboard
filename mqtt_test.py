import paho.mqtt.publish as publish

publish.single(
    "conveyor/sensors",
    '{"joint_id":"J001","temperature":42.5,"vibration":16.0,"speed":2.5,"alignment":"CENTERED","sound":45,"tension":5.0}',
    hostname="52.58.200.83"
)

print("MQTT test message sent")